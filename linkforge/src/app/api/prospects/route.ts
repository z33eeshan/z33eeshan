import { handler, intParam, ok } from "@/lib/api";
import { prospects } from "@/lib/queries";
import { toCsv } from "@/lib/engine/csv";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const result = prospects({
    kind: url.searchParams.get("kind") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    minPriority: intParam(url.searchParams.get("minPriority"), 0, { max: 100 }),
    limit: intParam(url.searchParams.get("limit"), 100, { min: 1, max: 1000 }),
    offset: intParam(url.searchParams.get("offset"), 0),
  });

  if (url.searchParams.get("format") === "csv") {
    const csv = toCsv([
      ["url", "domain", "kind", "title", "authority", "relevance", "spam_score", "difficulty", "priority", "status", "contacts", "reason"],
      ...result.rows.map((r) => [
        r.url,
        r.domain,
        r.kind,
        r.title,
        r.authority,
        r.relevance,
        r.spamScore,
        r.difficulty,
        r.priority,
        r.status,
        r.contactCount,
        typeof r.evidence.reason === "string" ? r.evidence.reason : "",
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="prospects.csv"',
      },
    });
  }

  return ok(result);
});
