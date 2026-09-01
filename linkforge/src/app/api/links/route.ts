import { handler, intParam, ok } from "@/lib/api";
import { backlinks } from "@/lib/queries";
import { toCsv } from "@/lib/engine/csv";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const result = backlinks({
    status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("q") ?? undefined,
    minAuthority: intParam(url.searchParams.get("minAuthority"), 0, { max: 100 }),
    limit: intParam(url.searchParams.get("limit"), 100, { min: 1, max: 1000 }),
    offset: intParam(url.searchParams.get("offset"), 0),
    sort: (url.searchParams.get("sort") as "authority" | "spam" | "recent" | null) ?? "authority",
  });

  if (url.searchParams.get("format") === "csv") {
    const csv = toCsv([
      [
        "source_url",
        "source_domain",
        "target_url",
        "anchor_text",
        "nofollow",
        "sponsored",
        "ugc",
        "position",
        "status",
        "authority",
        "spam_score",
        "discovered_via",
        "first_seen",
        "last_verified",
      ],
      ...result.rows.map((r) => [
        r.sourceUrl,
        r.sourceDomain,
        r.targetUrl,
        r.anchorText,
        r.isNofollow ? "yes" : "no",
        r.isSponsored ? "yes" : "no",
        r.isUgc ? "yes" : "no",
        r.position,
        r.status,
        r.authority,
        r.spamScore,
        r.discoveredVia,
        r.firstSeen,
        r.lastVerified,
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="backlinks.csv"',
      },
    });
  }

  return ok(result);
});
