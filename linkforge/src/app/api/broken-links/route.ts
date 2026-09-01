import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/api";
import { brokenLinkOpportunities } from "@/lib/engine/prospect";

export const dynamic = "force-dynamic";

const schema = z.object({ url: z.string().url() });

/**
 * Finds dead outbound links on a page you could offer a replacement for.
 * Synchronous because it is scoped to one page; the batch version runs as a job.
 */
export const POST = handler(async (req: Request) => {
  const { url } = await parseBody(req, schema);
  const result = await brokenLinkOpportunities(url);
  return ok({
    ...result,
    note:
      result.deadLinks.length === 0
        ? "No dead outbound links found (only 404/410 count — a 403 usually means the host blocked the check)."
        : `${result.deadLinks.length} dead outbound link(s) found.`,
  });
});
