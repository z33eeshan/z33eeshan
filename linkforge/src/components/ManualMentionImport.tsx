"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

/**
 * Manual SERP import — the zero-cost path for finding unlinked mentions.
 *
 * Run the brand search in a browser, copy the result URLs, paste them here. The
 * crawler then verifies each one actually mentions you WITHOUT linking, so the
 * claim is checked rather than assumed.
 */
export function ManualMentionImport() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const urlCount = text.split(/[\s,]+/).filter((t) => /^https?:\/\//i.test(t)).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "find_unlinked_mentions",
          payload: { manualUrls: text, limit: 100 },
        }),
      });
      const data = (await res.json()) as { ok: boolean; jobId?: number; error?: string };
      if (!data.ok || !data.jobId) throw new Error(data.error ?? "Could not start.");

      // Poll to completion so the user sees the verified count, not just "queued".
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const jr = await fetch(`/api/jobs/${data.jobId}`, { cache: "no-store" });
        const jd = (await jr.json()) as {
          ok: boolean;
          job?: { status: string; message: string | null; error: string | null };
        };
        if (!jd.ok || !jd.job) break;
        if (jd.job.status === "done") {
          setResult(jd.job.message ?? "Done.");
          setText("");
          router.refresh();
          break;
        }
        if (jd.job.status === "failed") {
          setError(jd.job.error ?? "Job failed.");
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Paste SERP results"
      subtitle="No API key needed. Run a brand search, paste the URLs, and the crawler verifies which mentions are unlinked."
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"https://example.com/article-mentioning-you\nhttps://another.com/roundup"}
        className="w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-xs dark:border-ink-700 dark:bg-ink-950"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-ink-500">
          {urlCount} URL{urlCount === 1 ? "" : "s"} detected
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || urlCount === 0}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50 dark:bg-ink-100 dark:text-ink-900"
        >
          {busy ? "Verifying…" : "Import & verify"}
        </button>
      </div>
      {result && (
        <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-400">{result}</p>
      )}
      {error && <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-400">{error}</p>}
    </Card>
  );
}
