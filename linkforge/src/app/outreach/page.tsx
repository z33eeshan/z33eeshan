import { listOutreach, pipelineStats, TEMPLATES } from "@/lib/engine/outreach";
import { Card, Empty, Stat, num, pct } from "@/components/ui";
import { OutreachBoard } from "@/components/OutreachBoard";

export const dynamic = "force-dynamic";

export default function OutreachPage() {
  const records = listOutreach();
  const stats = pipelineStats();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Drafts" value={num(stats.byStage.draft ?? 0)} />
        <Stat label="Sent" value={num(stats.sent)} />
        <Stat
          label="Reply rate"
          value={stats.sent > 0 ? pct(stats.replyRate) : "—"}
          tone={stats.replyRate > 0.1 ? "good" : "neutral"}
          hint="10%+ is a good pitch"
        />
        <Stat
          label="Links won"
          value={num(stats.won)}
          tone={stats.won > 0 ? "good" : "neutral"}
          hint={stats.sent > 0 ? `${pct(stats.winRate)} of sent` : undefined}
        />
      </div>

      <Card title="How sending works here">
        <div className="space-y-2 text-sm leading-relaxed text-ink-700 dark:text-ink-300">
          <p>
            This tool drafts and tracks. It deliberately does not send email — that
            is a design decision, not a missing feature.
          </p>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Bulk sending from an app like this is how a domain lands on a blocklist:
            no warmup, no SPF/DKIM alignment with the sending domain, no bounce
            handling. Copy the draft into the real mailbox the recipient would expect
            to hear from, send it there, and paste replies back in. The link is won by
            the pitch, not the automation.
          </p>
        </div>
      </Card>

      <Card
        title="Pipeline"
        subtitle={`${num(records.length)} record(s). Update the stage as things move.`}
      >
        {records.length === 0 ? (
          <Empty title="No outreach drafted yet">
            Qualify a prospect on the Opportunities page, then hit &ldquo;Draft
            email&rdquo;. The template is picked automatically from the opportunity
            type.
          </Empty>
        ) : (
          <OutreachBoard records={records} />
        )}
      </Card>

      <Card
        title="Templates and why they work"
        subtitle="Every draft starts from one of these, chosen by opportunity type."
      >
        <div className="space-y-4">
          {TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="border-b border-ink-100 pb-4 last:border-0 last:pb-0 dark:border-ink-800/60"
            >
              <div className="text-sm font-medium">{t.label}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                {t.rationale}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
