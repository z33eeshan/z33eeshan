import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/api";
import { enqueue, kickRunner, listJobs, type JobKind } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const KINDS = [
  "verify_backlinks",
  "discover_linking_pages",
  "audit_domains",
  "resolve_authority",
  "find_competitor_gaps",
  "find_unlinked_mentions",
  "find_resource_pages",
  "discover_contacts",
  "snapshot",
] as const satisfies readonly JobKind[];

const bodySchema = z.object({
  kind: z.enum(KINDS),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const GET = handler(async () => ok({ jobs: listJobs(30) }));

export const POST = handler(async (req: Request) => {
  const { kind, payload } = await parseBody(req, bodySchema);
  const id = enqueue(kind, payload);
  // Start work immediately in dev; a standalone worker will also pick this up.
  kickRunner();
  return ok({ jobId: id }, 202);
});
