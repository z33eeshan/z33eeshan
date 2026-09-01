import { config } from "@/lib/config";
import { getSetting } from "@/lib/db";
import { prospects } from "@/lib/queries";
import { loadVocabulary } from "@/lib/engine/relevance";
import { opportunityQueries } from "@/lib/providers/serp";
import { Badge, Card, Empty, Stat, num } from "@/components/ui";
import { RunButton } from "@/components/RunButton";
import { ProspectTable } from "@/components/ProspectTable";
import { ManualMentionImport } from "@/components/ManualMentionImport";

export const dynamic = "force-dynamic";

const KINDS = [
  "all",
  "unlinked_mention",
  "competitor_gap",
  "resource_page",
  "guest_post",
  "broken_link",
] as const;

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const kind = params.kind ?? "all";
  const status = params.status ?? "all";

  const { rows, total } = prospects({ kind, status, limit: 200 });
  const vocab = loadVocabulary();

  const competitors = (getSetting("competitors") ?? config.competitors.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const brandTerms = (getSetting("brand_terms") ?? config.brandTerms.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const topic = vocab.terms.size > 0 ? [...vocab.terms.keys()].slice(0, 3).join(" ") : "news";
  const queries = opportunityQueries(topic, brandTerms[0] ?? config.targetSite);

  const won = rows.filter((r) => r.status === "won").length;
  const fresh = rows.filter((r) => r.status === "new").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Prospects" value={num(total)} />
        <Stat label="Unreviewed" value={num(fresh)} hint="Waiting on a qualify/reject call" />
        <Stat label="Links won" value={num(won)} tone={won > 0 ? "good" : "neutral"} />
        <Stat
          label="Relevance model"
          value={vocab.terms.size > 0 ? `${num(vocab.terms.size)} terms` : "not built"}
          tone={vocab.terms.size > 0 ? "good" : "warn"}
          hint={vocab.source === "empty" ? "Build it in Settings" : `from ${vocab.source}`}
        />
      </div>

      {vocab.terms.size === 0 && (
        <Card title="Build the relevance model first">
          <p className="text-sm leading-relaxed text-ink-700 dark:text-ink-300">
            Relevance beats authority for link value, and it is what cheap link
            building always gets wrong: a high-authority link from an off-topic site
            does a news outlet less good than a modest link from a relevant one.
            Prospects can still be found without the model, but they will be ranked
            on authority alone.{" "}
            <a href="/settings" className="underline">
              Build it in Settings
            </a>{" "}
            — from Search Console queries if connected, or by crawling your own
            content.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Find opportunities"
          subtitle="Each method finds a different kind of link. Ordered by typical yield."
        >
          <div className="space-y-4">
            <Method
              title="Unlinked brand mentions"
              detail="Pages that name you without linking. Highest conversion rate of any outreach type — the editorial decision to mention you has already been made."
              action={
                <RunButton
                  kind="find_unlinked_mentions"
                  payload={{ limit: 50 }}
                  label="Find mentions"
                />
              }
            />
            <Method
              title="Competitor link gap"
              detail={
                competitors.length === 0
                  ? "Add competitors in Settings first. Needs their backlink data imported — Common Crawl's URL index cannot answer 'who links to this domain'."
                  : `Domains linking to ${competitors.slice(0, 3).join(", ")} but not to you. Highest-yield method when the data is available.`
              }
              action={
                <RunButton
                  kind="find_competitor_gaps"
                  payload={{ competitors, crawl: true, limit: 100 }}
                  label="Find gaps"
                />
              }
            />
            <Method
              title="Resource & contribution pages"
              detail="Screens seed domains through the free Common Crawl index for /resources, /links and /write-for-us pages, then crawls only the hits."
              action={
                <RunButton
                  kind="find_resource_pages"
                  payload={{ seedDomains: competitors, crawl: true }}
                  label="Screen seeds"
                />
              }
            />
            <Method
              title="Find contacts"
              detail="Reads published editorial addresses from prospects' own contact pages. No email guessing — a guessed address bounces and burns your sending domain."
              action={
                <RunButton
                  kind="discover_contacts"
                  payload={{ limit: 20 }}
                  label="Find contacts"
                />
              }
            />
          </div>
        </Card>

        <div className="space-y-6">
          <Card
            title="Search operators"
            subtitle={
              config.serp.provider === "none"
                ? "No SERP API configured — run these in a browser and paste the results below."
                : "Also runnable directly via the configured SERP provider."
            }
          >
            <ul className="space-y-2.5">
              {queries.map((q) => (
                <li key={q.label}>
                  <div className="text-xs font-medium text-ink-700 dark:text-ink-300">
                    {q.label}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="table-scroll block flex-1 rounded bg-ink-100 px-2 py-1 text-[11px] dark:bg-ink-950">
                      {q.query}
                    </code>
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(q.query)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded border border-ink-300 px-1.5 py-0.5 text-[11px] text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800"
                    >
                      Run
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <ManualMentionImport />
        </div>
      </div>

      <Card
        title="Prospects"
        subtitle={`${num(total)} matching. Sorted by priority — relevance weighted highest, difficulty subtracted, spam penalised.`}
        actions={
          <a
            href={`/api/prospects?format=csv&kind=${kind}&status=${status}&limit=1000`}
            className="inline-flex items-center rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
          >
            Export CSV
          </a>
        }
      >
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              Type
            </span>
            <select
              name="kind"
              defaultValue={kind}
              className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </select>
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
              {["all", "new", "qualified", "queued", "contacted", "won", "lost", "rejected"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ),
              )}
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
          <Empty title="No prospects yet">
            Run one of the discovery methods above. Unlinked mentions are the best
            place to start — they convert most often and need the least setup.
          </Empty>
        ) : (
          <ProspectTable rows={rows} />
        )}
      </Card>
    </div>
  );
}

function Method({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-4 last:border-0 last:pb-0 dark:border-ink-800/60">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs leading-snug text-ink-500 dark:text-ink-400">
          {detail}
        </div>
      </div>
      {action}
    </div>
  );
}
