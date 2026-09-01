import { config } from "@/lib/config";
import { getSetting } from "@/lib/db";
import { analyseAnchors } from "@/lib/engine/anchors";
import { Badge, Card, Empty, Td, Th, num, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  brand: "Brand",
  naked_url: "Naked URL",
  generic: "Generic (“click here”)",
  exact_match: "Exact-match keyword",
  partial_match: "Partial-match keyword",
  image: "Image link (alt text)",
  empty: "Empty anchor",
  other: "Other",
};

export default function AnchorsPage() {
  const brandTerms =
    (getSetting("brand_terms") ?? config.brandTerms.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const moneyKeywords = (getSetting("money_keywords") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const profile = analyseAnchors(config.targetSite, brandTerms, moneyKeywords);

  return (
    <div className="space-y-6">
      <Card
        title="Anchor text profile"
        subtitle={`${num(profile.totalLinks)} link(s) analysed.`}
      >
        <div className="space-y-2 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
          <p>
            Anchor distribution is the most legible fingerprint of manipulated link
            building. An editorially-earned profile skews heavily to brand names,
            bare URLs and generic phrases, because that is how people actually cite
            things. A built profile skews to keyword-rich exact-match anchors,
            because that is what someone optimising for a keyword asks for.
          </p>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            The healthy ranges below describe what natural profiles look like. Google
            publishes no such numbers — treat these as a &ldquo;this looks unusual,
            go and look&rdquo; flag, not a target to engineer toward. Engineering your
            ratios to hit a range is itself the behaviour the ratios detect.
          </p>
        </div>
      </Card>

      {profile.totalLinks === 0 ? (
        <Card>
          <Empty title="No anchor data yet">
            Anchor text comes from crawling the linking pages. Import your backlinks,
            then run &ldquo;Discover pages&rdquo; from the Overview.
          </Empty>
        </Card>
      ) : (
        <>
          {moneyKeywords.length === 0 && (
            <Card title="Set your commercial keywords">
              <p className="text-sm text-ink-700 dark:text-ink-300">
                Exact-match and partial-match detection needs to know which keywords
                you are targeting commercially. Without them, keyword anchors fall
                into &ldquo;Other&rdquo; and the most important row on this page stays
                empty. Add them under{" "}
                <a href="/settings" className="underline">
                  Settings → commercial keywords
                </a>
                .
              </p>
            </Card>
          )}

          <Card title="Distribution">
            <div className="table-scroll">
              <table className="w-full min-w-[720px] text-xs">
                <thead>
                  <tr>
                    <Th>Anchor type</Th>
                    <Th className="text-right">Links</Th>
                    <Th className="text-right">Share</Th>
                    <Th>Distribution</Th>
                    <Th className="text-right">Typical range</Th>
                    <Th>Examples</Th>
                  </tr>
                </thead>
                <tbody>
                  {profile.buckets.map((b) => (
                    <tr key={b.type}>
                      <Td className="font-medium">{LABELS[b.type] ?? b.type}</Td>
                      <Td className="tabular text-right">{num(b.count)}</Td>
                      <Td className="tabular text-right">
                        <Badge
                          tone={
                            b.verdict === "healthy"
                              ? "good"
                              : b.type === "exact_match"
                                ? "bad"
                                : "warn"
                          }
                        >
                          {pct(b.share, 1)}
                        </Badge>
                      </Td>
                      <Td className="w-40">
                        {/* Bar anchored to the baseline, 4px rounded end. */}
                        <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                          <div
                            className={`h-full rounded-full ${
                              b.verdict === "healthy"
                                ? "bg-emerald-500"
                                : b.type === "exact_match"
                                  ? "bg-rose-500"
                                  : "bg-amber-500"
                            }`}
                            style={{ width: `${Math.min(100, b.share * 100)}%` }}
                          />
                        </div>
                      </Td>
                      <Td className="tabular whitespace-nowrap text-right text-ink-500">
                        {pct(b.healthyRange[0], 0)}–{pct(b.healthyRange[1], 0)}
                      </Td>
                      <Td className="max-w-[240px] text-[11px] text-ink-500">
                        {b.examples.length > 0 ? b.examples.join(" · ") : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {profile.warnings.length > 0 && (
            <Card title="What stands out" subtitle="Ordered by how much it matters.">
              <ul className="space-y-2">
                {profile.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm text-ink-700 dark:text-ink-300"
                  >
                    <span aria-hidden className="text-amber-600 dark:text-amber-400">
                      ▸
                    </span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {profile.overusedAnchors.length > 0 && (
            <Card
              title="Over-represented anchors"
              subtitle="Any single anchor above ~15% of the profile is unusual."
            >
              <div className="table-scroll">
                <table className="w-full min-w-[480px] text-xs">
                  <thead>
                    <tr>
                      <Th>Anchor</Th>
                      <Th className="text-right">Links</Th>
                      <Th className="text-right">Share</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.overusedAnchors.map((a) => (
                      <tr key={a.anchor}>
                        <Td className="font-medium">{a.anchor}</Td>
                        <Td className="tabular text-right">{num(a.count)}</Td>
                        <Td className="tabular text-right">{pct(a.share, 1)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
