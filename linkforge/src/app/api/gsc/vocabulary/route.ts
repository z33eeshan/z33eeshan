import { z } from "zod";
import { config } from "@/lib/config";
import { fail, handler, ok, parseBody } from "@/lib/api";
import { getSetting, setSetting } from "@/lib/db";
import { isConnected, topicVocabulary } from "@/lib/providers/gsc";
import { fetchPage } from "@/lib/engine/fetcher";
import { parsePage } from "@/lib/engine/linkparser";
import { knownUrls } from "@/lib/providers/commoncrawl";
import { loadVocabulary, saveVocabulary, vocabularyFromText } from "@/lib/engine/relevance";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** "gsc" uses Search Console queries; "content" crawls your own site. */
  source: z.enum(["gsc", "content"]).default("gsc"),
  siteUrl: z.string().optional(),
  days: z.number().int().min(7).max(480).default(90),
  maxPages: z.number().int().min(3).max(100).default(30),
});

export const GET = handler(async () => {
  const vocab = loadVocabulary();
  return ok({
    source: vocab.source,
    updatedAt: vocab.updatedAt,
    terms: [...vocab.terms.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([term, weight]) => ({ term, weight })),
  });
});

/**
 * Rebuilds the topic vocabulary that drives relevance scoring.
 *
 * Search Console queries are the better source — they describe what the site
 * actually ranks for. Crawling your own content is the fallback when GSC is not
 * connected.
 */
export const POST = handler(async (req: Request) => {
  const opts = await parseBody(req, schema);

  if (opts.source === "gsc") {
    if (!isConnected()) {
      return fail("Search Console is not connected. Authorise it in Settings first.", 409);
    }
    const siteUrl = opts.siteUrl ?? getSetting("gsc_site_url");
    if (!siteUrl) {
      return fail(
        "No Search Console property selected. Choose one in Settings, or pass siteUrl.",
        422,
      );
    }
    const terms = await topicVocabulary(siteUrl, opts.days);
    if (terms.length === 0) {
      return fail(
        "Search Console returned no query data for that range. A new property may " +
          "have no data yet — try the 'content' source instead.",
        422,
      );
    }
    saveVocabulary(terms, "gsc");
    setSetting("gsc_site_url", siteUrl);
    return ok({ source: "gsc", terms: terms.length, top: terms.slice(0, 30) });
  }

  // Content fallback: crawl our own pages and TF-IDF them.
  const domain = config.targetSite;
  let urls: string[] = [];
  try {
    urls = await knownUrls(domain, { limit: opts.maxPages });
  } catch {
    urls = [];
  }
  if (urls.length === 0) urls = [`https://${domain}/`];

  const texts: string[] = [];
  for (const url of urls.slice(0, opts.maxPages)) {
    // Our own site, so robots.txt need not gate us here.
    const res = await fetchPage(url, { ignoreRobots: true, retries: 1 });
    if (!res.ok || !res.html) continue;
    const page = parsePage(res.html, res.finalUrl);
    if (page.wordCount > 80) texts.push(`${page.title ?? ""} ${page.bodyText}`);
  }

  if (texts.length === 0) {
    return fail(
      `Could not read any content from ${domain}. Check TARGET_SITE is correct and the site is reachable.`,
      422,
    );
  }

  const terms = vocabularyFromText(texts);
  saveVocabulary(terms, "content");
  return ok({ source: "content", pages: texts.length, terms: terms.length, top: terms.slice(0, 30) });
});
