"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface JobState {
  id: number;
  status: string;
  progress: number;
  processed: number;
  total: number | null;
  message: string | null;
  error: string | null;
}

/**
 * Enqueues a job and polls until it settles. Jobs are crawls that take minutes,
 * so the button owns the whole lifecycle rather than firing and forgetting.
 */
export function RunButton({
  kind,
  payload = {},
  label,
  variant = "primary",
  confirm,
  onDone,
}: {
  kind: string;
  payload?: Record<string, unknown>;
  label: string;
  variant?: "primary" | "secondary";
  confirm?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const poll = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; job?: JobState };
        if (!data.ok || !data.job) throw new Error("Lost track of the job.");
        setJob(data.job);

        if (data.job.status === "running" || data.job.status === "queued") {
          timer.current = setTimeout(() => void poll(id), 1500);
          return;
        }

        setBusy(false);
        if (data.job.status === "failed") setError(data.job.error ?? "Job failed.");
        // Refresh server components so the new rows appear without a manual reload.
        router.refresh();
        onDone?.();
      } catch (err) {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [router, onDone],
  );

  const start = async () => {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    setJob(null);
    setBusy(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, payload }),
      });
      const data = (await res.json()) as { ok: boolean; jobId?: number; error?: string };
      if (!data.ok || !data.jobId) throw new Error(data.error ?? "Could not start the job.");
      void poll(data.jobId);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const base =
    "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-ink-900 text-white hover:bg-ink-800 dark:bg-ink-100 dark:text-ink-900 dark:hover:bg-white"
      : "border border-ink-300 text-ink-700 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800";

  const progressLabel =
    job && job.total && job.total > 0
      ? `${job.processed}/${job.total}`
      : job?.status === "running"
        ? "working"
        : null;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={() => void start()} disabled={busy} className={`${base} ${styles}`}>
        {busy && (
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {busy ? (progressLabel ?? "Starting…") : label}
      </button>

      {job?.status === "done" && job.message && (
        <span className="max-w-md text-[11px] leading-snug text-emerald-700 dark:text-emerald-400">
          {job.message}
        </span>
      )}
      {error && (
        <span className="max-w-md text-[11px] leading-snug text-rose-700 dark:text-rose-400">
          {error}
        </span>
      )}
    </div>
  );
}
