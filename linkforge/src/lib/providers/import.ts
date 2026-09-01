import { ready } from "@/lib/db";
import { parseCsvObjects } from "@/lib/engine/csv";
import { normaliseUrl, registrableDomain } from "@/lib/engine/url";

export interface ImportSummary {
  rowsRead: number;
  backlinksInserted: number;
  backlinksUpdated: number;
  domainsSeen: number;
  skipped: number;
  detectedFormat: string;
  warnings: string[];
}

/** Header sets we recognise, most specific first. */
const FORMATS: {
  name: string;
  match: (keys: string[]) => boolean;
  source: (row: Record<string, string>) => string | undefined;
  target?: (row: Record<string, string>) => string | undefined;
  anchor?: (row: Record<string, string>) => string | undefined;
  nofollow?: (row: Record<string, string>) => boolean | undefined;
}[] = [
  {
    // Search Console → Links → "Top linking sites" export.
    name: "gsc-top-linking-sites",
    match: (k) => k.includes("site") && k.some((x) => x.includes("linking_pages")),
    source: (r) => r.site,
    target: (r) => r.target_pages,
  },
  {
    // Search Console → Links → drill-down into one linking site.
    name: "gsc-linking-pages",
    match: (k) => k.includes("linking_page") || k.includes("linking_pages"),
    source: (r) => r.linking_page ?? r.linking_pages,
    target: (r) => r.target_page ?? r.target_pages,
  },
  {
    name: "ahrefs",
    match: (k) => k.includes("referring_page_url") || k.includes("referring_page_title"),
    source: (r) => r.referring_page_url,
    target: (r) => r.target_url,
    anchor: (r) => r.anchor,
    nofollow: (r) => /nofollow/i.test(r.type ?? r.nofollow ?? ""),
  },
  {
    name: "semrush",
    match: (k) => k.includes("source_url") && k.includes("target_url"),
    source: (r) => r.source_url,
    target: (r) => r.target_url,
    anchor: (r) => r.anchor,
    nofollow: (r) => /true|yes|1/i.test(r.nofollow ?? ""),
  },
  {
    name: "moz",
    match: (k) => k.includes("page") && k.includes("anchor_text"),
    source: (r) => r.page ?? r.url,
    target: (r) => r.target_url ?? r.target,
    anchor: (r) => r.anchor_text,
    nofollow: (r) => /nofollow/i.test(r.link_attributes ?? r.flags ?? ""),
  },
  {
    // Generic: any file with a url-ish column.
    name: "generic",
    match: (k) => k.some((x) => /^(url|source|source_url|referring_url|from)$/.test(x)),
    source: (r) => r.url ?? r.source ?? r.source_url ?? r.referring_url ?? r.from,
    target: (r) => r.target ?? r.target_url ?? r.to,
    anchor: (r) => r.anchor ?? r.anchor_text,
  },
];

/**
 * Imports a backlink CSV from Search Console or any vendor export.
 *
 * Search Console's Links report has no API, so this is the supported path for
 * getting your own authoritative backlink list in. It doubles as the migration
 * route if the client has an existing Ahrefs/Semrush/Moz subscription.
 */
export function importBacklinkCsv(
  csv: string,
  targetDomainInput: string,
  discoveredVia = "import",
): ImportSummary {
  const rows = parseCsvObjects(csv);
  const warnings: string[] = [];
  const targetDomain = registrableDomain(targetDomainInput) ?? targetDomainInput;

  if (rows.length === 0) {
    return {
      rowsRead: 0,
      backlinksInserted: 0,
      backlinksUpdated: 0,
      domainsSeen: 0,
      skipped: 0,
      detectedFormat: "none",
      warnings: ["No data rows found. Is the file empty or not CSV?"],
    };
  }

  const keys = Object.keys(rows[0]!);
  const format = FORMATS.find((f) => f.match(keys));

  if (!format) {
    return {
      rowsRead: rows.length,
      backlinksInserted: 0,
      backlinksUpdated: 0,
      domainsSeen: 0,
      skipped: rows.length,
      detectedFormat: "unrecognised",
      warnings: [
        `Could not recognise the columns: ${keys.join(", ")}. ` +
          "Expected a Search Console links export or an Ahrefs/Semrush/Moz backlink export.",
      ],
    };
  }

  const conn = ready();
  const insertBacklink = conn.prepare(
    `INSERT INTO backlinks
       (source_url, source_domain, target_url, target_domain, anchor_text, rel,
        is_nofollow, discovered_via, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unverified')
     ON CONFLICT (source_url, target_url) DO UPDATE SET
       anchor_text = COALESCE(excluded.anchor_text, backlinks.anchor_text),
       discovered_via = backlinks.discovered_via`,
  );
  const upsertDomain = conn.prepare(
    `INSERT INTO domains (domain) VALUES (?) ON CONFLICT (domain) DO NOTHING`,
  );

  const summary: ImportSummary = {
    rowsRead: rows.length,
    backlinksInserted: 0,
    backlinksUpdated: 0,
    domainsSeen: 0,
    skipped: 0,
    detectedFormat: format.name,
    warnings,
  };

  const domains = new Set<string>();
  let domainOnlyRows = 0;
  let processed = 0;

  // An upsert reports changes:1 whether it inserted or updated, so the only
  // reliable way to split the two is the table's row count either side.
  const countRows = conn.prepare<[], { n: number }>(
    "SELECT COUNT(*) AS n FROM backlinks",
  );
  const before = countRows.get()?.n ?? 0;

  const run = conn.transaction(() => {
    for (const row of rows) {
      const rawSource = format.source(row);
      if (!rawSource) {
        summary.skipped++;
        continue;
      }

      const sourceDomain = registrableDomain(rawSource);
      if (!sourceDomain) {
        summary.skipped++;
        continue;
      }
      if (sourceDomain === targetDomain) {
        // Self-links are not backlinks.
        summary.skipped++;
        continue;
      }

      domains.add(sourceDomain);
      upsertDomain.run(sourceDomain);

      // "Top linking sites" gives a domain, not a page URL. Record the domain
      // as a referring domain with a placeholder source so the crawler can
      // discover the actual linking pages later.
      const sourceUrl = normaliseUrl(rawSource) ?? `https://${sourceDomain}/`;
      if (!/\//.test(rawSource.replace(/^https?:\/\//, ""))) domainOnlyRows++;

      const rawTarget = format.target?.(row);
      const targetUrl =
        (rawTarget ? normaliseUrl(rawTarget) : null) ?? `https://${targetDomain}/`;

      const anchor = format.anchor?.(row) || null;
      const nofollow = format.nofollow?.(row) ?? false;

      insertBacklink.run(
        sourceUrl,
        sourceDomain,
        targetUrl,
        targetDomain,
        anchor,
        nofollow ? "nofollow" : null,
        nofollow ? 1 : 0,
        discoveredVia,
      );
      processed++;
    }
  });
  run();

  const inserted = (countRows.get()?.n ?? before) - before;
  summary.backlinksInserted = inserted;
  summary.backlinksUpdated = processed - inserted;
  summary.domainsSeen = domains.size;

  if (domainOnlyRows > 0) {
    warnings.push(
      `${domainOnlyRows} row(s) contained only a domain, not a page URL. ` +
        "Run 'Discover linking pages' to find the exact pages that link to you.",
    );
  }

  return summary;
}
