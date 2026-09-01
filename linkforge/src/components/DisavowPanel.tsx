"use client";

import { useState } from "react";
import { Badge, Card } from "@/components/ui";

interface PreviewEntry {
  scope: string;
  value: string;
  reason: string;
  spamScore: number;
}

/**
 * Disavow builder. Preview is mandatory before download — the file is a
 * destructive instruction to Google, and you should never upload one you cannot
 * justify line by line.
 */
export function DisavowPanel({
  disavowCount,
  reviewCount,
  allowlist: initialAllowlist,
}: {
  disavowCount: number;
  reviewCount: number;
  allowlist: string;
}) {
  const [minScore, setMinScore] = useState(70);
  const [includeReview, setIncludeReview] = useState(false);
  const [allowlist, setAllowlist] = useState(initialAllowlist);
  const [entries, setEntries] = useState<PreviewEntry[] | null>(null);
  const [content, setContent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowlistArray = allowlist
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/disavow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          minScore,
          includeReview,
          allowlist: allowlistArray,
          preview: true,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        entries?: PreviewEntry[];
        content?: string;
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "Preview failed.");
      setEntries(data.entries ?? []);
      setContent(data.content ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (
      !window.confirm(
        `Download a disavow file with ${entries?.length ?? 0} domain(s)?\n\n` +
          "Uploading this to Search Console tells Google to ignore these links. " +
          "Review every line first — a disavowed legitimate link loses its ranking " +
          "value, and recovery requires re-uploading and waiting for a recrawl.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/disavow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          minScore,
          includeReview,
          allowlist: allowlistArray,
          preview: false,
        }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "disavow.txt";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Disavow file builder"
      subtitle={`${disavowCount} domain(s) currently meet the disavow bar; ${reviewCount} more are borderline.`}
    >
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <strong className="font-semibold">Read before using.</strong> A disavow
        file is the one destructive action in this tool. It tells Google to ignore
        links, and there is no fast undo. Use it if you have a manual action for
        unnatural links, or you know links were bought or built manipulatively.
        Otherwise, leave it alone — Google already discounts obvious junk on its own.
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Minimum spam score
          </span>
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
          />
          <span className="text-[11px] text-ink-500">
            70 is the toxic band. Lowering this includes more domains — be careful.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Allowlist (never disavow)
          </span>
          <textarea
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            rows={3}
            placeholder="partner.com&#10;client-site.org"
            className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
          />
        </label>

        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeReview}
              onChange={(e) => setIncludeReview(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Also include &ldquo;review&rdquo; domains
              <span className="block text-[11px] text-ink-500">
                Wider net, higher chance of disavowing something legitimate.
              </span>
            </span>
          </label>

          <div className="mt-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void preview()}
              disabled={busy}
              className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50 dark:bg-ink-100 dark:text-ink-900"
            >
              {busy ? "Working…" : "Preview"}
            </button>
            <button
              type="button"
              onClick={() => void download()}
              disabled={busy || !entries || entries.length === 0}
              className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              Download disavow.txt
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-rose-700 dark:text-rose-400">{error}</p>
      )}

      {entries && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Preview</h3>
            <Badge tone={entries.length > 0 ? "warn" : "good"}>
              {entries.length} domain(s)
            </Badge>
          </div>

          {entries.length === 0 ? (
            <p className="text-xs text-ink-500">
              Nothing meets the bar at these settings. That is a good outcome, not an
              error.
            </p>
          ) : (
            <>
              <ul className="mb-3 max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-ink-200 p-3 dark:border-ink-800">
                {entries.map((e) => (
                  <li key={e.value} className="text-xs">
                    <code className="font-medium">domain:{e.value}</code>
                    <span className="ml-2 text-ink-500 dark:text-ink-400">{e.reason}</span>
                  </li>
                ))}
              </ul>
              <details>
                <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-700 dark:hover:text-ink-300">
                  View raw file contents
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink-100 p-3 text-[11px] leading-relaxed dark:bg-ink-950">
                  {content}
                </pre>
              </details>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
