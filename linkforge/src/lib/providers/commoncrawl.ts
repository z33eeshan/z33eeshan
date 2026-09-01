import { config } from "@/lib/config";
import { normaliseUrl, registrableDomain } from "@/lib/engine/url";

/**
 * Common Crawl provider.
 *
 * Three distinct free resources, used for three different jobs:
 *
 *  1. CDX index (`index.commoncrawl.org`) — "what URLs does Common Crawl know
 *     about on this host?". Query by host or URL prefix. This is how we
 *     enumerate candidate pages on a prospect domain (resource pages, write-for-us
 *     pages, author pages) without crawling the whole site ourselves.
 *
 *  2. Host-level webgraph ranks — a downloadable file of harmonic centrality
 *     and PageRank for ~100M+ hosts. This is our free authority metric. It is
 *     the same class of signal that commercial "domain rating" scores are built
 *     from, computed on a real web-scale graph.
 *
 *  3. Host-level webgraph edges — who links to whom at host granularity.
 *     Large (tens of GB), so it is opt-in; the ranks file alone covers most of
 *     what a single-site workflow needs.
 *
 * Important limit, stated plainly: the CDX index is a URL index, not a link
 * graph. It cannot answer "who links to my site". For your own site GSC is the
 * authoritative answer; for competitors, the webgraph edges file or a paid
 * index is the honest route.
 */

const CDX_BASE = "https://index.commoncrawl.org";
const COLLINFO = `${CDX_BASE}/collinfo.json`;

export interface CdxRecord {
  urlkey: string;
  timestamp: string;
  url: string;
  mime: string | null;
  status: string;
  digest: string;
  length: string;
}

let indexCache: { ids: string[]; at: number } | null = null;
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

/** Available crawl collection ids, newest first (e.g. "CC-MAIN-2025-26"). */
export async function listCrawls(): Promise<string[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.ids;

  const res = await fetch(COLLINFO, {
    headers: { "user-agent": config.crawler.userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Common Crawl collinfo failed: HTTP ${res.status}`);

  const json = (await res.json()) as { id: string; name?: string }[];
  const ids = json.map((c) => c.id).filter(Boolean);
  indexCache = { ids, at: Date.now() };
  return ids;
}

export interface CdxQuery {
  /** Host, domain or URL prefix, e.g. "example.com" or "example.com/blog/*". */
  url: string;
  /** Crawl id. Defaults to the newest available. */
  crawl?: string;
  /** "domain" includes subdomains; "host" is exact; "prefix" for path globs. */
  matchType?: "exact" | "prefix" | "host" | "domain";
  limit?: number;
  /** Only successful HTML captures. Almost always what you want. */
  htmlOnly?: boolean;
}

export async function cdxQuery(q: CdxQuery): Promise<CdxRecord[]> {
  const crawl = q.crawl ?? (await listCrawls())[0];
  if (!crawl) throw new Error("No Common Crawl collections available.");

  const params = new URLSearchParams({
    url: q.url,
    output: "json",
    limit: String(q.limit ?? 500),
  });
  if (q.matchType) params.set("matchType", q.matchType);
  if (q.htmlOnly !== false) {
    params.append("filter", "=status:200");
    params.append("filter", "~mime:text/html");
  }

  const res = await fetch(`${CDX_BASE}/${crawl}-index?${params}`, {
    headers: { "user-agent": config.crawler.userAgent },
    signal: AbortSignal.timeout(60_000),
  });

  // The index returns 404 with a plain-text body when a host has no captures.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Common Crawl CDX failed: HTTP ${res.status}`);

  const text = await res.text();
  const out: CdxRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      const rec = JSON.parse(trimmed) as Partial<CdxRecord>;
      if (rec.url) out.push(rec as CdxRecord);
    } catch {
      // Skip malformed lines rather than failing the whole query.
    }
  }
  return out;
}

/**
 * Distinct page URLs Common Crawl has seen on a domain, newest capture first.
 * Used to enumerate a prospect's pages cheaply before we spend our own crawl
 * budget on them.
 */
export async function knownUrls(
  domain: string,
  opts: { limit?: number; crawls?: number; matchType?: CdxQuery["matchType"] } = {},
): Promise<string[]> {
  const host = registrableDomain(domain) ?? domain;
  const crawls = (await listCrawls()).slice(0, Math.max(1, opts.crawls ?? 1));
  const seen = new Set<string>();

  for (const crawl of crawls) {
    let records: CdxRecord[] = [];
    try {
      records = await cdxQuery({
        url: host,
        crawl,
        matchType: opts.matchType ?? "domain",
        limit: opts.limit ?? 500,
      });
    } catch {
      continue;
    }
    for (const r of records) {
      const n = normaliseUrl(r.url);
      if (n) seen.add(n);
      if (seen.size >= (opts.limit ?? 500)) return [...seen];
    }
  }
  return [...seen];
}

/**
 * Pages on a domain whose URL matches link-opportunity patterns. Runs entirely
 * against the free index — no crawling yet, so it is cheap to screen hundreds
 * of domains and only crawl the hits.
 */
export const OPPORTUNITY_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "resource_page", re: /\/(links?|resources?|useful|helpful|directory|blogroll)(\/|\.|$|-)/i },
  { kind: "guest_post", re: /\/(write-for-us|contribute|guest-post|submit|become-a|writers?)(\/|\.|$|-)/i },
  { kind: "resource_page", re: /\/(news-sources|media-list|press-links|recommended)(\/|\.|$|-)/i },
];

export function classifyUrlOpportunity(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  for (const { kind, re } of OPPORTUNITY_PATTERNS) {
    if (re.test(path)) return kind;
  }
  return null;
}

export async function findOpportunityPages(
  domain: string,
  limit = 300,
): Promise<{ url: string; kind: string }[]> {
  const urls = await knownUrls(domain, { limit });
  const out: { url: string; kind: string }[] = [];
  for (const url of urls) {
    const kind = classifyUrlOpportunity(url);
    if (kind) out.push({ url, kind });
  }
  return out;
}
