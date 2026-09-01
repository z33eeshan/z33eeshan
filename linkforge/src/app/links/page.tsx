import Link from "next/link";
import { backlinks } from "@/lib/queries";
import { Badge, Card, Empty, ExternalLink, Td, Th, num, score, spamTone } from "@/components/ui";
import { RunButton } from "@/components/RunButton";

export const dynamic = "force-dynamic";

const STATUSES = ["all", "live", "unverified", "lost", "unreachable"] as const;
const SORTS = [
  { value: "authority", label: "Authority" },
  { value: "spam", label: "Spam score" },
  { value: "recent", label: "Newest" },
] as const;

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const status = params.status ?? "live";
  const sort = (params.sort as "authority" | "spam" | "recent") ?? "authority";
  const q = params.q ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const limit = 100;

  const { rows, total } = backlinks({
    status,
    search: q,
    sort,
    limit,
    offset: (page - 1) * limit,
  });

  const pages = Math.max(1, Math.ceil(total / limit));
  const query = (over: Record<string, string | number>) => {
    const sp = new URLSearchParams({ status, sort, q, page: String(page) });
    for (const [k, v] of Object.entries(over)) sp.set(k, String(v));
    return `/links?${sp}`;
  };

  return (
    <div className="space-y-6">
      <Card
        title="Backlinks"
        subtitle={`${num(total)} link(s) matching this filter. Verification confirms each one against the live page.`}
        actions={
          <>
            <a
              href={`/api/links?format=csv&status=${status}&sort=${sort}&q=${encodeURIComponent(q)}&limit=1000`}
              className="inline-flex items-center rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
            >
              Export CSV
            </a>
            <RunButton kind="verify_backlinks" payload={{ limit: 100 }} label="Verify 100" />
          </>
        }
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Search
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="domain, anchor or URL"
              className="w-56 rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Status
            </span>
            <select
              name="status"
              defaultValue={status}
              className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Sort by
            </span>
            <select
              name="sort"
              defaultValue={sort}
              className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 dark:bg-ink-100 dark:text-ink-900"
          >
            Apply
          </button>
        </form>

        {rows.length === 0 ? (
          <Empty title="No backlinks match this filter">
            Import a Search Console links export from{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            , then run &ldquo;Discover pages&rdquo; to find the exact linking pages.
          </Empty>
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full min-w-[1000px] text-xs">
                <thead>
                  <tr>
                    <Th>Referring page</Th>
                    <Th>Anchor text</Th>
                    <Th className="text-right">Auth</Th>
                    <Th className="text-right">Spam</Th>
                    <Th>Attributes</Th>
                    <Th>Placement</Th>
                    <Th>Status</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const spam = spamTone(r.spamScore);
                    return (
                      <tr key={r.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                        <Td className="max-w-[320px]">
                          <div className="font-medium">{r.sourceDomain}</div>
                          <div className="mt-0.5 truncate text-[11px] text-ink-500">
                            <ExternalLink href={r.sourceUrl}>
                              {r.sourceUrl.replace(/^https?:\/\//, "")}
                            </ExternalLink>
                          </div>
                        </Td>
                        <Td className="max-w-[220px]">
                          {r.anchorText ? (
                            <span className="line-clamp-2">{r.anchorText}</span>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </Td>
                        <Td className="tabular text-right">{score(r.authority, 1)}</Td>
                        <Td className="tabular text-right">
                          {r.spamScore == null ? (
                            <span className="text-ink-400">—</span>
                          ) : (
                            <Badge tone={spam.tone} title={spam.label}>
                              {r.spamScore.toFixed(0)}
                            </Badge>
                          )}
                        </Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {r.isNofollow ? (
                              <Badge tone="warn">nofollow</Badge>
                            ) : (
                              <Badge tone="good">follow</Badge>
                            )}
                            {r.isSponsored && <Badge tone="info">sponsored</Badge>}
                            {r.isUgc && <Badge tone="info">ugc</Badge>}
                          </div>
                        </Td>
                        <Td>
                          {r.position ? (
                            <Badge tone={r.position === "content" ? "good" : "neutral"}>
                              {r.position}
                            </Badge>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              r.status === "live"
                                ? "good"
                                : r.status === "lost"
                                  ? "bad"
                                  : r.status === "unreachable"
                                    ? "warn"
                                    : "neutral"
                            }
                          >
                            {r.status}
                          </Badge>
                        </Td>
                        <Td className="text-[11px] text-ink-500">{r.discoveredVia}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <nav className="mt-4 flex items-center justify-between text-xs">
                <span className="text-ink-500">
                  Page {page} of {pages}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={query({ page: page - 1 })}
                      className="rounded-lg border border-ink-300 px-2.5 py-1 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"
                    >
                      Previous
                    </Link>
                  )}
                  {page < pages && (
                    <Link
                      href={query({ page: page + 1 })}
                      className="rounded-lg border border-ink-300 px-2.5 py-1 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
