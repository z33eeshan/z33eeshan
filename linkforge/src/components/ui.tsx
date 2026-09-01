import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900 ${className}`}
    >
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-tight text-ink-900 dark:text-ink-100">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-rose-600 dark:text-rose-400"
          : "text-ink-900 dark:text-ink-100";

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
        {label}
      </div>
      <div className={`tabular mt-1.5 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500 dark:text-ink-400">{hint}</div>}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
} as const;

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Maps a 0-100 spam score to a band label and colour. */
export function spamTone(score: number | null): {
  tone: keyof typeof BADGE_TONES;
  label: string;
} {
  if (score == null) return { tone: "neutral", label: "unscored" };
  if (score >= 70) return { tone: "bad", label: "toxic" };
  if (score >= 45) return { tone: "warn", label: "high" };
  if (score >= 25) return { tone: "info", label: "medium" };
  if (score >= 10) return { tone: "neutral", label: "low" };
  return { tone: "good", label: "clean" };
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-300 p-8 text-center dark:border-ink-700">
      <p className="text-sm font-medium text-ink-700 dark:text-ink-300">{title}</p>
      {children && (
        <div className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          {children}
        </div>
      )}
    </div>
  );
}

export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-ink-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:text-ink-400 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <td
      className={`border-b border-ink-100 px-3 py-2 align-top text-ink-800 dark:border-ink-800/60 dark:text-ink-200 ${className}`}
    >
      {children}
    </td>
  );
}

export function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-sky-700 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-600 dark:text-sky-400 dark:decoration-sky-700"
    >
      {children ?? href}
    </a>
  );
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

export function score(n: number | null | undefined, digits = 0): string {
  return n == null ? "—" : n.toFixed(digits);
}
