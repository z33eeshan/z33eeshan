"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card } from "@/components/ui";

interface Site {
  siteUrl: string;
  permission: string;
}

/**
 * Builds the topic vocabulary that drives relevance scoring.
 *
 * Search Console queries are the better source — they describe what the site
 * actually ranks for, rather than what someone guessed it was about. Crawling
 * our own content is the fallback.
 */
export function VocabularyPanel({
  connected,
  source,
  termCount,
  updatedAt,
  gscSiteUrl,
}: {
  connected: boolean;
  source: string;
  termCount: number;
  updatedAt: string;
  gscSiteUrl: string;
}) {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [selected, setSelected] = useState(gscSiteUrl);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [top, setTop] = useState<{ term: string; weight: number }[]>([]);

  useEffect(() => {
    if (!connected) return;
    void (async () => {
      try {
        const res = await fetch("/api/gsc/sites", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; sites?: Site[] };
        if (data.ok && data.sites) {
          setSites(data.sites);
          if (!selected && data.sites[0]) setSelected(data.sites[0].siteUrl);
        }
      } catch {
        // Non-fatal: the content fallback does not need the site list.
      }
    })();
    // Runs once on mount; `selected` is seeded from props and must not re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const build = async (src: "gsc" | "content") => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/gsc/vocabulary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: src,
          siteUrl: src === "gsc" ? selected : undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        terms?: number;
        pages?: number;
        top?: { term: string; weight: number }[];
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "Could not build the vocabulary.");
      setResult(
        src === "gsc"
          ? `Built from ${data.terms} Search Console terms.`
          : `Built from ${data.pages} crawled page(s), ${data.terms} terms.`,
      );
      setTop(data.top ?? []);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Relevance model"
      subtitle={
        termCount > 0
          ? `${termCount} terms, built from ${source}${updatedAt ? ` on ${updatedAt.slice(0, 10)}` : ""}.`
          : "Not built yet. Prospects will be ranked on authority alone until it is."
      }
      actions={<Badge tone={termCount > 0 ? "good" : "warn"}>{source}</Badge>}
    >
      <p className="mb-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
        Relevance beats authority for link value, and it is the thing cheap link
        building always gets wrong. This model is what lets the prospect ranking
        prefer a modest on-topic site over a strong off-topic one.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        {connected && sites.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Search Console property
            </span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
            >
              {sites.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl} ({s.permission})
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={() => void build("gsc")}
          disabled={busy || !connected || !selected}
          title={!connected ? "Connect Search Console first" : undefined}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50 dark:bg-ink-100 dark:text-ink-900"
        >
          {busy ? "Building…" : "Build from Search Console"}
        </button>

        <button
          type="button"
          onClick={() => void build("content")}
          disabled={busy}
          className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
        >
          Build from my site&rsquo;s content
        </button>
      </div>

      {result && (
        <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{result}</p>
      )}
      {error && <p className="mt-3 text-xs text-rose-700 dark:text-rose-400">{error}</p>}

      {top.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Top topic terms
          </p>
          <div className="flex flex-wrap gap-1.5">
            {top.slice(0, 30).map((t) => (
              <span
                key={t.term}
                className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[11px] dark:bg-ink-800"
                title={`weight ${t.weight.toFixed(3)}`}
              >
                {t.term}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
