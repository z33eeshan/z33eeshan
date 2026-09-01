import { z } from "zod";
import { config, featureAvailability } from "@/lib/config";
import { handler, ok, parseBody } from "@/lib/api";
import { getSetting, setSetting } from "@/lib/db";
import { isConnected } from "@/lib/providers/gsc";
import { ranksTableSize } from "@/lib/providers/authority";
import { loadVocabulary } from "@/lib/engine/relevance";

export const dynamic = "force-dynamic";

const EDITABLE = [
  "money_keywords",
  "competitors",
  "brand_terms",
  "disavow_allowlist",
  "site_language",
  "gsc_site_url",
  "sender_name",
] as const;

export const GET = handler(async () => {
  const stored: Record<string, string> = {};
  for (const key of EDITABLE) stored[key] = getSetting(key) ?? "";

  const vocab = loadVocabulary();

  return ok({
    env: {
      targetSite: config.targetSite,
      brandTerms: config.brandTerms,
      competitors: config.competitors,
      crawlerUserAgent: config.crawler.userAgent,
      hostDelayMs: config.crawler.hostDelayMs,
      concurrency: config.crawler.concurrency,
      serpProvider: config.serp.provider,
    },
    stored,
    features: featureAvailability(),
    gscConnected: isConnected(),
    ranksRows: ranksTableSize(),
    vocabulary: {
      source: vocab.source,
      terms: vocab.terms.size,
      updatedAt: vocab.updatedAt,
      top: [...vocab.terms.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([term, weight]) => ({ term, weight })),
    },
  });
});

const patchSchema = z.record(z.enum(EDITABLE), z.string().max(4000));

export const PATCH = handler(async (req: Request) => {
  const updates = await parseBody(req, patchSchema);
  for (const [key, value] of Object.entries(updates)) setSetting(key, value);
  return ok({ updated: Object.keys(updates) });
});
