"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProspectListRow } from "@/lib/queries";
import { Badge, ExternalLink, Td, Th, score, spamTone } from "@/components/ui";

const KIND_LABELS: Record<string, string> = {
  unlinked_mention: "unlinked mention",
  competitor_gap: "competitor gap",
  resource_page: "resource page",
  guest_post: "contribution",
  broken_link: "broken link",
  manual: "manual",
};

export function ProspectTable({ rows }: { rows: ProspectListRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const act = async (
    id: number,
    body: Record<string, unknown>,
    successMessage?: string,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Update failed.");
      if (successMessage) setError(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {error && <p className="mb-3 text-xs text-rose-700 dark:text-rose-400">{error}</p>}

      <div className="table-scroll">
        <table className="w-full min-w-[1040px] text-xs">
          <thead>
            <tr>
              <Th>Opportunity</Th>
              <Th>Type</Th>
              <Th className="text-right">Priority</Th>
              <Th className="text-right">Auth</Th>
              <Th className="text-right">Relevance</Th>
              <Th className="text-right">Difficulty</Th>
              <Th className="text-right">Spam</Th>
              <Th>Contacts</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const spam = spamTone(r.spamScore);
              const reason =
                typeof r.evidence.reason === "string" ? r.evidence.reason : null;
              const isOpen = expanded === r.id;
              const busy = busyId === r.id || pending;

              return (
                <Fragment key={r.id}>
                  <tr className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                    <Td className="max-w-[320px]">
                      <div className="font-medium">{r.domain}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-500">
                        <ExternalLink href={r.url}>
                          {r.url.replace(/^https?:\/\//, "")}
                        </ExternalLink>
                      </div>
                      {r.title && (
                        <div className="mt-0.5 line-clamp-1 text-[11px] text-ink-500">
                          {r.title}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={r.kind === "unlinked_mention" ? "good" : "neutral"}>
                        {KIND_LABELS[r.kind] ?? r.kind}
                      </Badge>
                    </Td>
                    <Td className="tabular text-right font-semibold">
                      {r.priority.toFixed(0)}
                    </Td>
                    <Td className="tabular text-right">{score(r.authority, 1)}</Td>
                    <Td className="tabular text-right">{score(r.relevance, 0)}</Td>
                    <Td className="tabular text-right">{score(r.difficulty, 0)}</Td>
                    <Td className="tabular text-right">
                      {r.spamScore == null ? (
                        <span className="text-ink-400">—</span>
                      ) : (
                        <Badge tone={spam.tone}>{r.spamScore.toFixed(0)}</Badge>
                      )}
                    </Td>
                    <Td>
                      {r.contactCount > 0 ? (
                        <Badge tone="good">{r.contactCount}</Badge>
                      ) : (
                        <span className="text-ink-400">none</span>
                      )}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          r.status === "won"
                            ? "good"
                            : r.status === "rejected" || r.status === "lost"
                              ? "bad"
                              : r.status === "contacted" || r.status === "queued"
                                ? "info"
                                : "neutral"
                        }
                      >
                        {r.status}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {r.status === "new" && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void act(r.id, { status: "qualified" })}
                              className="rounded border border-emerald-300 px-1.5 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                            >
                              Qualify
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void act(r.id, { status: "rejected" })}
                              className="rounded border border-ink-300 px-1.5 py-0.5 text-[11px] text-ink-600 hover:bg-ink-100 disabled:opacity-50 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {(r.status === "qualified" || r.status === "new") && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void act(r.id, { draft: true })}
                            className="rounded bg-ink-900 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-ink-800 disabled:opacity-50 dark:bg-ink-100 dark:text-ink-900"
                          >
                            Draft email
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                          className="rounded border border-ink-300 px-1.5 py-0.5 text-[11px] text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
                        >
                          {isOpen ? "Hide" : "Why"}
                        </button>
                      </div>
                    </Td>
                  </tr>

                  {isOpen && (
                    <tr className="bg-ink-50 dark:bg-ink-800/30">
                      {/* Spans the full row so the evidence text has room to
                          wrap instead of being squeezed into one column. */}
                      <td
                        colSpan={10}
                        className="border-b border-ink-100 px-3 py-2 align-top text-[11px] text-ink-800 dark:border-ink-800/60 dark:text-ink-200"
                      >
                        <div className="space-y-1.5">
                          {reason && (
                            <p className="text-ink-700 dark:text-ink-300">{reason}</p>
                          )}
                          {Array.isArray(r.evidence.matchedTerms) &&
                            r.evidence.matchedTerms.length > 0 && (
                              <p>
                                <span className="font-medium">Topic overlap:</span>{" "}
                                <span className="text-ink-500">
                                  {(r.evidence.matchedTerms as string[]).join(", ")}
                                </span>
                              </p>
                            )}
                          {typeof r.evidence.wordCount === "number" && (
                            <p className="text-ink-500">
                              {r.evidence.wordCount} words,{" "}
                              {String(r.evidence.externalLinks ?? "?")} external links
                            </p>
                          )}
                          {Array.isArray(r.evidence.deadLinks) && (
                            <div>
                              <span className="font-medium">Dead links found:</span>
                              <ul className="mt-1 space-y-0.5 text-ink-500">
                                {(
                                  r.evidence.deadLinks as {
                                    url: string;
                                    status: number;
                                    anchor: string;
                                  }[]
                                )
                                  .slice(0, 5)
                                  .map((d) => (
                                    <li key={d.url}>
                                      {d.status} — {d.url}
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          )}
                          {typeof r.evidence.fetchError === "string" && (
                            <p className="text-amber-700 dark:text-amber-400">
                              Could not crawl this page: {r.evidence.fetchError}. Scores
                              are based on authority alone.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
