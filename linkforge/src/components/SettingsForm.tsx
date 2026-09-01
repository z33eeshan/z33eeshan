"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

type Fields = {
  money_keywords: string;
  competitors: string;
  brand_terms: string;
  disavow_allowlist: string;
  site_language: string;
  sender_name: string;
};

const FIELDS: {
  key: keyof Fields;
  label: string;
  hint: string;
  placeholder: string;
  multiline?: boolean;
}[] = [
  {
    key: "brand_terms",
    label: "Brand terms",
    hint: "Used to classify brand anchors and to search for unlinked mentions. Include misspellings people actually use.",
    placeholder: "Live News Of, livenewsof, LiveNewsOf",
  },
  {
    key: "competitors",
    label: "Competitors",
    hint: "Domains for link-gap analysis. Pick sites at a similar level — a national broadcaster's links are not winnable.",
    placeholder: "competitor1.com, competitor2.com",
  },
  {
    key: "money_keywords",
    label: "Commercial keywords",
    hint: "What you are optimising for. Needed for exact-match anchor detection — without these, the most important row on the Anchors page stays empty.",
    placeholder: "breaking news pakistan, latest sports news",
    multiline: true,
  },
  {
    key: "disavow_allowlist",
    label: "Disavow allowlist",
    hint: "Domains never to disavow, whatever they score. Partners, clients, and anything you know is legitimate.",
    placeholder: "partner.com, client-site.org",
    multiline: true,
  },
  {
    key: "site_language",
    label: "Site language",
    hint: "Two-letter code. Drives the language-mismatch spam signal.",
    placeholder: "en",
  },
  {
    key: "sender_name",
    label: "Your name (outreach signature)",
    hint: "Signs the email templates. A real name outperforms a brand name in outreach.",
    placeholder: "Zeeshan",
  },
];

export function SettingsForm({ initial }: { initial: Fields }) {
  const router = useRouter();
  const [values, setValues] = useState<Fields>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Save failed.");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Project settings"
      subtitle="Stored in the database, so they survive restarts and override the .env defaults."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-700 dark:text-ink-300">
              {f.label}
            </span>
            {f.multiline ? (
              <textarea
                rows={2}
                value={values[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
            ) : (
              <input
                value={values[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
            )}
            <span className="text-[11px] leading-snug text-ink-500 dark:text-ink-400">
              {f.hint}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50 dark:bg-ink-100 dark:text-ink-900"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
        {saved && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">Saved.</span>
        )}
        {error && <span className="text-xs text-rose-700 dark:text-rose-400">{error}</span>}
      </div>
    </Card>
  );
}
