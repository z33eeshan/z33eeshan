"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

interface Summary {
  rowsRead: number;
  backlinksInserted: number;
  backlinksUpdated: number;
  domainsSeen: number;
  skipped: number;
  detectedFormat: string;
  warnings: string[];
}

/**
 * Backlink CSV import.
 *
 * The `target` field is the important one: importing a COMPETITOR's backlinks
 * under their own domain is what makes link-gap analysis possible.
 */
export function ImportPanel({ targetSite }: { targetSite: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState(targetSite);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("target", target);
      form.set("via", target === targetSite ? "gsc-export" : "competitor-import");

      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = (await res.json()) as {
        ok: boolean;
        summary?: Summary;
        error?: string;
      };
      if (!data.ok || !data.summary) throw new Error(data.error ?? "Import failed.");
      setSummary(data.summary);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Import backlinks"
      subtitle="Search Console links export, or any Ahrefs / Semrush / Moz backlink export."
    >
      <ol className="mb-4 space-y-1.5 text-xs text-ink-600 dark:text-ink-400">
        <li>
          1. Open Search Console → <strong>Links</strong> → &ldquo;Top linking
          sites&rdquo; → <strong>Export</strong> → Download CSV.
        </li>
        <li>
          2. Upload it below with the target set to your own domain. Column layouts
          are detected automatically.
        </li>
        <li>
          3. To enable link-gap analysis, repeat with a competitor&rsquo;s backlink
          export and set the target to <em>their</em> domain.
        </li>
      </ol>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
            CSV file
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-ink-900 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white dark:file:bg-ink-100 dark:file:text-ink-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
            These links point to
          </span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-48 rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
          />
        </label>
        <button
          type="button"
          onClick={() => void upload()}
          disabled={busy}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50 dark:bg-ink-100 dark:text-ink-900"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-rose-700 dark:text-rose-400">{error}</p>}

      {summary && (
        <div className="mt-4 rounded-lg border border-ink-200 p-3 text-xs dark:border-ink-800">
          <p className="font-medium">
            Detected format: <code>{summary.detectedFormat}</code>
          </p>
          <ul className="mt-2 space-y-0.5 text-ink-600 dark:text-ink-400">
            <li>{summary.rowsRead.toLocaleString()} rows read</li>
            <li>{summary.backlinksInserted.toLocaleString()} new backlinks</li>
            <li>{summary.backlinksUpdated.toLocaleString()} existing rows updated</li>
            <li>{summary.domainsSeen.toLocaleString()} distinct referring domains</li>
            {summary.skipped > 0 && (
              <li>{summary.skipped.toLocaleString()} rows skipped</li>
            )}
          </ul>
          {summary.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-amber-700 dark:text-amber-400">
              {summary.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
