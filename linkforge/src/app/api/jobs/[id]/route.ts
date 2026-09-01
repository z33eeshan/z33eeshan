import { fail, handler, ok } from "@/lib/api";
import { getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const GET = handler(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const job = getJob(Number.parseInt(id, 10));
    return job ? ok({ job }) : fail("Job not found", 404);
  },
);
