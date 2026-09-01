import { z } from "zod";
import { fail, handler, ok, parseBody } from "@/lib/api";
import { ready } from "@/lib/db";
import { advanceStage, STAGES } from "@/lib/engine/outreach";

export const dynamic = "force-dynamic";

const schema = z.object({
  stage: z.enum(STAGES as [string, ...string[]]).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().max(20_000).optional(),
  wonUrl: z.string().url().optional(),
  notes: z.string().max(4000).optional(),
});

export const PATCH = handler(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const outreachId = Number.parseInt(id, 10);
    if (!Number.isFinite(outreachId)) return fail("Invalid outreach id", 400);

    const input = await parseBody(req, schema);
    const conn = ready();

    const exists = conn
      .prepare<[number], { id: number }>("SELECT id FROM outreach WHERE id = ?")
      .get(outreachId);
    if (!exists) return fail("Outreach record not found", 404);

    if (input.subject !== undefined || input.body !== undefined) {
      conn
        .prepare(
          `UPDATE outreach
              SET subject = COALESCE(?, subject),
                  body = COALESCE(?, body),
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
        .run(input.subject ?? null, input.body ?? null, outreachId);
    }

    if (input.stage) {
      advanceStage(outreachId, input.stage as Parameters<typeof advanceStage>[1], {
        wonUrl: input.wonUrl,
        notes: input.notes,
      });
    }

    return ok({ outreachId });
  },
);
