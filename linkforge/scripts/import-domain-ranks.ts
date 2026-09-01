/**
 * Imports the Common Crawl host-level webgraph ranks file into `domain_ranks`.
 *
 * This is the one-off download that gives the whole tool a free authority
 * metric. Usage:
 *
 *   npm run ranks:import -- <url-or-local-path>
 *
 * Find the current file at:
 *   https://commoncrawl.org/web-graphs
 * Look for the host-level or domain-level "ranks" file for the latest graph,
 * e.g. cc-main-<dates>-domain-ranks.txt.gz
 *
 * Expected columns (tab or space separated), which is the published format:
 *   harmonic_pos  harmonic_val  pagerank_pos  pagerank_val  host_rev
 * where host_rev is reversed, e.g. "com.example.www".
 *
 * Size note, so you can decide before starting: the domain-level ranks file is
 * a few hundred MB gzipped and yields tens of millions of rows. Import takes
 * roughly 5-20 minutes and the resulting SQLite table is a few GB. If that is
 * more than you want locally, skip this and set OPENPAGERANK_API_KEY instead —
 * the tool works either way, you just get 1000 domain lookups a day instead of
 * unlimited local ones.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import type { Readable as NodeReadable } from "node:stream";
import { config } from "@/lib/config";
import { db, migrate } from "@/lib/db";
import { normaliseRankPosition } from "@/lib/providers/authority";

const BATCH = 20_000;

/** "com.example.www" -> "example.com" */
export function unreverseHost(reversed: string): string | null {
  const parts = reversed.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const host = parts.reverse().join(".").toLowerCase();
  return host.replace(/^www\./, "");
}

async function openSource(src: string): Promise<NodeReadable> {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, {
      headers: { "user-agent": config.crawler.userAgent },
    });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: HTTP ${res.status} for ${src}`);
    }
    const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    return src.endsWith(".gz") ? (stream.pipe(createGunzip()) as NodeReadable) : stream;
  }

  const abs = path.resolve(process.cwd(), src);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const stream = fs.createReadStream(abs);
  return abs.endsWith(".gz") ? (stream.pipe(createGunzip()) as NodeReadable) : stream;
}

async function main(): Promise<void> {
  const src = process.argv[2] ?? config.domainRanksUrl;
  if (!src) {
    console.error(
      "Usage: npm run ranks:import -- <url-or-path>\n" +
        "Get the current ranks file URL from https://commoncrawl.org/web-graphs\n" +
        "Or set DOMAIN_RANKS_URL in .env.local.",
    );
    process.exit(1);
  }

  const conn = db();
  migrate(conn);

  console.log(`Reading ranks from ${src}`);
  const stream = await openSource(src);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const insert = conn.prepare(
    `INSERT INTO domain_ranks
       (domain, harmonic_pos, harmonic_val, pagerank_pos, pagerank_val, normalised)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET
       harmonic_pos = excluded.harmonic_pos,
       harmonic_val = excluded.harmonic_val,
       pagerank_pos = excluded.pagerank_pos,
       pagerank_val = excluded.pagerank_val,
       normalised   = excluded.normalised`,
  );

  type Row = [string, number, number, number, number, number];
  let batch: Row[] = [];
  let read = 0;
  let written = 0;
  let skipped = 0;
  const started = Date.now();

  // Total host count is needed to normalise positions. We don't know it until
  // the file ends, so pass 1 initially and rescale afterwards using the max
  // position actually observed — which IS the host count for these files.
  let maxPos = 1;

  const flush = conn.transaction((rows: Row[]) => {
    for (const r of rows) insert.run(...r);
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cols = trimmed.split(/[\s\t]+/);
    // Skip the header line the published files carry.
    if (read === 0 && /[a-z_]/i.test(cols[0] ?? "") && !/^\d+$/.test(cols[0] ?? "")) {
      continue;
    }
    read++;

    if (cols.length < 5) {
      skipped++;
      continue;
    }

    const hPos = Number.parseInt(cols[0]!, 10);
    const hVal = Number.parseFloat(cols[1]!);
    const pPos = Number.parseInt(cols[2]!, 10);
    const pVal = Number.parseFloat(cols[3]!);
    const domain = unreverseHost(cols[4]!);

    if (!domain || !Number.isFinite(hPos)) {
      skipped++;
      continue;
    }
    if (hPos > maxPos) maxPos = hPos;

    batch.push([
      domain,
      hPos,
      Number.isFinite(hVal) ? hVal : 0,
      Number.isFinite(pPos) ? pPos : 0,
      Number.isFinite(pVal) ? pVal : 0,
      normaliseRankPosition(hPos, maxPos),
    ]);

    if (batch.length >= BATCH) {
      flush(batch);
      written += batch.length;
      batch = [];
      if (written % (BATCH * 10) === 0) {
        const rate = Math.round(written / ((Date.now() - started) / 1000));
        console.log(`  ${written.toLocaleString()} rows (${rate.toLocaleString()}/s)`);
      }
    }
  }

  if (batch.length > 0) {
    flush(batch);
    written += batch.length;
  }

  // Rescale now that the true host count is known. Doing it in SQL avoids a
  // second pass over tens of millions of JS objects.
  console.log(`Rescaling scores against ${maxPos.toLocaleString()} hosts...`);
  conn
    .prepare(
      `UPDATE domain_ranks
          SET normalised = ROUND(
                MAX(0, MIN(100, 100.0 * (1.0 - (LOG(harmonic_pos) / LOG(?))))), 1)
        WHERE harmonic_pos > 0`,
    )
    .run(Math.max(maxPos, 2));

  conn.pragma("optimize");

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(
    `Done in ${elapsed}s. Read ${read.toLocaleString()}, wrote ${written.toLocaleString()}, skipped ${skipped.toLocaleString()}.`,
  );
}

/**
 * Only run when invoked as a script. Without this guard, importing
 * `unreverseHost` for a test executes the whole importer (and exits the
 * process) as a side effect.
 */
const invokedDirectly =
  process.argv[1] !== undefined && /import-domain-ranks\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
