import { config } from "@/lib/config";
import { ready } from "@/lib/db";
import { resolveAuthority } from "@/lib/providers/authority";
import { findOpportunityPages } from "@/lib/providers/commoncrawl";
import { parseManualSerp, serpProvider, type SerpResult } from "@/lib/providers/serp";
import { fetchPage } from "./fetcher";
import { findLinksTo, parsePage } from "./linkparser";
import {
  estimateDifficulty,
  loadVocabulary,
  prospectPriority,
  scoreRelevance,
} from "./relevance";
import { normaliseUrl, registrableDomain } from "./url";

export interface ProspectRow {
  url: string;
  domain: string;
  kind: string;
  title: string | null;
  evidence: Record<string, unknown>;
  authority: number | null;
  relevance: number | null;
  spamScore: number | null;
  difficulty: number | null;
  priority: number;
}

export function upsertProspects(rows: ProspectRow[]): { inserted: number; updated: number } {
  const conn = ready();
  const stmt = conn.prepare(
    `INSERT INTO prospects
       (url, domain, kind, title, evidence, authority, relevance, spam_score, difficulty, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET
       title      = COALESCE(excluded.title, prospects.title),
       evidence   = excluded.evidence,
       authority  = COALESCE(excluded.authority, prospects.authority),
       relevance  = COALESCE(excluded.relevance, prospects.relevance),
       spam_score = COALESCE(excluded.spam_score, prospects.spam_score),
       difficulty = COALESCE(excluded.difficulty, prospects.difficulty),
       priority   = excluded.priority`,
  );
  const upsertDomain = conn.prepare(
    "INSERT INTO domains (domain) VALUES (?) ON CONFLICT (domain) DO NOTHING",
  );

  let inserted = 0;
  let updated = 0;
  conn.transaction(() => {
    for (const r of rows) {
      upsertDomain.run(r.domain);
      const info = stmt.run(
        r.url,
        r.domain,
        r.kind,
        r.title,
        JSON.stringify(r.evidence),
        r.authority,
        r.relevance,
        r.spamScore,
        r.difficulty,
        r.priority,
      );
      if (info.changes > 0 && info.lastInsertRowid) inserted++;
      else updated++;
    }
  })();

  return { inserted, updated };
}

/** Domains we already have a link from — never a "gap". */
function existingReferringDomains(targetDomain: string): Set<string> {
  const rows = ready()
    .prepare<[string], { source_domain: string }>(
      `SELECT DISTINCT source_domain FROM backlinks
        WHERE target_domain = ? AND status != 'lost'`,
    )
    .all(targetDomain);
  return new Set(rows.map((r) => r.source_domain));
}

/**
 * Scores and stores a batch of candidate URLs as prospects.
 * Shared tail end of every discovery method below.
 */
