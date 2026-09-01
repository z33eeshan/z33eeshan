import { handler, ok } from "@/lib/api";
import { listOutreach, pipelineStats, TEMPLATES, type Stage } from "@/lib/engine/outreach";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage") as Stage | null;
  return ok({
    records: listOutreach(stage ?? undefined),
    stats: pipelineStats(),
    templates: TEMPLATES.map((t) => ({
      id: t.id,
      kind: t.kind,
      label: t.label,
      rationale: t.rationale,
    })),
  });
});
