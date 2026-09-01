import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Point the DB at a scratch file BEFORE anything imports the config module.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "linkforge-test-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.TARGET_SITE = "livenewsof.com";

const { parseMigrations, migrate, db, getSetting, setSetting } = await import("@/lib/db");
const { importBacklinkCsv } = await import("@/lib/providers/import");
const { median } = await import("@/lib/engine/discover");

test("parseMigrations splits schema.sql on migration markers", () => {
  const blocks = parseMigrations(
    "-- preamble\n-- migration:001 core\nCREATE TABLE a (x);\n-- migration:002 more\nCREATE TABLE b (y);",
  );
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.id, "001");
  assert.ok(blocks[0]!.body.includes("CREATE TABLE a"));
  assert.equal(blocks[1]!.id, "002");
});

test("migrate applies every block and is idempotent", () => {
  const conn = db();
  const first = migrate(conn);
  assert.ok(first.length >= 4, `expected several migrations, got ${first.length}`);

  const second = migrate(conn);
  assert.deepEqual(second, [], "re-running must apply nothing");

  const tables = conn
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const expected of [
    "domains",
    "backlinks",
    "prospects",
    "contacts",
    "outreach",
    "jobs",
    "domain_ranks",
    "disavow_entries",
    "link_snapshots",
  ]) {
    assert.ok(tables.includes(expected), `missing table ${expected}`);
  }
});

test("settings round-trip and upsert", () => {
  assert.equal(getSetting("nope"), null);
  setSetting("k", "v1");
  assert.equal(getSetting("k"), "v1");
  setSetting("k", "v2");
  assert.equal(getSetting("k"), "v2");
});

test("importBacklinkCsv detects the Search Console top-linking-sites format", () => {
  const csv = "Site,Linking pages,Target pages\nexample.com,12,3\nspam.xyz,400,1\n";
  const summary = importBacklinkCsv(csv, "livenewsof.com", "gsc-export");

  assert.equal(summary.detectedFormat, "gsc-top-linking-sites");
  assert.equal(summary.rowsRead, 2);
  assert.equal(summary.backlinksInserted, 2);
  assert.equal(summary.domainsSeen, 2);
  // Domain-only rows must warn that page discovery is still needed.
  assert.ok(summary.warnings.some((w) => w.includes("only a domain")));
});

test("importBacklinkCsv detects an Ahrefs-shaped export and reads attributes", () => {
  const csv =
    "Referring page URL,Target URL,Anchor,Type\n" +
    "https://blog.example.org/post,https://livenewsof.com/story,Live News Of,Nofollow\n";
  const summary = importBacklinkCsv(csv, "livenewsof.com");
  assert.equal(summary.detectedFormat, "ahrefs");

  const row = db()
    .prepare<[], { source_domain: string; anchor_text: string; is_nofollow: number }>(
      "SELECT source_domain, anchor_text, is_nofollow FROM backlinks WHERE source_url LIKE '%blog.example.org%'",
    )
    .get();
  assert.equal(row?.source_domain, "example.org");
  assert.equal(row?.anchor_text, "Live News Of");
  assert.equal(row?.is_nofollow, 1);
});

test("importBacklinkCsv skips self-links and re-import is idempotent", () => {
  const csv =
    "Source url,Target url,Anchor\n" +
    "https://livenewsof.com/own-page,https://livenewsof.com/story,self\n" +
    "https://real.com/page,https://livenewsof.com/story,Real\n";

  const first = importBacklinkCsv(csv, "livenewsof.com");
  assert.equal(first.skipped, 1, "the self-link must be skipped");
  assert.equal(first.backlinksInserted, 1);

  const second = importBacklinkCsv(csv, "livenewsof.com");
  assert.equal(second.backlinksInserted, 0, "re-import must not duplicate");
  assert.equal(second.backlinksUpdated, 1);
});

test("importBacklinkCsv reports unrecognised columns instead of silently importing nothing", () => {
  const summary = importBacklinkCsv("colour,shape\nred,square\n", "livenewsof.com");
  assert.equal(summary.detectedFormat, "unrecognised");
  assert.equal(summary.backlinksInserted, 0);
  assert.ok(summary.warnings[0]!.includes("Could not recognise"));
});

test("median handles empty, odd and even inputs", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
