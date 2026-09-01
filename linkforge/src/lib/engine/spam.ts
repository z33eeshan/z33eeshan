import { ready } from "@/lib/db";
import { pathDepth, publicSuffix, registrableDomain } from "./url";

/**
 * Toxicity scoring for referring domains.
 *
 * Design principles, learned from how link penalties actually work:
 *
 *  - No single signal condemns a domain. Real editorial sites trip individual
 *    signals all the time (a legitimate news site has a high outbound link
 *    count; a legitimate directory has "links" in its URLs). Only a cluster of
 *    signals is meaningful, so scoring is additive with diminishing returns.
 *
 *  - Weights reflect how strongly each signal correlates with manual actions,
 *    not how easy it is to compute. Anchor-text manipulation and PBN footprints
 *    are the signals that get sites penalised; a .xyz TLD on its own is not.
 *
 *  - Every score carries its reasons. A disavow file is a destructive
 *    instruction to Google — you should never submit one you cannot explain
 *    domain by domain, so the UI shows the exact signals behind each entry.
 */

export interface SpamSignal {
  id: string;
  label: string;
  weight: number;
  detail?: string;
}

export interface SpamAssessment {
  domain: string;
  score: number; // 0-100
  band: "clean" | "low" | "medium" | "high" | "toxic";
  signals: SpamSignal[];
  recommendation: "keep" | "monitor" | "review" | "disavow";
}

export interface DomainFacts {
  domain: string;
  /** Authority 0-100, null if unknown. */
  authority: number | null;
  /** Distinct pages on this domain that link to us. */
  linkingPages: number;
  /** Total links from this domain to us. */
  totalLinks: number;
  /** Fraction of those links that are followed. */
  followRatio: number;
  /** Distinct anchor texts used. */
  anchorTexts: string[];
  /** Link positions observed. */
  positions: string[];
  /** Outbound external links counted on the linking page(s). */
  outboundLinkCount: number | null;
  /** `lang` attribute of the linking page. */
  language: string | null;
  /** Our own site's primary language, for mismatch detection. */
  siteLanguage: string;
  /** Page title of the linking page, if crawled. */
  title: string | null;
  /** Word count of the linking page. */
  wordCount: number | null;
  /** HTTP status last seen. */
  httpStatus: number | null;
  /** Whether the linking page allows indexing. */
  isIndexable: boolean | null;
  /** Path depth of the linking pages. */
  avgPathDepth: number;
  /** Other domains sharing this domain's IP network, if known. */
  networkNeighbours: number;
}

// Suffixes with disproportionate abuse rates. Low weight on purpose: plenty of
// legitimate sites use cheap TLDs, so this only matters alongside other signals.
const RISKY_SUFFIXES = new Set([
  "xyz", "top", "loan", "work", "click", "link", "bid", "win", "review",
  "country", "stream", "gdn", "mom", "party", "trade", "date", "kim",
  "racing", "download", "accountant", "science", "cricket", "faith", "zip",
]);

const SPAM_TITLE_TERMS = [
  "casino", "poker", "slot", "betting", "escort", "viagra", "cialis",
  "payday loan", "porn", "xxx", "replica", "counterfeit", "essay writing",
  "buy backlinks", "seo services cheap", "crypto giveaway", "hacked",
];

// Footprints of the CMS templates that private blog networks are built from.
const PBN_TITLE_PATTERNS = [
  /^(just another|my blog|blog|home)$/i,
  /just another wordpress site/i,
  /^(untitled|new site|test site|index of)/i,
];

const MONEY_ANCHOR_TERMS = [
  "buy", "cheap", "discount", "coupon", "best price", "for sale", "order now",
  "casino", "loan", "insurance", "crypto", "betting", "free download",
];

