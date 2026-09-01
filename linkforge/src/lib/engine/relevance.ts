import { getSetting, setSetting } from "@/lib/db";
import { tokenise } from "@/lib/providers/gsc";

/**
 * Topical relevance scoring.
 *
 * Relevance beats authority for link value, and it is the thing cheap link
 * building always gets wrong: a DA-60 link from a gambling blog does a news
 * site less good than a DA-25 link from a regional news outlet. So every
 * prospect gets scored against the target site's actual topic vocabulary.
 *
 * The vocabulary comes from Search Console query data when connected (what the
 * site really ranks for), and falls back to the site's own crawled content.
 */

export interface Vocabulary {
  terms: Map<string, number>;
  source: "gsc" | "content" | "manual" | "empty";
  updatedAt: string;
}

const VOCAB_KEY = "topic_vocabulary";

export function saveVocabulary(
  terms: { term: string; weight: number }[],
  source: Vocabulary["source"],
): void {
  setSetting(
    VOCAB_KEY,
    JSON.stringify({ terms, source, updatedAt: new Date().toISOString() }),
  );
}

export function loadVocabulary(): Vocabulary {
  const raw = getSetting(VOCAB_KEY);
  if (!raw) return { terms: new Map(), source: "empty", updatedAt: "" };
  try {
    const parsed = JSON.parse(raw) as {
      terms: { term: string; weight: number }[];
      source: Vocabulary["source"];
      updatedAt: string;
    };
    return {
      terms: new Map(parsed.terms.map((t) => [t.term, t.weight])),
      source: parsed.source,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { terms: new Map(), source: "empty", updatedAt: "" };
  }
}

/** Builds a vocabulary from raw page text — the fallback when GSC isn't linked. */
export function vocabularyFromText(texts: string[]): { term: string; weight: number }[] {
  const df = new Map<string, number>();
  const tf = new Map<string, number>();

  for (const text of texts) {
    const tokens = tokenise(text);
    const seen = new Set<string>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
  }

  const n = Math.max(1, texts.length);
  // TF-IDF, so boilerplate that appears on every page (nav labels, the site
  // name, "cookie policy") does not dominate the topic model.
  //
  // Term frequency is averaged over the documents that actually contain the
  // term, not summed across the corpus. Summing rewards exactly what IDF is
  // meant to punish: a nav label appearing once on all 30 pages scored 30,
  // beating a genuine topic term appearing 5 times in one article.
  const scored = [...tf.entries()].map(([term, freq]) => {
    const docs = df.get(term) ?? 1;
    const avgTf = freq / docs;
    const idf = Math.log(1 + n / (1 + docs));
    return { term, weight: avgTf * idf };
  });

  const max = Math.max(1, ...scored.map((s) => s.weight));
  return scored
    .map((s) => ({ term: s.term, weight: s.weight / max }))
    .filter((s) => s.weight > 0.02)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 400);
}

export interface RelevanceResult {
  score: number; // 0-100
  matchedTerms: string[];
  coverage: number;
}

/**
 * Scores a candidate page's text against the vocabulary.
 *
 * Uses weighted overlap rather than raw term count so that matching a few
 * high-signal topic terms scores better than matching many marginal ones.
 */
export function scoreRelevance(
  text: string,
  vocab: Vocabulary,
  opts: { title?: string | null } = {},
): RelevanceResult {
  if (vocab.terms.size === 0) {
    return { score: 0, matchedTerms: [], coverage: 0 };
  }

  const tokens = new Set(tokenise(text));
  // Title terms count double: a page titled for our topic is more relevant
  // than one that merely mentions it in passing.
  const titleTokens = new Set(opts.title ? tokenise(opts.title) : []);

  let matchedWeight = 0;
  let totalWeight = 0;
  const matched: { term: string; weight: number }[] = [];

  for (const [term, weight] of vocab.terms) {
    totalWeight += weight;
    const inBody = tokens.has(term);
    const inTitle = titleTokens.has(term);
    if (!inBody && !inTitle) continue;
    const boost = inTitle ? 2 : 1;
    matchedWeight += weight * boost;
    matched.push({ term, weight: weight * boost });
  }

  if (totalWeight === 0) return { score: 0, matchedTerms: [], coverage: 0 };

  const coverage = matchedWeight / totalWeight;
  // A page matching ~25% of the weighted vocabulary is strongly on-topic;
  // scale so that lands near 100 rather than 25.
  const score = Math.min(100, Math.round(coverage * 400 * 10) / 10);

  return {
    score,
    matchedTerms: matched
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 15)
      .map((m) => m.term),
    coverage,
  };
}

/**
 * Composite prospect priority.
 *
 * Weighting rationale: relevance is weighted highest because an irrelevant link
 * is worth little regardless of authority; difficulty is subtracted because a
 * perfect prospect you will never win is worth less than a good one you will;
 * spam is a hard penalty because chasing a link from a toxic domain is actively
 * counterproductive.
 */
export function prospectPriority(input: {
  authority: number | null;
  relevance: number | null;
  spamScore: number | null;
  difficulty: number | null;
}): number {
  const authority = input.authority ?? 20;
  const relevance = input.relevance ?? 30;
  const spam = input.spamScore ?? 0;
  const difficulty = input.difficulty ?? 50;

  const value = relevance * 0.45 + authority * 0.35;
  const cost = difficulty * 0.2;
  const spamPenalty = spam >= 45 ? spam * 0.8 : spam * 0.25;

  return Math.max(0, Math.min(100, Math.round((value - cost - spamPenalty) * 10) / 10));
}

/**
 * How hard this link is likely to be to win. Rough, but directionally right:
 * an existing "write for us" page is an open door; a high-authority news site
 * with no submission route is not.
 */
export function estimateDifficulty(input: {
  kind: string;
  authority: number | null;
  hasContact: boolean;
  isUnlinkedMention: boolean;
}): number {
  let d = 50;

  switch (input.kind) {
    case "unlinked_mention":
      // Someone already wrote about you; you are asking for an attribution fix.
      d -= 25;
      break;
    case "guest_post":
      d -= 15;
      break;
    case "resource_page":
      d -= 5;
      break;
    case "broken_link":
      d -= 10;
      break;
    case "competitor_gap":
      d += 5;
      break;
  }

  const authority = input.authority ?? 20;
  // Authority raises difficulty non-linearly: the top of the web is much harder
  // to reach than the middle.
  d += (authority / 100) ** 1.5 * 45;

  if (!input.hasContact) d += 15;
  if (input.isUnlinkedMention) d -= 5;

  return Math.max(1, Math.min(100, Math.round(d)));
}
