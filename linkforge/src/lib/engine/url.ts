import psl from "psl";

/**
 * Registrable domain ("example.co.uk", not "news.example.co.uk").
 *
 * Referring-DOMAIN counts are the metric that matters in link analysis — 400
 * links from one site is one vote, not 400 — so every table in this app keys
 * on this rather than on hostname.
 */
export function registrableDomain(input: string): string | null {
  const host = toHostname(input);
  if (!host) return null;

  // Check IPs before psl: it reads "192.168.1.1" as a domain under the TLD "1"
  // and returns "1.1", which would silently merge every IP-hosted source into
  // one bogus domain.
  if (isIpHost(host)) return host;

  // psl returns null for unlisted TLDs (intranet names); fall back to the bare
  // host so those sources cluster consistently instead of vanishing.
  const parsed = psl.get(host);
  return (parsed ?? host).toLowerCase();
}

/** True for IPv4 dotted-quad and bracketed-or-bare IPv6 hosts. */
export function isIpHost(host: string): boolean {
  if (/^\[?[0-9a-f:]+\]?$/i.test(host) && host.includes(":")) return true;
  const quad = host.split(".");
  return (
    quad.length === 4 &&
    quad.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

export function toHostname(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.hostname.replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
  "_ga",
  "yclid",
  "igshid",
]);

/**
 * Canonical form used as the dedupe key for URLs. Two URLs that differ only by
 * tracking params, fragment, default port, trailing slash or param order are
 * the same page for our purposes.
 */
export function normaliseUrl(input: string, base?: string): string | null {
  if (!input) return null;
  let u: URL;
  try {
    u = new URL(input, base);
  } catch {
    return null;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  if (
    (u.protocol === "https:" && u.port === "443") ||
    (u.protocol === "http:" && u.port === "80")
  ) {
    u.port = "";
  }

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.searchParams.sort();

  // Collapse "/path/" and "/path" but keep a bare "/" for the root.
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  u.pathname = u.pathname.replace(/\/{2,}/g, "/");

  return u.toString();
}

export function sameDomain(a: string, b: string): boolean {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return da !== null && da === db;
}

/**
 * Public-suffix bucket, e.g. "co.uk" for "bbc.co.uk". Used by the spam scorer:
 * some suffixes carry far more abuse than others.
 */
export function publicSuffix(input: string): string | null {
  const host = toHostname(input);
  if (!host) return null;
  const parsed = psl.parse(host);
  return "tld" in parsed ? (parsed.tld ?? null) : null;
}

/** Path depth, where "https://x.com/" is 0 and "https://x.com/a/b" is 2. */
export function pathDepth(url: string): number {
  try {
    const p = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    return p === "" ? 0 : p.split("/").length;
  } catch {
    return 0;
  }
}

export function isHomepage(url: string): boolean {
  return pathDepth(url) === 0;
}
