import { config } from "@/lib/config";
import { getSetting } from "@/lib/db";
import { auditReferringDomains } from "@/lib/engine/spam";
import { Badge, Card, Empty, Stat, Td, Th, num, spamTone } from "@/components/ui";
import { RunButton } from "@/components/RunButton";
import { DisavowPanel } from "@/components/DisavowPanel";

export const dynamic = "force-dynamic";

export default function AuditPage() {
  const siteLanguage = getSetting("site_language") ?? "en";
  const assessments = auditReferringDomains(config.targetSite, siteLanguage);

  const counts = {
    total: assessments.length,
    disavow: assessments.filter((a) => a.recommendation === "disavow").length,
    review: assessments.filter((a) => a.recommendation === "review").length,
    monitor: assessments.filter((a) => a.recommendation === "monitor").length,
    keep: assessments.filter((a) => a.recommendation === "keep").length,
  };

  const flagged = assessments.filter((a) => a.score >= 25).slice(0, 200);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Referring domains" value={num(counts.total)} />
        <Stat
          label="Flagged for disavow"
          value={num(counts.disavow)}
          tone={counts.disavow > 0 ? "bad" : "good"}
          hint="Toxic band with 2+ independent signals"
        />
        <Stat
          label="Need review"
          value={num(counts.review)}
          tone={counts.review > 0 ? "warn" : "good"}
          hint="High score — judgement call"
        />
        <Stat label="Clean" value={num(counts.keep)} tone="good" />
      </div>

      <Card
        title="How to read this"
        subtitle="Worth two minutes before you act on any of it."
      >
        <div className="space-y-2 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
          <p>
            No single signal condemns a domain. Real editorial sites trip individual
            signals constantly — a news site has a high outbound link count, a
            directory has &ldquo;links&rdquo; in its URLs. Scores are built from
            clusters of signals, and every score below shows exactly which ones
            fired.
          </p>
          <p>
            Google&rsquo;s own position is that most sites never need a disavow file:
            their spam systems already discount obvious junk. A disavow is warranted
            when you have a manual action for unnatural links, or you know links were
            bought or built manipulatively. Disavowing merely low-quality links is a
            no-op at best, and throws away real ranking value at worst.
          </p>
        </div>
      </Card>

      <Card
        title="Referring domains by toxicity"
        subtitle={
          counts.total === 0
            ? "No referring domains scored yet."
            : `Showing ${num(flagged.length)} domain(s) scoring 25 or above. ${num(counts.keep)} clean domain(s) hidden.`
        }
        actions={
          <>
            <RunButton kind="resolve_authority" label="Refresh authority" variant="secondary" />
            <RunButton kind="audit_domains" label="Re-score" />
          </>
        }
      >
        {counts.total === 0 ? (
          <Empty title="Nothing to audit yet">
            Import your backlinks and run &ldquo;Discover pages&rdquo; first. The
            scorer reads crawled page facts — titles, outbound link counts, language,
            placement — so it needs a crawl before it can say anything useful.
          </Empty>
        ) : flagged.length === 0 ? (
          <Empty title="No domain scored above 25">
            Every referring domain looks clean on the signals checked. That is the
            expected result for an organically-earned profile.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr>
                  <Th>Domain</Th>
                  <Th className="text-right">Score</Th>
                  <Th>Recommendation</Th>
                  <Th>Signals that fired</Th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((a) => {
                  const tone = spamTone(a.score);
                  return (
                    <tr key={a.domain} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                      <Td className="font-medium">{a.domain}</Td>
                      <Td className="tabular text-right">
                        <Badge tone={tone.tone}>{a.score.toFixed(0)}</Badge>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            a.recommendation === "disavow"
                              ? "bad"
                              : a.recommendation === "review"
                                ? "warn"
                                : a.recommendation === "monitor"
                                  ? "info"
                                  : "good"
                          }
                        >
                          {a.recommendation}
                        </Badge>
                      </Td>
                      <Td>
                        <ul className="space-y-1">
                          {a.signals.slice(0, 5).map((s) => (
                            <li key={s.id} className="flex gap-2">
                              <span
                                className={
                                  s.weight < 0
                                    ? "shrink-0 font-medium text-emerald-700 dark:text-emerald-400"
                                    : "shrink-0 font-medium text-ink-700 dark:text-ink-300"
                                }
                              >
                                {s.weight > 0 ? `+${s.weight}` : s.weight}
                              </span>
                              <span>
                                <span className="font-medium">{s.label}</span>
                                {s.detail && (
                                  <span className="text-ink-500 dark:text-ink-400">
                                    {" "}
                                    — {s.detail}
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DisavowPanel
        disavowCount={counts.disavow}
        reviewCount={counts.review}
        allowlist={getSetting("disavow_allowlist") ?? ""}
      />
    </div>
  );
}
