import { config, featureAvailability } from "@/lib/config";
import { getSetting } from "@/lib/db";
import { isConnected } from "@/lib/providers/gsc";
import { ranksTableSize } from "@/lib/providers/authority";
import { loadVocabulary } from "@/lib/engine/relevance";
import { Badge, Card, num } from "@/components/ui";
import { SettingsForm } from "@/components/SettingsForm";
import { ImportPanel } from "@/components/ImportPanel";
import { VocabularyPanel } from "@/components/VocabularyPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const features = featureAvailability();
  const connected = isConnected();
  const ranks = ranksTableSize();
  const vocab = loadVocabulary();

  const stored = {
    money_keywords: getSetting("money_keywords") ?? "",
    competitors: getSetting("competitors") ?? config.competitors.join(", "),
    brand_terms: getSetting("brand_terms") ?? config.brandTerms.join(", "),
    disavow_allowlist: getSetting("disavow_allowlist") ?? "",
    site_language: getSetting("site_language") ?? "en",
    sender_name: getSetting("sender_name") ?? "",
    gsc_site_url: getSetting("gsc_site_url") ?? "",
  };

  return (
    <div className="space-y-6">
      {params.gsc === "connected" && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Search Console connected. Select your property below, then build the
          relevance model from your query data.
        </div>
      )}
      {params.gsc === "error" && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          Search Console connection failed: {params.reason ?? "unknown error"}.
        </div>
      )}

      <Card title="Data sources" subtitle="What is wired up and what each unlocks.">
        <ul className="space-y-3">
          {features.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-3 last:border-0 last:pb-0 dark:border-ink-800/60"
            >
              <div className="min-w-0">
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

      <Card
        title="Google Search Console"
        subtitle="Free, and authoritative for your own site's links and queries."
      >
        <div className="space-y-3 text-sm text-ink-700 dark:text-ink-300">
          <p>
            Two separate things live behind this connection, and the difference
            matters:
          </p>
          <ul className="ml-4 list-disc space-y-1.5 text-xs text-ink-600 dark:text-ink-400">
            <li>
              <strong className="text-ink-800 dark:text-ink-200">
                Search Analytics API
              </strong>{" "}
              — queries, clicks, impressions, positions. Fully available through the
              API, and what the relevance model is built from.
            </li>
            <li>
              <strong className="text-ink-800 dark:text-ink-200">Links report</strong>{" "}
              — the &ldquo;Top linking sites&rdquo; page.{" "}
              <strong>Google has never exposed this through any API.</strong> The CSV
              export below is the only route that exists, for every tool on the
              market. Not a limitation of this one.
            </li>
          </ul>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {connected ? (
              <>
                <Badge tone="good">connected</Badge>
                <a
                  href="/api/auth/google"
                  className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                >
                  Re-authorise
                </a>
              </>
            ) : config.google.configured ? (
              <a
                href="/api/auth/google"
                className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 dark:bg-ink-100 dark:text-ink-900"
              >
                Connect Search Console
              </a>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>{" "}
                in <code>.env.local</code> first. See the README for the five-minute
                setup.
              </p>
            )}
          </div>
        </div>
      </Card>

      <ImportPanel targetSite={config.targetSite} />

      <VocabularyPanel
        connected={connected}
        source={vocab.source}
        termCount={vocab.terms.size}
        updatedAt={vocab.updatedAt}
        gscSiteUrl={stored.gsc_site_url}
      />

      <Card
        title="Free authority scores"
        subtitle={
          ranks > 0
            ? `${num(ranks)} domains indexed locally.`
            : "Not imported yet — scoring falls back to OpenPageRank if a key is set."
        }
      >
        <div className="space-y-2 text-sm text-ink-700 dark:text-ink-300">
          <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            The Common Crawl host-level webgraph publishes harmonic centrality and
            PageRank for over a hundred million hosts. That is the same family of
            signal commercial &ldquo;domain rating&rdquo; scores approximate, computed
            over a real web-scale graph, and it is free. One command imports it:
          </p>
          <pre className="table-scroll rounded-lg bg-ink-100 p-3 text-[11px] dark:bg-ink-950">
            npm run ranks:import -- https://data.commoncrawl.org/projects/hyperlinkgraph/…/domain-ranks.txt.gz
          </pre>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Get the current file URL from{" "}
            <a
              href="https://commoncrawl.org/web-graphs"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              commoncrawl.org/web-graphs
            </a>
            . Expect a few hundred MB gzipped and 5&ndash;20 minutes. If that is more
            local disk than you want, set <code>OPENPAGERANK_API_KEY</code> instead
            (free key, 1000 domains/day) — the tool works either way.
          </p>
        </div>
      </Card>

      <SettingsForm initial={stored} />

      <Card title="Crawler behaviour" subtitle="Set via environment variables.">
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink-500">User agent</dt>
            <dd className="mt-0.5">
              <code className="break-all">{config.crawler.userAgent}</code>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink-500">Per-host delay</dt>
            <dd className="tabular mt-0.5">{config.crawler.hostDelayMs} ms</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-500">Concurrency</dt>
            <dd className="tabular mt-0.5">{config.crawler.concurrency} requests</dd>
          </div>
          <div>
            <dt className="font-medium text-ink-500">robots.txt</dt>
            <dd className="mt-0.5">
              Respected, including <code>Crawl-delay</code> when a site asks for more
              than our default
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          Keep the contact URL in the user agent real and reachable. Site owners
          block anonymous crawlers, and being identifiable is the difference between
          being allowed and being firewalled — which would also take out your
          legitimate link verification too.
        </p>
      </Card>
    </div>
  );
}
