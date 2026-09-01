import Link from "next/link";
import { config, featureAvailability } from "@/lib/config";
import { overview, snapshots } from "@/lib/queries";
import { pipelineStats } from "@/lib/engine/outreach";
import { Badge, Card, Empty, Stat, num, pct, score } from "@/components/ui";
import { RunButton } from "@/components/RunButton";
import { TrendChart } from "@/components/TrendChart";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  const stats = overview();
  const history = snapshots(config.targetSite, 60);
  const pipeline = pipelineStats();
  const features = featureAvailability();

  const hasData = stats.totalBacklinks > 0;
  const unverifiedShare =
    stats.totalBacklinks > 0 ? stats.unverifiedBacklinks / stats.totalBacklinks : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Referring domains"
          value={num(stats.referringDomains)}
          hint="Distinct sites linking to you — the number that matters"
        />
        <Stat
          label="Live backlinks"
          value={num(stats.liveBacklinks)}
          hint={`${num(stats.totalBacklinks)} total, ${num(stats.lostBacklinks)} lost`}
          tone={stats.lostBacklinks > stats.liveBacklinks * 0.2 ? "warn" : "neutral"}
        />
        <Stat
          label="Median authority"
          value={score(stats.medianAuthority, 1)}
          hint="0-100, median across referring domains"
        />
        <Stat
          label="Toxic domains"
          value={num(stats.toxicDomains)}
          hint={`${num(stats.reviewDomains)} more need review`}
          tone={stats.toxicDomains > 0 ? "bad" : "good"}
        />
      </div>

      {!hasData && (
        <Card
          title="Start here"
          subtitle="No link data yet. Three steps to a full picture, in order."
        >
          <ol className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white dark:bg-ink-100 dark:text-ink-900">
                1
              </span>
              <div>
                <p className="font-medium">Import your Search Console links export</p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                  Search Console → Links → Top linking sites → Export. Google has
                  never exposed that report through an API, so this CSV is the
                  authoritative starting point for every tool, including this one.{" "}
                  <Link href="/settings" className="underline">
                    Import it in Settings
                  </Link>
                  .
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white dark:bg-ink-100 dark:text-ink-900">
                2
              </span>
              <div>
                <p className="font-medium">Discover the exact linking pages</p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                  The export gives you domains. The crawler finds the real pages,
                  anchor text, rel attributes and placement — everything Search
                  Console does not show you.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white dark:bg-ink-100 dark:text-ink-900">
                3
              </span>
              <div>
                <p className="font-medium">Score authority and toxicity</p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                  Then the audit, anchor profile and opportunity finder all have
                  something to work with.
                </p>
              </div>
            </li>
          </ol>
        </Card>
      )}

      {hasData && (
        <Card
          title="Link profile over time"
          subtitle={
            history.length < 2
              ? "One snapshot so far — trends appear after the second verification run."
              : `${history.length} snapshots. Each verification pass records one.`
          }
          actions={<RunButton kind="snapshot" label="Take snapshot" variant="secondary" />}
        >
          {history.length < 2 ? (
            <Empty title="Not enough history yet">
              Run a verification pass to record snapshots. Two or more lets you see
              whether the profile is growing or bleeding links.
            </Empty>
          ) : (
            <TrendChart data={history} />
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Run the pipeline"
          subtitle="Each step writes to the database; later steps read what earlier ones found."
        >
          <div className="space-y-4">
            <PipelineStep
              n={1}
              title="Discover linking pages"
              detail="Crawls referring domains to find the exact pages, anchors and rel attributes."
              action={
                <RunButton
                  kind="discover_linking_pages"
                  payload={{ limit: 25, maxPages: 40 }}
                  label="Discover pages"
                />
              }
            />
            <PipelineStep
              n={2}
              title="Resolve authority"
              detail="Scores referring domains 0-100 from the local ranks table or OpenPageRank."
              action={<RunButton kind="resolve_authority" label="Score authority" />}
            />
            <PipelineStep
              n={3}
              title="Verify links are still live"
              detail="Re-fetches each linking page and confirms the link still exists and is still followed."
              action={
                <RunButton
                  kind="verify_backlinks"
                  payload={{ limit: 100 }}
                  label="Verify 100 links"
                />
              }
            />
            <PipelineStep
              n={4}
              title="Score toxicity"
              detail="Runs the spam signals over every referring domain. No network calls — fast to re-run."
              action={<RunButton kind="audit_domains" label="Run audit" />}
            />
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Setup status" subtitle="What is wired up, and what each key unlocks.">
            <ul className="space-y-2.5">
              {features.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{f.note}</div>
                  </div>
                  <Badge tone={f.available ? "good" : "neutral"}>
                    {f.available ? "ready" : "not set"}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Outreach pipeline">
            {pipeline.sent === 0 ? (
              <Empty title="No outreach sent yet">
                Qualify prospects on the{" "}
                <Link href="/opportunities" className="underline">
                  Opportunities
                </Link>{" "}
                page, then draft from a template.
              </Empty>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Sent" value={num(pipeline.sent)} />
                <Stat
                  label="Reply rate"
                  value={pct(pipeline.replyRate)}
                  tone={pipeline.replyRate > 0.1 ? "good" : "neutral"}
                />
                <Stat
                  label="Links won"
                  value={num(pipeline.won)}
                  tone={pipeline.won > 0 ? "good" : "neutral"}
                />
              </div>
            )}
          </Card>
        </div>
      </div>

      {hasData && unverifiedShare > 0.3 && (
        <Card title="Data quality">
          <p className="text-sm text-ink-700 dark:text-ink-300">
            {pct(unverifiedShare, 0)} of your links ({num(stats.unverifiedBacklinks)}) have
            never been verified against the live page. Imported data reflects when the
            source index last crawled, which can be months old — the counts above are
            provisional until you verify.
          </p>
          <div className="mt-3">
            <RunButton
              kind="verify_backlinks"
              payload={{ limit: 250 }}
              label="Verify 250 links"
            />
          </div>
        </Card>
      )}
    </div>
  );
}

function PipelineStep({
  n,
  title,
  detail,
  action,
}: {
  n: number;
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-4 last:border-0 last:pb-0 dark:border-ink-800/60">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-300 text-[10px] font-semibold text-ink-500 dark:border-ink-700 dark:text-ink-400">
          {n}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-xs leading-snug text-ink-500 dark:text-ink-400">
            {detail}
          </div>
        </div>
      </div>
      {action}
    </div>
  );
}