async function qualify(
  candidates: { url: string; kind: string; evidence: Record<string, unknown>; title?: string | null }[],
  opts: { crawl?: boolean } = {},
): Promise<ProspectRow[]> {
  const vocab = loadVocabulary();
  const targetDomain = registrableDomain(config.targetSite) ?? config.targetSite;

  const deduped = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const url = normaliseUrl(c.url);
    if (!url) continue;
    const domain = registrableDomain(url);
    if (!domain || domain === targetDomain) continue;
    if (!deduped.has(url)) deduped.set(url, { ...c, url });
  }

  const list = [...deduped.values()];
  const domains = [...new Set(list.map((c) => registrableDomain(c.url)!))];
  const authorities = await resolveAuthority(domains);

  const spamRows = ready()
    .prepare<[], { domain: string; spam_score: number | null }>(
      "SELECT domain, spam_score FROM domains WHERE spam_score IS NOT NULL",
    )
    .all();
  const spamMap = new Map(spamRows.map((r) => [r.domain, r.spam_score]));

  const out: ProspectRow[] = [];

  for (const c of list) {
    const domain = registrableDomain(c.url)!;
    const authority = authorities.get(domain)?.score ?? null;

    let relevance: number | null = null;
    let title = c.title ?? null;
    let hasContact = false;

    // Crawling is the expensive step, so it is opt-in. Without it we still
    // rank on authority and whatever the SERP snippet gave us.
    if (opts.crawl) {
      const res = await fetchPage(c.url, { retries: 2 });
      if (res.ok && res.html) {
        const page = parsePage(res.html, res.finalUrl);
        title ??= page.title;
        hasContact = page.hasContactPage || page.emails.length > 0;
        const rel = scoreRelevance(page.bodyText, vocab, { title: page.title });
        relevance = rel.score;
        c.evidence.matchedTerms = rel.matchedTerms;
        c.evidence.wordCount = page.wordCount;
        c.evidence.externalLinks = page.externalLinkCount;

        // If we are looking at an unlinked mention, confirm it really is
        // unlinked before putting it in front of anyone.
        if (c.kind === "unlinked_mention") {
          const existing = findLinksTo(page, targetDomain);
          if (existing.length > 0) {
            c.evidence.alreadyLinked = true;
            continue;
          }
        }
      } else {
        c.evidence.fetchError = res.error ?? `HTTP ${res.status}`;
      }
    } else if (typeof c.evidence.snippet === "string") {
      const rel = scoreRelevance(String(c.evidence.snippet), vocab, { title });
      relevance = rel.score;
    }

    const spamScore = spamMap.get(domain) ?? null;
    const difficulty = estimateDifficulty({
      kind: c.kind,
      authority,
      hasContact,
      isUnlinkedMention: c.kind === "unlinked_mention",
    });

    out.push({
      url: c.url,
      domain,
      kind: c.kind,
      title,
      evidence: c.evidence,
      authority,
      relevance,
      spamScore,
      difficulty,
      priority: prospectPriority({ authority, relevance, spamScore, difficulty }),
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/**
 * Competitor link gap.
 *
 * Domains that link to a competitor but not to you. This is the highest-yield
 * prospecting method there is, because the site has already demonstrated it
 * will link to something in your niche.
 *
 * Requires competitor backlink data in the DB — via CSV import from any vendor
 * export, or a paid provider. With no competitor data present it returns an
 * empty result and says why, rather than pretending.
 */
export async function competitorGap(
  competitors: string[],
  opts: { crawl?: boolean; limit?: number } = {},
): Promise<{ prospects: ProspectRow[]; note: string }> {
  const targetDomain = registrableDomain(config.targetSite) ?? config.targetSite;
  const comps = competitors
    .map((c) => registrableDomain(c))
    .filter((c): c is string => Boolean(c));

  if (comps.length === 0) {
    return { prospects: [], note: "No competitors configured. Add them in Settings." };
  }

  const mine = existingReferringDomains(targetDomain);
  const placeholders = comps.map(() => "?").join(",");

  const rows = ready()
    .prepare<string[], { source_domain: string; comps: number; links: number }>(
      `SELECT source_domain,
              COUNT(DISTINCT target_domain) AS comps,
              COUNT(*) AS links
         FROM backlinks
        WHERE target_domain IN (${placeholders})
          AND status != 'lost'
        GROUP BY source_domain
        ORDER BY comps DESC, links DESC`,
    )
    .all(...comps);

  if (rows.length === 0) {
    return {
      prospects: [],
      note:
        "No competitor backlink data in the database yet. Import a competitor " +
        "backlink CSV (Settings → Import), or connect a paid backlink provider. " +
        "Common Crawl's URL index cannot answer 'who links to this domain'.",
    };
  }

  const gaps = rows
    .filter((r) => !mine.has(r.source_domain) && r.source_domain !== targetDomain)
    .slice(0, opts.limit ?? 200);

  const candidates = gaps.map((g) => ({
    url: `https://${g.source_domain}/`,
    kind: "competitor_gap",
    title: null,
    evidence: {
      linksToCompetitors: g.comps,
      totalCompetitorLinks: g.links,
      reason: `Links to ${g.comps} of your ${comps.length} competitors but not to you`,
    } as Record<string, unknown>,
  }));

  const prospects = await qualify(candidates, { crawl: opts.crawl });
  upsertProspects(prospects);

  return {
    prospects,
    note: `${gaps.length} referring domain(s) link to competitors but not to you.`,
  };
}

/**
 * Unlinked brand mentions.
 *
 * Pages that name your brand without linking to you. The easiest link there is:
 * the editorial decision to mention you has already been made, so you are only
 * asking for an attribution link.
 */
export async function unlinkedMentions(opts: {
  brandTerms?: string[];
  manualUrls?: string;
  limit?: number;
}): Promise<{ prospects: ProspectRow[]; note: string }> {
  const terms = (opts.brandTerms ?? config.brandTerms).filter(Boolean);
  if (terms.length === 0) {
    return { prospects: [], note: "No brand terms configured. Add them in Settings." };
  }

  let results: SerpResult[] = [];
  let note = "";

  if (opts.manualUrls?.trim()) {
    results = parseManualSerp(opts.manualUrls);
    note = `${results.length} URL(s) imported manually.`;
  } else {
    const provider = serpProvider();
    if (!provider.available) {
      return {
        prospects: [],
        note:
          "No SERP provider configured. Either set SERP_PROVIDER=brave with a free " +
          "BRAVE_SEARCH_API_KEY, or run the suggested search in a browser and paste " +
          "the result URLs into the manual import box.",
      };
    }
    for (const term of terms.slice(0, 5)) {
      try {
        const found = await provider.search(`"${term}" -site:${config.targetSite}`, {
          count: 20,
        });
        results.push(...found);
      } catch (err) {
        note = err instanceof Error ? err.message : String(err);
      }
    }
    note ||= `${results.length} result(s) from ${provider.name}.`;
  }

  const targetDomain = registrableDomain(config.targetSite) ?? config.targetSite;
  const candidates = results
    .filter((r) => r.domain && r.domain !== targetDomain)
    .slice(0, opts.limit ?? 100)
    .map((r) => ({
      url: r.url,
      kind: "unlinked_mention",
      title: r.title || null,
      evidence: {
        snippet: r.snippet,
        serpRank: r.rank,
        reason: "Mentions your brand — verify whether the mention is linked",
      } as Record<string, unknown>,
    }));

  // Crawling is forced on here: the whole claim is "this page mentions you and
  // does NOT link to you", and we must not assert that without checking.
  const prospects = await qualify(candidates, { crawl: true });
  upsertProspects(prospects);

  return { prospects, note };
}

/**
 * Resource pages and contribution pages on a set of seed domains, discovered
 * through the free Common Crawl URL index.
 */
export async function resourcePages(
  seedDomains: string[],
  opts: { crawl?: boolean; perDomain?: number } = {},
): Promise<{ prospects: ProspectRow[]; note: string }> {
  const candidates: Parameters<typeof qualify>[0] = [];
  const errors: string[] = [];

  for (const seed of seedDomains.slice(0, 25)) {
    const domain = registrableDomain(seed);
    if (!domain) continue;
    try {
      const hits = await findOpportunityPages(domain, opts.perDomain ?? 200);
      for (const h of hits) {
        candidates.push({
          url: h.url,
          kind: h.kind,
          title: null,
          evidence: {
            reason:
              h.kind === "guest_post"
                ? "URL matches a contribution/write-for-us pattern"
                : "URL matches a resource/links page pattern",
            discoveredVia: "commoncrawl-index",
          },
        });
      }
    } catch (err) {
      errors.push(`${domain}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const prospects = await qualify(candidates, { crawl: opts.crawl });
  upsertProspects(prospects);

  const note =
    candidates.length === 0
      ? "No matching pages found in the Common Crawl index for those domains."
      : `${candidates.length} candidate page(s) found across ${seedDomains.length} seed domain(s).`;

  return { prospects, note: errors.length > 0 ? `${note} Errors: ${errors.join("; ")}` : note };
}

/**
 * Broken outbound links on a page you could replace with your own content.
 * Crawls the page, tests every external link, and reports the dead ones.
 */
export async function brokenLinkOpportunities(
  pageUrl: string,
): Promise<{ url: string; deadLinks: { url: string; status: number; anchor: string }[] }> {
  const res = await fetchPage(pageUrl, { retries: 2 });
  if (!res.ok || !res.html) {
    return { url: pageUrl, deadLinks: [] };
  }

  const page = parsePage(res.html, res.finalUrl);
  const pageDomain = registrableDomain(res.finalUrl);
  const external = page.links.filter((l) => registrableDomain(l.href) !== pageDomain);

  const dead: { url: string; status: number; anchor: string }[] = [];
  for (const link of external.slice(0, 100)) {
    const check = await fetchPage(link.href, { method: "HEAD", retries: 1 });
    // Only 404/410 count. A 403 usually means the host blocked our HEAD, not
    // that the page is gone, and reporting those as broken wastes your time.
    if (check.status === 404 || check.status === 410) {
      dead.push({ url: link.href, status: check.status, anchor: link.anchorText });
    }
  }

  if (dead.length > 0) {
    const prospects = await qualify(
      [
        {
          url: res.finalUrl,
          kind: "broken_link",
          title: page.title,
          evidence: {
            deadLinks: dead,
            reason: `${dead.length} dead outbound link(s) you could offer a replacement for`,
          },
        },
      ],
      { crawl: false },
    );
    upsertProspects(prospects);
  }

  return { url: res.finalUrl, deadLinks: dead };
}
