import { z } from "zod";
import { config } from "@/lib/config";
import { handler, ok, parseBody } from "@/lib/api";
import { buildDisavow, persistDisavow } from "@/lib/engine/disavow";
import { auditReferringDomains } from "@/lib/engine/spam";

export const dynamic = "force-dynamic";

const schema = z.object({
  minScore: z.number().min(0).max(100).default(70),
  includeReview: z.boolean().default(false),
  allowlist: z.array(z.string()).default([]),
  /** Preview only. Nothing is recorded as exported unless this is false. */
  preview: z.boolean().default(true),
  siteLanguage: z.string().default("en"),
});

/**
 * Preview is the default and `download` must be asked for explicitly, because a
 * disavow file is a destructive instruction to Google — see the header comment
 * in lib/engine/disavow.ts.
 */
export const POST = handler(async (req: Request) => {
  const opts = await parseBody(req, schema);
  const assessments = auditReferringDomains(config.targetSite, opts.siteLanguage);
  const file = buildDisavow(assessments, {
    minScore: opts.minScore,
    includeReview: opts.includeReview,
    allowlist: opts.allowlist,
  });

  if (opts.preview) {
    return ok({
      preview: true,
      stats: file.stats,
      entries: file.entries,
      content: file.content,
    });
  }

  persistDisavow(file.entries);

  return new Response(file.content, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": 'attachment; filename="disavow.txt"',
    },
  });
});