/** Shannon entropy of the domain label. Random strings score high. */
export function labelEntropy(domain: string): number {
  const label = domain.split(".")[0] ?? domain;
  if (label.length < 4) return 0;
  const freq = new Map<string, number>();
  for (const ch of label) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / label.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Fraction of anchors that are the same string. A natural link profile has
 * varied anchors dominated by brand and bare URLs; a manipulated one repeats an
 * exact-match commercial phrase.
 */
export function anchorConcentration(anchors: string[]): number {
  const real = anchors.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (real.length < 2) return 0;
  const counts = new Map<string, number>();
  for (const a of real) counts.set(a, (counts.get(a) ?? 0) + 1);
  return Math.max(...counts.values()) / real.length;
}

export function assessDomain(facts: DomainFacts): SpamAssessment {
  const signals: SpamSignal[] = [];
  const domain = facts.domain;
  const suffix = publicSuffix(domain);

  // --- Link pattern signals (strongest predictors) -------------------------

  if (facts.linkingPages >= 10 && facts.followRatio > 0.9) {
    const sitewide = facts.positions.filter((p) => p === "footer" || p === "sidebar" || p === "nav").length;
    const ratio = facts.positions.length > 0 ? sitewide / facts.positions.length : 0;
    if (ratio > 0.6) {
      signals.push({
        id: "sitewide_footer",
        label: "Sitewide footer/sidebar link",
        weight: 22,
        detail: `${Math.round(ratio * 100)}% of ${facts.linkingPages} linking pages place the link in a footer, nav or sidebar`,
      });
    }
  }

  const concentration = anchorConcentration(facts.anchorTexts);
  if (facts.anchorTexts.length >= 3 && concentration > 0.8) {
    signals.push({
      id: "anchor_concentration",
      label: "Repeated exact-match anchor",
      weight: 18,
      detail: `${Math.round(concentration * 100)}% of anchors are identical`,
    });
  }

  const moneyAnchor = facts.anchorTexts.find((a) =>
    MONEY_ANCHOR_TERMS.some((t) => a.toLowerCase().includes(t)),
  );
  if (moneyAnchor) {
    signals.push({
      id: "money_anchor",
      label: "Commercial anchor text",
      weight: 14,
      detail: `Anchor contains a transactional term: "${moneyAnchor.slice(0, 80)}"`,
    });
  }

  if (facts.outboundLinkCount != null && facts.outboundLinkCount > 100) {
    signals.push({
      id: "link_farm",
      label: "Excessive outbound links",
      weight: facts.outboundLinkCount > 300 ? 20 : 12,
      detail: `${facts.outboundLinkCount} external links on the linking page`,
    });
  }

  // --- Page quality signals ----------------------------------------------

  if (facts.wordCount != null && facts.wordCount < 150 && facts.outboundLinkCount != null && facts.outboundLinkCount > 20) {
    signals.push({
      id: "thin_link_page",
      label: "Thin page, mostly links",
      weight: 16,
      detail: `${facts.wordCount} words but ${facts.outboundLinkCount} external links`,
    });
  }

  if (facts.isIndexable === false) {
    signals.push({
      id: "noindex",
      label: "Linking page is noindex",
      weight: 10,
      detail: "Google will not count a link from a page it is told not to index",
    });
  }

  if (facts.title && PBN_TITLE_PATTERNS.some((re) => re.test(facts.title!))) {
    signals.push({
      id: "pbn_footprint",
      label: "Default CMS title (PBN footprint)",
      weight: 20,
      detail: `Title is "${facts.title}" — an unconfigured template install`,
    });
  }

  const badTerm = facts.title
    ? SPAM_TITLE_TERMS.find((t) => facts.title!.toLowerCase().includes(t))
    : undefined;
  if (badTerm) {
    signals.push({
      id: "adult_gambling_pharma",
      label: "Adult / gambling / pharma content",
      weight: 25,
      detail: `Linking page title mentions "${badTerm}"`,
    });
  }

  // --- Domain-level signals ----------------------------------------------

  if (facts.authority != null && facts.authority < 5 && facts.linkingPages >= 5) {
    signals.push({
      id: "zero_authority_bulk",
      label: "Many links from a near-zero-authority domain",
      weight: 15,
      detail: `Authority ${facts.authority.toFixed(1)}/100 across ${facts.linkingPages} pages`,
    });
  }

  if (suffix && RISKY_SUFFIXES.has(suffix)) {
    signals.push({
      id: "risky_tld",
      label: `High-abuse TLD (.${suffix})`,
      weight: 6,
      detail: "Weak on its own; meaningful combined with other signals",
    });
  }

  const entropy = labelEntropy(domain);
  if (entropy > 3.6) {
    signals.push({
      id: "random_domain",
      label: "Machine-generated domain name",
      weight: 10,
      detail: `Character entropy ${entropy.toFixed(2)} — typical of auto-registered domains`,
    });
  }

  if (
    facts.language &&
    facts.siteLanguage &&
    !facts.language.startsWith(facts.siteLanguage.slice(0, 2))
  ) {
    signals.push({
      id: "language_mismatch",
      label: "Foreign-language site",
      weight: 8,
      detail: `Linking page is "${facts.language}", your site is "${facts.siteLanguage}"`,
    });
  }

  if (facts.networkNeighbours >= 5) {
    signals.push({
      id: "network_cluster",
      label: "Shares hosting with other linking domains",
      weight: 14,
      detail: `${facts.networkNeighbours} other referring domains on the same network`,
    });
  }

  if (facts.httpStatus != null && facts.httpStatus >= 400) {
    signals.push({
      id: "dead_source",
      label: "Linking page is dead",
      weight: 5,
      detail: `HTTP ${facts.httpStatus}`,
    });
  }

  if (facts.avgPathDepth >= 5 && facts.linkingPages >= 3) {
    signals.push({
      id: "deep_orphan_pages",
      label: "Links buried deep in the site",
      weight: 5,
      detail: `Average path depth ${facts.avgPathDepth.toFixed(1)}`,
    });
  }

  // --- Mitigating evidence ------------------------------------------------
  // A genuinely strong domain should not be flagged for weak signals alone.
  if (facts.authority != null && facts.authority >= 45) {
    signals.push({
      id: "established_authority",
      label: "Established, high-authority domain",
      weight: -25,
      detail: `Authority ${facts.authority.toFixed(1)}/100`,
    });
  }
  if (facts.positions.includes("content") && facts.linkingPages <= 3) {
    signals.push({
      id: "editorial_placement",
      label: "In-content editorial link",
      weight: -12,
      detail: "Placed in article body, not a template region",
    });
  }
  if (facts.wordCount != null && facts.wordCount > 600) {
    signals.push({
      id: "substantive_page",
      label: "Substantive page content",
      weight: -8,
      detail: `${facts.wordCount} words`,
    });
  }

  const score = combine(signals);
  const band = bandFor(score);

  return {
    domain,
    score,
    band,
    signals: signals.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    recommendation:
      // Disavow is reserved for the top band AND multiple independent positive
      // signals. Disavowing on one signal is how people delete good links.
      band === "toxic" && signals.filter((s) => s.weight > 8).length >= 2
        ? "disavow"
        : band === "high"
          ? "review"
          : band === "medium"
            ? "monitor"
            : "keep",
  };
}

/**
 * Additive with diminishing returns: each successive signal contributes less,
 * so five weak signals cannot outrank one decisive one, and the score cannot
 * run away past 100.
 */
export function combine(signals: SpamSignal[]): number {
  const positive = signals.filter((s) => s.weight > 0).sort((a, b) => b.weight - a.weight);
  const negative = signals.filter((s) => s.weight < 0).reduce((a, s) => a + s.weight, 0);

  let score = 0;
  positive.forEach((s, i) => {
    score += s.weight * 0.8 ** i;
  });

  // Mitigating evidence tempers a score; it must not erase one. Left uncapped,
  // "in-content placement" plus "long page" cancelled a gambling-content hit
  // down to near zero — but a well-written in-content link from a casino site
  // is still a link from a casino site. Cap the total credit at half the
  // positive subtotal.
  const maxRelief = score * 0.5;
  score += Math.max(negative, -maxRelief);

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

export function bandFor(score: number): SpamAssessment["band"] {
  if (score >= 70) return "toxic";
  if (score >= 45) return "high";
  if (score >= 25) return "medium";
  if (score >= 10) return "low";
  return "clean";
}

/**
 * Builds DomainFacts for every referring domain from what is already in the DB,
 * then scores them. Runs entirely on stored data — no network — so it is fast
 * to re-run after each crawl pass.
 */
export function auditReferringDomains(
  targetDomainInput: string,
  siteLanguage = "en",
): SpamAssessment[] {
  const conn = ready();
  const targetDomain = registrableDomain(targetDomainInput) ?? targetDomainInput;

  const rows = conn
    .prepare<
      [string],
      {
        source_domain: string;
        linking_pages: number;
        total_links: number;
        follow_links: number;
        anchors: string | null;
        positions: string | null;
        source_urls: string | null;
        authority: number | null;
        outbound: number | null;
        language: string | null;
        title: string | null;
        http_status: number | null;
        is_indexable: number | null;
        ip_hash: string | null;
      }
    >(
      `SELECT b.source_domain,
              COUNT(DISTINCT b.source_url)                 AS linking_pages,
              COUNT(*)                                     AS total_links,
              SUM(CASE WHEN b.is_nofollow = 0 THEN 1 ELSE 0 END) AS follow_links,
              GROUP_CONCAT(COALESCE(b.anchor_text, ''), CHAR(31)) AS anchors,
              GROUP_CONCAT(COALESCE(b.link_position, 'unknown'), CHAR(31)) AS positions,
              GROUP_CONCAT(b.source_url, CHAR(31))         AS source_urls,
              d.authority, d.outbound_link_count AS outbound, d.language, d.title,
              d.http_status, d.is_indexable, d.ip_hash
         FROM backlinks b
         LEFT JOIN domains d ON d.domain = b.source_domain
        WHERE b.target_domain = ?
          AND b.status != 'lost'
        GROUP BY b.source_domain`,
    )
    .all(targetDomain);

  // Count referring domains per hosting network so the clustering signal has
  // something real behind it.
  const networkCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.ip_hash) networkCounts.set(r.ip_hash, (networkCounts.get(r.ip_hash) ?? 0) + 1);
  }

  // GROUP_CONCAT above joins on CHAR(31), the ASCII unit separator, so
  // anchor text containing commas survives the round trip intact.
  // GROUP_CONCAT above joins on CHAR(31), the ASCII unit separator, so
  // anchor text containing commas survives the round trip intact.
  const split = (s: string | null): string[] =>
    s ? s.split("\u001f").filter((x) => x !== "") : [];

  const assessments = rows.map((r) => {
    const urls = split(r.source_urls);
    const depths = urls.map(pathDepth);
    const facts: DomainFacts = {
      domain: r.source_domain,
      authority: r.authority,
      linkingPages: r.linking_pages,
      totalLinks: r.total_links,
      followRatio: r.total_links > 0 ? r.follow_links / r.total_links : 0,
      anchorTexts: split(r.anchors),
      positions: split(r.positions),
      outboundLinkCount: r.outbound,
      language: r.language,
      siteLanguage,
      title: r.title,
      wordCount: null,
      httpStatus: r.http_status,
      isIndexable: r.is_indexable == null ? null : r.is_indexable === 1,
      avgPathDepth: depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0,
      networkNeighbours: r.ip_hash ? (networkCounts.get(r.ip_hash) ?? 1) - 1 : 0,
    };
    return assessDomain(facts);
  });

  // Persist so the dashboard and disavow builder read consistent numbers.
  const write = conn.prepare(
    `INSERT INTO domains (domain, spam_score, spam_signals)
     VALUES (?, ?, ?)
     ON CONFLICT (domain) DO UPDATE SET
       spam_score = excluded.spam_score,
       spam_signals = excluded.spam_signals`,
  );
  const tx = conn.transaction(() => {
    for (const a of assessments) {
      write.run(a.domain, a.score, JSON.stringify(a.signals.map((s) => s.id)));
    }
  });
  tx();

  return assessments.sort((a, b) => b.score - a.score);
}
