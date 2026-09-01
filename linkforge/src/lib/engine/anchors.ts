import { ready } from "@/lib/db";
import { registrableDomain, toHostname } from "./url";

/**
 * Anchor text profile analysis.
 *
 * Anchor distribution is the single most legible fingerprint of manipulated
 * link building. A profile earned editorially skews heavily toward brand names,
 * bare URLs and "click here"-style generic text, because that is how humans
 * actually cite things. A built profile skews toward keyword-rich exact-match
 * anchors, because that is what someone optimising for a keyword asks for.
 *
 * The healthy ranges below are drawn from what natural profiles look like, not
 * from a formula Google publishes — Google publishes no such numbers. Treat
 * them as a "this looks unusual, go look" flag, not a compliance target.
 */

export type AnchorType =
  | "brand"
  | "naked_url"
  | "generic"
  | "exact_match"
  | "partial_match"
  | "image"
  | "empty"
  | "other";

export interface AnchorBucket {
  type: AnchorType;
  count: number;
  share: number;
  examples: string[];
  healthyRange: [number, number];
  verdict: "healthy" | "low" | "high";
}

export interface AnchorProfile {
  totalLinks: number;
  buckets: AnchorBucket[];
  /** Anchors used far more than any other, a manipulation tell. */
  overusedAnchors: { anchor: string; count: number; share: number }[];
  warnings: string[];
}

const GENERIC_ANCHORS = new Set([
  "click here", "here", "this", "read more", "more", "link", "this link",
  "website", "site", "this site", "source", "via", "learn more", "see more",
  "continue reading", "full story", "full article", "read the full story",
  "check it out", "visit", "visit site", "homepage", "article", "report",
]);

// What a naturally-earned profile tends to look like. Wide on purpose.
const HEALTHY: Record<AnchorType, [number, number]> = {
  brand: [0.3, 0.85],
  naked_url: [0.05, 0.4],
  generic: [0.05, 0.35],
  exact_match: [0, 0.08],
  partial_match: [0, 0.2],
  image: [0, 0.2],
  empty: [0, 0.1],
  other: [0, 0.3],
};

export function classifyAnchor(
  anchorRaw: string | null,
  targetDomain: string,
  brandTerms: string[],
  moneyKeywords: string[],
): AnchorType {
  const anchor = (anchorRaw ?? "").trim();
  if (anchor === "") return "empty";
  if (anchor.startsWith("[img]")) return "image";

  const lower = anchor.toLowerCase();

  // Naked URL: the anchor is the link itself.
  if (/^https?:\/\//i.test(lower) || /^www\./i.test(lower)) return "naked_url";
  const host = toHostname(lower);
  const target = registrableDomain(targetDomain);
  if (host && target && host === target) return "naked_url";

  const brands = brandTerms
    .map((b) => b.trim().toLowerCase())
    .filter((b) => b.length >= 3);
  // Bare domain label counts as brand ("livenewsof" for livenewsof.com).
  const domainLabel = target?.split(".")[0]?.toLowerCase();
  if (domainLabel && domainLabel.length >= 3) brands.push(domainLabel);

  if (brands.some((b) => lower.includes(b))) return "brand";
  if (GENERIC_ANCHORS.has(lower)) return "generic";

  const keywords = moneyKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (keywords.length > 0) {
    if (keywords.some((k) => lower === k)) return "exact_match";
    if (keywords.some((k) => lower.includes(k))) return "partial_match";
  }

  return "other";
}

export function analyseAnchors(
  targetDomainInput: string,
  brandTerms: string[],
  moneyKeywords: string[] = [],
): AnchorProfile {
  const targetDomain = registrableDomain(targetDomainInput) ?? targetDomainInput;

  const rows = ready()
    .prepare<[string], { anchor_text: string | null; n: number }>(
      `SELECT anchor_text, COUNT(*) AS n
         FROM backlinks
        WHERE target_domain = ? AND status != 'lost'
        GROUP BY anchor_text
        ORDER BY n DESC`,
    )
    .all(targetDomain);

  const totalLinks = rows.reduce((a, r) => a + r.n, 0);

  const counts = new Map<AnchorType, { count: number; examples: string[] }>();
  for (const r of rows) {
    const type = classifyAnchor(r.anchor_text, targetDomain, brandTerms, moneyKeywords);
    const entry = counts.get(type) ?? { count: 0, examples: [] };
    entry.count += r.n;
    if (entry.examples.length < 5 && r.anchor_text?.trim()) {
      entry.examples.push(r.anchor_text.trim().slice(0, 80));
    }
    counts.set(type, entry);
  }

  const buckets: AnchorBucket[] = (Object.keys(HEALTHY) as AnchorType[]).map((type) => {
    const entry = counts.get(type) ?? { count: 0, examples: [] };
    const share = totalLinks > 0 ? entry.count / totalLinks : 0;
    const [lo, hi] = HEALTHY[type];
    return {
      type,
      count: entry.count,
      share,
      examples: entry.examples,
      healthyRange: [lo, hi],
      // Only flag "low" for brand anchors — being under-represented in
      // exact-match anchors is a good thing, not a problem to fix.
      verdict: share > hi ? "high" : type === "brand" && share < lo ? "low" : "healthy",
    };
  });

  const overusedAnchors = rows
    .filter((r) => r.anchor_text?.trim())
    .map((r) => ({
      anchor: r.anchor_text!.trim(),
      count: r.n,
      share: totalLinks > 0 ? r.n / totalLinks : 0,
    }))
    .filter((a) => a.share > 0.15 && a.count >= 5)
    .slice(0, 10);

  const warnings: string[] = [];
  if (totalLinks < 20) {
    warnings.push(
      `Only ${totalLinks} links analysed — anchor ratios are not meaningful below ~50 links.`,
    );
  }
  const exact = buckets.find((b) => b.type === "exact_match");
  if (exact && exact.verdict === "high") {
    warnings.push(
      `Exact-match anchors are ${(exact.share * 100).toFixed(1)}% of the profile. ` +
        "Above ~8% is the pattern manual reviewers look for.",
    );
  }
  const brand = buckets.find((b) => b.type === "brand");
  if (brand && brand.verdict === "low" && totalLinks >= 50) {
    warnings.push(
      `Brand anchors are only ${(brand.share * 100).toFixed(1)}% of the profile. ` +
        "Naturally-earned profiles are usually brand-dominant.",
    );
  }
  for (const a of overusedAnchors) {
    warnings.push(
      `"${a.anchor.slice(0, 60)}" accounts for ${(a.share * 100).toFixed(1)}% of all anchors (${a.count} links).`,
    );
  }

  return { totalLinks, buckets, overusedAnchors, warnings };
}
