import crypto from "node:crypto";
import pLimit from "p-limit";
import { config } from "@/lib/config";
import { ready } from "@/lib/db";
import { crawlDelayFor, isAllowed, parseRobots, type RobotsRules } from "./robots";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  html: string | null;
  contentType: string | null;
  contentHash: string | null;
  etag: string | null;
  lastModified: string | null;
  redirected: boolean;
  fromCache: boolean;
  elapsedMs: number;
  error: string | null;
  /** Set when robots.txt forbids the URL. We record it rather than fetching. */
  blockedByRobots: boolean;
}

const globalLimit = pLimit(Math.max(1, config.crawler.concurrency));

/** Last request time per host, so we can space same-host requests out. */
const lastHitAt = new Map<string, number>();
/** Serialises the delay bookkeeping per host. */
const hostChain = new Map<string, Promise<void>>();

const robotsMemo = new Map<string, RobotsRules | null>();
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000;

const HTML_TYPES = /(text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml)/i;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Waits until this host is allowed another request, then stamps it. Chaining
 * per host keeps the delay honest under concurrency — without it, N parallel
 * tasks all read the same stale timestamp and fire at once.
 */
async function throttleHost(host: string, delayMs: number): Promise<void> {
  const prior = hostChain.get(host) ?? Promise.resolve();
  const next = prior.then(async () => {
    const last = lastHitAt.get(host) ?? 0;
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastHitAt.set(host, Date.now());
  });
  hostChain.set(
    host,
    next.catch(() => undefined),
  );
  return next;
}

async function loadRobots(origin: string): Promise<RobotsRules | null> {
  if (robotsMemo.has(origin)) return robotsMemo.get(origin) ?? null;

  const conn = ready();
  const cached = conn
    .prepare<[string], { fetched_at: string; body: string | null }>(
      "SELECT fetched_at, body FROM robots_cache WHERE origin = ?",
    )
    .get(origin);

  if (cached && Date.now() - Date.parse(`${cached.fetched_at}Z`) < ROBOTS_TTL_MS) {
    const rules = cached.body ? parseRobots(cached.body) : null;
    robotsMemo.set(origin, rules);
    return rules;
  }

  let body: string | null = null;
  let status = 0;
  try {
    const host = new URL(origin).host;
    await throttleHost(host, config.crawler.hostDelayMs);
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": config.crawler.userAgent },
      signal: AbortSignal.timeout(config.crawler.timeoutMs),
      redirect: "follow",
    });
    status = res.status;
    // 4xx means "no restrictions"; 5xx means unknown, and we treat unknown as
    // permissive-with-slow-crawl rather than blocking the whole domain.
    body = res.ok ? (await res.text()).slice(0, 500_000) : null;
  } catch {
    body = null;
  }

  conn
    .prepare(
      `INSERT INTO robots_cache (origin, fetched_at, body, http_status)
       VALUES (?, datetime('now'), ?, ?)
       ON CONFLICT (origin) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         body = excluded.body,
         http_status = excluded.http_status`,
    )
    .run(origin, body, status);

  const rules = body ? parseRobots(body) : null;
  robotsMemo.set(origin, rules);
  return rules;
}

/**
 * Reads at most `maxBytes` from the body, then aborts. Link-analysis pages are
 * small; a 200 MB response is either a mistake or a trap.
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      chunks.push(value);
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)), Math.min(total, maxBytes));
  return buf.toString("utf8");
}

export interface FetchOptions {
  /** Skip the robots.txt check. Only for fetching your OWN site. */
  ignoreRobots?: boolean;
  /** Use a conditional request when we have a stored validator. */
  revalidate?: boolean;
  method?: "GET" | "HEAD";
  retries?: number;
}

