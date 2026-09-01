import { config } from "@/lib/config";
import { ready } from "@/lib/db";
import { knownUrls } from "@/lib/providers/commoncrawl";
import { fetchPage } from "./fetcher";
import { findLinksTo, parsePage } from "./linkparser";
import { registrableDomain } from "./url";

/**
 * Linking-page discovery.
 *
 * Search Console's "Top linking sites" export gives you a domain, not the page
 * URL. Vendor indexes give you the page but may be months stale. This closes
 * the gap: given a referring domain, find the exact pages on it that link to
 * you, and capture the anchor text, rel attributes and placement that Search
 * Console never shows you.
 *
 * Search order is deliberate — cheapest first:
 *   1. Common Crawl's URL index for the domain (free, no load on their server)
 *   2. The domain's own sitemap
 *   3. Homepage links, one hop deep
 */
export interface DiscoveryResult {
  domain: string;
  pagesChecked: number;
  linksFound: number;
  errors: string[];
}

async function sitemapUrls(domain: string, cap: number): Promise<string[]> {
  const out: string[] = [];
  const roots = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`];

  for (const root of roots) {
    const res = await fetchPage(root, { retries: 1 });
    if (!res.ok || !res.html) continue;

    const locs = [...res.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
    // A sitemap index points at more sitemaps; follow a couple of them.
    const nested = locs.filter((l) => /\.xml(\.gz)?$/i.test(l)).slice(0, 3);
    const pages = locs.filter((l) => !/\.xml(\.gz)?$/i.test(l));

    out.push(...pages);
    for (const child of nested) {
      if (out.length >= cap) break;
      const sub = await fetchPage(child, { retries: 1 });
      if (!sub.ok || !sub.html) continue;
      out.push(
        ...[...sub.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
          .map((m) => m[1]!)
          .filter((l) => !/\.xml(\.gz)?$/i.test(l)),
      );
    }
    if (out.length > 0) break;
  }

  return [...new Set(out)].slice(0, cap);
}

export async function discoverLinkingPages(
  referringDomainInput: string,
  targetDomainInput = config.targetSite,
  opts: { maxPages?: number } = {},
): Promise<DiscoveryResult> {
  const domain = registrableDomain(referringDomainInput);
  const targetDomain = registrableDomain(targetDomainInput) ?? targetDomainInput;
  const maxPages = opts.maxPages ?? 60;
  const errors: string[] = [];

  if (!domain) {
    return { domain: referringDomainInput, pagesChecked: 0, linksFound: 0, errors: ["Invalid domain"] };
  }

  const candidates = new Set<string>();

  try {
    for (const u of await knownUrls(domain, { limit: maxPages })) candidates.add(u);
  } catch (err) {
    errors.push(`Common Crawl: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (candidates.size < maxPages) {
    try {
      for (const u of await sitemapUrls(domain, maxPages - candidates.size)) {
        candidates.add(u);
      }
    } catch (err) {
      errors.push(`Sitemap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  candidates.add(`https://${domain}/`);

  const conn = ready();
  const insert = conn.prepare(
    `INSERT INTO backlinks
       (source_url, source_domain, target_url, target_domain, anchor_text, rel,
        is_nofollow, is_sponsored, is_ugc, link_position, surrounding_text,
        http_status, discovered_via, status, last_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'crawl', 'live', datetime('now'))
     ON CONFLICT (source_url, target_url) DO UPDATE SET
       anchor_text      = excluded.anchor_text,
       rel              = excluded.rel,
       is_nofollow      = excluded.is_nofollow,
       is_sponsored     = excluded.is_sponsored,
       is_ugc           = excluded.is_ugc,
       link_position    = excluded.link_position,
       surrounding_text = excluded.surrounding_text,
       http_status      = excluded.http_status,
       status           = 'live',
       last_verified    = datetime('now')`,
  );
  const updateDomain = conn.prepare(
    `INSERT INTO domains
       (domain, last_crawled, http_status, title, language, outbound_link_count, is_indexable)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET
       last_crawled        = excluded.last_crawled,
       http_status         = excluded.http_status,
       title               = COALESCE(excluded.title, domains.title),
       language            = COALESCE(excluded.language, domains.language),
       outbound_link_count = COALESCE(excluded.outbound_link_count, domains.outbound_link_count),
       is_indexable        = COALESCE(excluded.is_indexable, domains.is_indexable)`,
  );

  let pagesChecked = 0;
  let linksFound = 0;
  let domainMetaWritten = false;

  for (const url of [...candidates].slice(0, maxPages)) {
    const res = await fetchPage(url, { retries: 1 });
    pagesChecked++;
    if (!res.ok || !res.html) continue;

    const page = parsePage(res.html, res.finalUrl);

    // Record domain-level facts once, from the first page that loads. The spam
    // scorer reads these.
    if (!domainMetaWritten) {
      updateDomain.run(
        domain,
        res.status,
        page.title,
        page.language,
        page.externalLinkCount,
        page.isIndexable ? 1 : 0,
      );
      domainMetaWritten = true;
    }

    const hits = findLinksTo(page, targetDomain);
    if (hits.length === 0) continue;

    conn.transaction(() => {
      for (const hit of hits) {
        insert.run(
          res.finalUrl,
          domain,
          hit.href,
          targetDomain,
          hit.anchorText,
          hit.rel,
          hit.isNofollow ? 1 : 0,
          hit.isSponsored ? 1 : 0,
          hit.isUgc ? 1 : 0,
          hit.position,
          hit.surroundingText,
          res.status,
        );
        linksFound++;
      }
    })();
  }

  return { domain, pagesChecked, linksFound, errors };
}

/**
 * Records a point-in-time snapshot of the link profile. Called after each
 * verification pass so the dashboard can show real trends and flag lost links
 * instead of only ever showing current state.
 */
export function takeSnapshot(targetDomainInput = config.targetSite): void {
  const conn = ready();
  const targetDomain = registrableDomain(targetDomainInput) ?? targetDomainInput;

  const stats = conn
    .prepare<
      [string],
      {
        total: number;
        refdomains: number;
        live: number;
        lost: number;
        nofollow: number;
      }
    >(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT source_domain) AS refdomains,
              SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) AS live,
              SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost,
              SUM(CASE WHEN is_nofollow = 1 THEN 1 ELSE 0 END) AS nofollow
         FROM backlinks
        WHERE target_domain = ?`,
    )
    .get(targetDomain);

  if (!stats) return;

  // Median, not mean: one high-authority link should not drag the headline
  // number up and hide a profile that is otherwise weak. Computed in JS because
  // SQLite has no percentile function and the referring-domain count is small.
  const authorities = conn
    .prepare<[string], { authority: number }>(
      `SELECT d.authority
         FROM domains d
         JOIN (SELECT DISTINCT source_domain FROM backlinks
                WHERE target_domain = ? AND status != 'lost') b
           ON b.source_domain = d.domain
        WHERE d.authority IS NOT NULL
        ORDER BY d.authority`,
    )
    .all(targetDomain)
    .map((r) => r.authority);

  const medianAuthority = median(authorities);

  const toxicRow = conn
    .prepare<[string], { n: number }>(
      `SELECT COUNT(*) AS n
         FROM domains d
         JOIN (SELECT DISTINCT source_domain FROM backlinks
                WHERE target_domain = ? AND status != 'lost') b
           ON b.source_domain = d.domain
        WHERE d.spam_score >= 70`,
    )
    .get(targetDomain);

  conn
    .prepare(
      `INSERT INTO link_snapshots
         (target_domain, total_backlinks, referring_domains, live_backlinks,
          lost_backlinks, nofollow_ratio, median_authority, toxic_domains)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      targetDomain,
      stats.total,
      stats.refdomains,
      stats.live ?? 0,
      stats.lost ?? 0,
      stats.total > 0 ? (stats.nofollow ?? 0) / stats.total : 0,
      medianAuthority,
      toxicRow?.n ?? 0,
    );
}

/** Median of a pre-sorted numeric array, or null when empty. */
export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
