import { config } from "@/lib/config";
import { handler, intParam, ok } from "@/lib/api";
import { auditReferringDomains } from "@/lib/engine/spam";
import { referringDomains } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET returns the stored audit; `?rescore=1` recomputes it first. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const minSpam = intParam(url.searchParams.get("minSpam"), 0, { max: 100 });
  const limit = intParam(url.searchParams.get("limit"), 200, { min: 1, max: 2000 });

  if (url.searchParams.get("rescore") === "1") {
    const siteLanguage = url.searchParams.get("lang") ?? "en";
    const assessments = auditReferringDomains(config.targetSite, siteLanguage);
    return ok({
      rescored: true,
      counts: {
        total: assessments.length,
        disavow: assessments.filter((a) => a.recommendation === "disavow").length,
        review: assessments.filter((a) => a.recommendation === "review").length,
        monitor: assessments.filter((a) => a.recommendation === "monitor").length,
        keep: assessments.filter((a) => a.recommendation === "keep").length,
      },
      assessments: assessments.slice(0, limit),
    });
  }

  return ok({ rescored: false, domains: referringDomains(config.targetSite, { minSpam, limit }) });
});
