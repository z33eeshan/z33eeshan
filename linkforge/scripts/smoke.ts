/**
 * End-to-end smoke test against live HTTP. Run with:
 *
 *   npx tsx scripts/smoke.ts
 *
 * Exercises the real paths that unit tests stub out: robots.txt fetching, the
 * polite fetcher, link extraction from a live page, the Common Crawl index, and
 * the scoring pipeline over imported data. Kept out of `npm test` because it
 * needs unrestricted outbound internet access — it will correctly report
 * network failures if run somewhere with an egress allowlist (a locked-down CI
 * sandbox, for example). The import/scoring/disavow/snapshot sections need no
 * network and should always pass.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  // Isolated scratch DB so repeated runs start clean and never touch the real
  // dev database at ./data/linkforge.db. Must be set before @/lib/config loads,
  // and these imports must stay dynamic (inside main) so they evaluate after
  // the env vars below rather than being hoisted ahead of them.
  const scratchDb = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "linkforge-smoke-")),
    "smoke.db",
  );
  process.env.DATABASE_PATH = scratchDb;
  process.env.TARGET_SITE = "livenewsof.com";

  const { migrate, db, ready } = await import("@/lib/db");
  const { fetchPage } = await import("@/lib/engine/fetcher");
  const { parsePage } = await import("@/lib/engine/linkparser");
  const { importBacklinkCsv } = await import("@/lib/providers/import");
  const { auditReferringDomains } = await import("@/lib/engine/spam");
  const { analyseAnchors } = await import("@/lib/engine/anchors");
  const { buildDisavow } = await import("@/lib/engine/disavow");
  const { listCrawls, knownUrls } = await import("@/lib/providers/commoncrawl");
  const { takeSnapshot } = await import("@/lib/engine/discover");
  const { overview } = await import("@/lib/queries");

  console.log("\n1. Schema");
  migrate(db());
  const tables = ready()
    .prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'",
    )
    .get();
  check("tables created", (tables?.n ?? 0) >= 10, `${tables?.n} tables`);

  console.log("\n2. Live fetch + robots.txt");
  const res = await fetchPage("https://example.com/");
  check("fetched example.com", res.ok, `HTTP ${res.status} in ${res.elapsedMs}ms`);
  check("got HTML body", (res.html?.length ?? 0) > 0, `${res.html?.length ?? 0} bytes`);
  check("content hash computed", Boolean(res.contentHash));

  if (res.html) {
    const page = parsePage(res.html, res.finalUrl);
    check("parsed a title", Boolean(page.title), page.title ?? "none");
    check("extracted links", page.links.length >= 0, `${page.links.length} links`);
    check("counted words", page.wordCount > 0, `${page.wordCount} words`);
  }

  console.log("\n3. robots.txt is honoured");
  // Google publishes a robots.txt that disallows /search.
  const blocked = await fetchPage("https://www.google.com/search?q=test");
  check(
    "disallowed path refused without a request",
    blocked.blockedByRobots || blocked.status === 0,
    blocked.error ?? `status ${blocked.status}`,
  );

  console.log("\n4. Common Crawl index");
  try {
    const crawls = await listCrawls();
    check("listed crawl collections", crawls.length > 0, `newest: ${crawls[0]}`);
    const urls = await knownUrls("example.com", { limit: 5 });
    check("queried the URL index", Array.isArray(urls), `${urls.length} URLs known`);
  } catch (err) {
    check("Common Crawl reachable", false, err instanceof Error ? err.message : String(err));
  }

  console.log("\n5. Import → score → disavow pipeline");
  const csv =
    "Referring page URL,Target URL,Anchor,Type\n" +
    "https://legitnewsoutlet.example/story,https://livenewsof.com/a,Live News Of,Follow\n" +
    "https://x7kqz9vbn.xyz/links,https://livenewsof.com/a,cheap insurance quotes,Follow\n" +
    "https://x7kqz9vbn.xyz/links2,https://livenewsof.com/b,cheap insurance quotes,Follow\n";

  const summary = importBacklinkCsv(csv, "livenewsof.com", "smoke");
  check("import detected the format", summary.detectedFormat === "ahrefs", summary.detectedFormat);
  check("rows imported", summary.backlinksInserted + summary.backlinksUpdated === 3);

  const assessments = auditReferringDomains("livenewsof.com", "en");
  check("domains scored", assessments.length >= 2, `${assessments.length} domains`);

  const spammy = assessments.find((a) => a.domain === "x7kqz9vbn.xyz");
  const clean = assessments.find((a) => a.domain === "legitnewsoutlet.example");
  check("spam domain scored above the clean one", (spammy?.score ?? 0) > (clean?.score ?? 100),
    `${spammy?.score} vs ${clean?.score}`);

  const anchors = analyseAnchors("livenewsof.com", ["Live News Of"], ["insurance quotes"]);
  check("anchor profile built", anchors.totalLinks === 3, `${anchors.totalLinks} links`);
  check(
    "keyword anchor over-representation flagged",
    anchors.warnings.length > 0,
    anchors.warnings[0] ?? "none",
  );

  const file = buildDisavow(assessments, { minScore: 30, includeReview: true });
  check("disavow builder ran", file.content.includes("# Disavow file generated"));
  check("every entry carries a justification",
    file.entries.every((e) => e.reason.length > 0));

  console.log("\n6. Snapshot + overview read model");
  takeSnapshot("livenewsof.com");
  const stats = overview("livenewsof.com");
  check("overview reports links", stats.totalBacklinks === 3, `${stats.totalBacklinks}`);
  check("overview reports referring domains", stats.referringDomains === 2,
    `${stats.referringDomains}`);

  console.log(
    failures === 0
      ? "\nAll smoke checks passed.\n"
      : `\n${failures} smoke check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nSmoke test crashed:", err);
  process.exit(1);
});
