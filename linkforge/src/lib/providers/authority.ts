import { config } from "@/lib/config";
import { ready } from "@/lib/db";
import { registrableDomain } from "@/lib/engine/url";

/**
 * Authority scoring, 0-100.
 *
 * Two free sources, tried in order:
 *
 *  1. `domain_ranks` — populated by `npm run ranks:import` from the Common
 *     Crawl host-level webgraph. Harmonic centrality is the signal here, and
 *     it is a genuinely good authority proxy: it is the same family of measure
 *     commercial DR/DA scores approximate, computed over a real web graph.
 *
 *  2. OpenPageRank — free API key, 1000 domains/day, returns a 0-10 score we
 *     rescale. Good as a fallback and for domains missing from the ranks file.
 *
 * Both are estimates. Treat a 20-point difference as meaningful and a 3-point
 * difference as noise — that is true of every authority metric on the market,
 * including the paid ones.
 */

export interface AuthorityResult {
  domain: string;
  score: number | null;
  source: "commoncrawl" | "openpagerank" | "unknown";
}

export function authorityFromRanks(domain: string): AuthorityResult {
  const d = registrableDomain(domain) ?? domain;
  const row = ready()
    .prepare<[string], { normalised: number | null }>(
      "SELECT normalised FROM domain_ranks WHERE domain = ?",
    )
    .get(d);
  return row?.normalised != null
    ? { domain: d, score: row.normalised, source: "commoncrawl" }
    : { domain: d, score: null, source: "unknown" };
}

/**
 * Harmonic centrality rank position -> 0-100 score.
 *
 * Rank positions are power-law distributed, so a linear mapping would put
 * almost every real site in the bottom 2 points. A log mapping spreads the
 * mid-range where prospecting decisions actually get made.
 */
export function normaliseRankPosition(position: number, totalHosts: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  const total = Math.max(position, totalHosts, 2);
  const score = 100 * (1 - Math.log10(position) / Math.log10(total));
  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

const OPR_ENDPOINT = "https://openpagerank.com/api/v1.0/getPageRank";

/** OpenPageRank accepts up to 100 domains per call. */
export async function authorityFromOpenPageRank(
  domains: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!config.openPageRankKey || domains.length === 0) return out;

  const unique = [...new Set(domains.map((d) => registrableDomain(d) ?? d))];

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const params = new URLSearchParams();
    for (const d of batch) params.append("domains[]", d);

    try {
      const res = await fetch(`${OPR_ENDPOINT}?${params}`, {
        headers: {
          "API-OPR": config.openPageRankKey,
          "user-agent": config.crawler.userAgent,
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        response?: { domain?: string; page_rank_decimal?: number; status_code?: number }[];
      };
      for (const r of json.response ?? []) {
        if (!r.domain || r.status_code !== 200) continue;
        const raw = r.page_rank_decimal ?? 0;
        // OpenPageRank is 0-10; rescale to our 0-100 space.
        out.set(r.domain.toLowerCase(), Math.round(raw * 10 * 10) / 10);
      }
    } catch {
      // A provider outage should degrade the score, not fail the analysis.
    }
  }
  return out;
}

/**
 * Resolves authority for a set of domains and caches it on the domains table.
 * Ranks file first (free, unlimited, local), OpenPageRank for the misses.
 */
export async function resolveAuthority(
  domains: string[],
): Promise<Map<string, AuthorityResult>> {
  const conn = ready();
  const results = new Map<string, AuthorityResult>();
  const missing: string[] = [];

  for (const raw of domains) {
    const d = registrableDomain(raw) ?? raw;
    if (results.has(d)) continue;
    const local = authorityFromRanks(d);
    if (local.score != null) results.set(d, local);
    else missing.push(d);
  }

  if (missing.length > 0 && config.openPageRankKey) {
    const opr = await authorityFromOpenPageRank(missing);
    for (const d of missing) {
      const score = opr.get(d);
      results.set(
        d,
        score != null
          ? { domain: d, score, source: "openpagerank" }
          : { domain: d, score: null, source: "unknown" },
      );
    }
  } else {
    for (const d of missing) results.set(d, { domain: d, score: null, source: "unknown" });
  }

  const write = conn.prepare(
    `INSERT INTO domains (domain, authority, authority_source)
     VALUES (?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET
       authority = excluded.authority,
       authority_source = excluded.authority_source`,
  );
  const tx = conn.transaction(() => {
    for (const r of results.values()) {
      if (r.score != null) write.run(r.domain, r.score, r.source);
    }
  });
  tx();

  return results;
}

export function ranksTableSize(): number {
  const row = ready()
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM domain_ranks")
    .get();
  return row?.n ?? 0;
}
