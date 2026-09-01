import { config } from "@/lib/config";
import { fail, handler, ok } from "@/lib/api";
import { importBacklinkCsv } from "@/lib/providers/import";
import { registrableDomain } from "@/lib/engine/url";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Accepts a backlink CSV, either as multipart/form-data (file upload) or as a
 * raw text body. The `target` field lets you import a COMPETITOR's backlinks
 * as well as your own — that is what powers link-gap analysis.
 */
export const POST = handler(async (req: Request) => {
  const contentType = req.headers.get("content-type") ?? "";
  let csv = "";
  let target = config.targetSite;
  let via = "import";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("No file uploaded under the 'file' field.", 400);
    if (file.size > MAX_BYTES) {
      return fail(`File is ${Math.round(file.size / 1e6)} MB; limit is 25 MB.`, 413);
    }
    csv = await file.text();
    const t = form.get("target");
    if (typeof t === "string" && t.trim()) target = t.trim();
    const v = form.get("via");
    if (typeof v === "string" && v.trim()) via = v.trim();
  } else {
    csv = await req.text();
    const url = new URL(req.url);
    target = url.searchParams.get("target")?.trim() || target;
    via = url.searchParams.get("via")?.trim() || via;
  }

  if (!csv.trim()) return fail("Empty CSV body.", 400);
  if (csv.length > MAX_BYTES) return fail("CSV too large; limit is 25 MB.", 413);

  const normalisedTarget = registrableDomain(target);
  if (!normalisedTarget) return fail(`Could not parse target domain: ${target}`, 422);

  const summary = importBacklinkCsv(csv, normalisedTarget, via);
  return ok({ summary });
});