export async function fetchPage(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const started = Date.now();
  const base: FetchResult = {
    url: rawUrl,
    finalUrl: rawUrl,
    status: 0,
    ok: false,
    html: null,
    contentType: null,
    contentHash: null,
    etag: null,
    lastModified: null,
    redirected: false,
    fromCache: false,
    elapsedMs: 0,
    error: null,
    blockedByRobots: false,
  };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ...base, error: "invalid-url", elapsedMs: Date.now() - started };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ...base, error: "unsupported-scheme", elapsedMs: Date.now() - started };
  }

  const origin = parsed.origin;
  const host = parsed.host;

  let hostDelay = config.crawler.hostDelayMs;
  if (!opts.ignoreRobots) {
    const rules = await loadRobots(origin);
    if (rules) {
      if (!isAllowed(rules, config.crawler.userAgent, rawUrl)) {
        return {
          ...base,
          blockedByRobots: true,
          error: "blocked-by-robots",
          elapsedMs: Date.now() - started,
        };
      }
      const declared = crawlDelayFor(rules, config.crawler.userAgent);
      // Honour a site's declared delay when it asks for more than our default.
      if (declared) hostDelay = Math.max(hostDelay, declared * 1000);
    }
  }

  const conn = ready();
  const cached = opts.revalidate
    ? conn
        .prepare<[string], { etag: string | null; last_modified: string | null }>(
          "SELECT etag, last_modified FROM fetch_cache WHERE url = ?",
        )
        .get(rawUrl)
    : undefined;

  const attempts = Math.max(1, opts.retries ?? 3);

  const run = async (): Promise<FetchResult> => {
    let lastError = "unknown";

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
      await throttleHost(host, hostDelay);

      const headers: Record<string, string> = {
        "user-agent": config.crawler.userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      };
      if (cached?.etag) headers["if-none-match"] = cached.etag;
      if (cached?.last_modified) headers["if-modified-since"] = cached.last_modified;

      try {
        const res = await fetch(rawUrl, {
          method: opts.method ?? "GET",
          headers,
          redirect: "follow",
          signal: AbortSignal.timeout(config.crawler.timeoutMs),
        });

        const contentType = res.headers.get("content-type");
        const result: FetchResult = {
          ...base,
          finalUrl: res.url || rawUrl,
          status: res.status,
          ok: res.ok,
          contentType,
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          redirected: (res.url || rawUrl) !== rawUrl,
          fromCache: res.status === 304,
          elapsedMs: Date.now() - started,
        };

        if (res.status === 304) {
          await res.body?.cancel().catch(() => undefined);
          recordFetch(result);
          return result;
        }

        // 429/503 are "come back later", so they are worth a retry. Other 4xx
        // are a definitive answer and retrying just wastes the host's time.
        if (res.status === 429 || res.status === 503) {
          await res.body?.cancel().catch(() => undefined);
          lastError = `http-${res.status}`;
          const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
          if (Number.isFinite(retryAfter)) {
            await sleep(Math.min(retryAfter * 1000, 30_000));
          }
          continue;
        }

        if (opts.method === "HEAD" || !res.ok) {
          await res.body?.cancel().catch(() => undefined);
          recordFetch(result);
          return result;
        }

        if (contentType && !HTML_TYPES.test(contentType)) {
          await res.body?.cancel().catch(() => undefined);
          result.error = "non-html";
          recordFetch(result);
          return result;
        }

        const html = await readCapped(res, config.crawler.maxBytes);
        result.html = html;
        result.contentHash = crypto
          .createHash("sha1")
          .update(html)
          .digest("hex");
        result.elapsedMs = Date.now() - started;
        recordFetch(result);
        return result;
      } catch (err) {
        lastError =
          err instanceof Error
            ? err.name === "TimeoutError"
              ? "timeout"
              : err.message
            : String(err);
      }
    }

    const failed = { ...base, error: lastError, elapsedMs: Date.now() - started };
    recordFetch(failed);
    return failed;
  };

  return globalLimit(run);
}

function recordFetch(r: FetchResult): void {
  try {
    ready()
      .prepare(
        `INSERT INTO fetch_cache (url, fetched_at, http_status, etag, last_modified, content_hash, error)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?)
         ON CONFLICT (url) DO UPDATE SET
           fetched_at = excluded.fetched_at,
           http_status = excluded.http_status,
           etag = COALESCE(excluded.etag, fetch_cache.etag),
           last_modified = COALESCE(excluded.last_modified, fetch_cache.last_modified),
           content_hash = COALESCE(excluded.content_hash, fetch_cache.content_hash),
           error = excluded.error`,
      )
      .run(r.url, r.status || null, r.etag, r.lastModified, r.contentHash, r.error);
  } catch {
    // Cache bookkeeping must never break a crawl.
  }
}

/** Map a batch of URLs through the fetcher under the global concurrency cap. */
export async function fetchAll(
  urls: string[],
  opts: FetchOptions = {},
  onResult?: (r: FetchResult, index: number) => void,
): Promise<FetchResult[]> {
  return Promise.all(
    urls.map(async (u, i) => {
      const r = await fetchPage(u, opts);
      onResult?.(r, i);
      return r;
    }),
  );
}
