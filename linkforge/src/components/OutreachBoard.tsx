"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OutreachRecord, Stage } from "@/lib/engine/outreach";
import { Badge, ExternalLink, Td, Th } from "@/components/ui";

const STAGE_OPTIONS: { value: Stage; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "followup_1", label: "Followed up" },
  { value: "replied", label: "Replied" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "bounced", label: "Bounced" },
];

function stageTone(stage: string): "good" | "warn" | "bad" | "info" | "neutral" {
  if (stage === "won") return "good";
  if (stage === "replied") return "info";
  if (stage === "lost" || stage === "bounced") return "bad";
  if (stage === "draft") return "neutral";
  return "warn";
}

export function OutreachBoard({ records }: { records: OutreachRecord[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { subject: string; body: string }>>({});
  const [copied, setCopied] = useState<number | null>(null);

  const patch = async (id: number, body: Record<string, unknown>) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/outreach/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Update failed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (record: OutreachRecord) => {
    const local = drafts[record.id];
    const subject = local?.subject ?? record.subject ?? "";
    const body = local?.body ?? record.body ?? "";
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(record.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Clipboard access was blocked. Select the text and copy manually.");
    }
  };

  return (
    <>
      {error && <p className="mb-3 text-xs text-rose-700 dark:text-rose-400">{error}</p>}

      <div className="table-scroll">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr>
              <Th>Prospect</Th>
              <Th>Contact</Th>
              <Th>Stage</Th>
              <Th>Won link</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                <Td className="max-w-[280px]">
                  <div className="font-medium">{r.prospectDomain}</div>
                  <div className="mt-0.5 truncate text-[11px] text-ink-500">
                    <ExternalLink href={r.prospectUrl}>
                      {r.prospectUrl.replace(/^https?:\/\//, "")}
                    </ExternalLink>
                  </div>
                </Td>
                <Td>
                  {r.contactEmail ? (
                    <code className="text-[11px]">{r.contactEmail}</code>
                  ) : (
                    <span className="text-ink-400">no contact found</span>
                  )}
                </Td>
                <Td>
                  <select
                    value={r.stage}
                    disabled={busy === r.id}
                    onChange={(e) => void patch(r.id, { stage: e.target.value })}
                    className="rounded border border-ink-300 bg-white px-1.5 py-0.5 text-[11px] dark:border-ink-700 dark:bg-ink-950"
                  >
                    {STAGE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1">
                    <Badge tone={stageTone(r.stage)}>{r.stage}</Badge>
                  </div>
                </Td>
                <Td>
                  {r.wonUrl ? (
                    <ExternalLink href={r.wonUrl}>view</ExternalLink>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                      className="rounded border border-ink-300 px-1.5 py-0.5 text-[11px] text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
                    >
                      {open === r.id ? "Close" : "Edit draft"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copy(r)}
                      className="rounded bg-ink-900 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-ink-800 dark:bg-ink-100 dark:text-ink-900"
                    >
                      {copied === r.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open != null &&
        (() => {
          const record = records.find((r) => r.id === open);
          if (!record) return null;
          const local = drafts[record.id] ?? {
            subject: record.subject ?? "",
            body: record.body ?? "",
          };
          return (
            <div className="mt-5 rounded-xl border border-ink-200 p-4 dark:border-ink-800">
              <h3 className="mb-3 text-sm font-semibold">
                Draft for {record.prospectDomain}
              </h3>
              <p className="mb-3 text-[11px] text-ink-500 dark:text-ink-400">
                Placeholders in square brackets are there on purpose — a template
                sent verbatim reads like a template. Replace them with the specific
                thing you noticed about this site.
              </p>
              <label className="mb-3 block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                  Subject
                </span>
                <input
                  value={local.subject}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [record.id]: { ...local, subject: e.target.value },
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                  Body
                </span>
                <textarea
                  value={local.body}
                  rows={12}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [record.id]: { ...local, body: e.target.value },
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 font-mono text-xs dark:border-ink-700 dark:bg-ink-950"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy === record.id}
                  onClick={() =>
                    void patch(record.id, { subject: local.subject, body: local.body })
                  }
                  className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50 dark:bg-ink-100 dark:text-ink-900"
                >
                  Save draft
                </button>
                <button
                  type="button"
                  disabled={busy === record.id}
                  onClick={() =>
                    void patch(record.id, {
                      subject: local.subject,
                      body: local.body,
                      stage: "sent",
                    })
                  }
                  className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                >
                  Mark as sent
                </button>
              </div>
            </div>
          );
        })()}
    </>
  );
}
