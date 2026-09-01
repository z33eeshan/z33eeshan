import { config } from "@/lib/config";
import { handler, ok } from "@/lib/api";
import { analyseAnchors } from "@/lib/engine/anchors";
import { getSetting } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);

  const brandTerms = (url.searchParams.get("brands") ?? config.brandTerms.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Money keywords are what we compare anchors against for exact-match
  // detection. Configured in Settings, since only you know what the commercial
  // targets are.
  const stored = getSetting("money_keywords") ?? "";
  const moneyKeywords = (url.searchParams.get("keywords") ?? stored)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return ok({
    profile: analyseAnchors(config.targetSite, brandTerms, moneyKeywords),
    brandTerms,
    moneyKeywords,
  });
});
