import { z } from "zod";
import { fail, handler, ok, parseBody } from "@/lib/api";
import { ready } from "@/lib/db";
import { createDraft } from "@/lib/engine/outreach";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z
    .enum(["new", "qualified", "rejected", "queued", "contacted", "won", "lost"])
    .optional(),
  notes: z.string().max(4000).optional(),
  /** Create an outreach draft for this prospect. */
  draft: z.boolean().optional(),
  contactId: z.number().int().positive().optional(),
});

export const PATCH = handler(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const prospectId = Number.parseInt(id, 10);
    if (!Number.isFinite(prospectId)) return fail("Invalid prospect id", 400);

    const body = await parseBody(req, patchSchema);
    const conn = ready();

    const exists = conn
      .prepare<[number], { id: number }>("SELECT id FROM prospects WHERE id = ?")
      .get(prospectId);
    if (!exists) return fail("Prospect not found", 404);

    if (body.status || body.notes !== undefined) {
      conn
        .prepare(
          `UPDATE prospects
              SET status = COALESCE(?, status),
                  notes = COALESCE(?, notes),
                  reviewed_at = datetime('now')
            WHERE id = ?`,
        )
        .run(body.status ?? null, body.notes ?? null, prospectId);
    }

    let outreachId: number | null = null;
    if (body.draft) {
      outreachId = createDraft(prospectId, body.contactId ?? null);
    }

    return ok({ prospectId, outreachId });
  },
);
