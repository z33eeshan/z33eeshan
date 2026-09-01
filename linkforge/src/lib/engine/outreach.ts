import { config } from "@/lib/config";
import { ready } from "@/lib/db";

/**
 * Outreach pipeline.
 *
 * This module tracks and drafts. It deliberately does NOT send email.
 *
 * That is a design decision, not a missing feature. Bulk sending from an app
 * like this is how a domain ends up on a blocklist: no warmup, no SPF/DKIM
 * alignment with the sending domain, no bounce handling, no unsubscribe
 * plumbing. Draft here, send from the real mailbox the recipient would expect
 * to hear from, and paste replies back in. The link is won by the pitch, not by
 * the automation.
 */

export type Stage =
  | "draft"
  | "sent"
  | "followup_1"
  | "followup_2"
  | "replied"
  | "won"
  | "lost"
  | "bounced";

export const STAGES: Stage[] = [
  "draft",
  "sent",
  "followup_1",
  "followup_2",
  "replied",
  "won",
  "lost",
  "bounced",
];

export interface TemplateContext {
  siteName: string;
  siteUrl: string;
  prospectUrl: string;
  prospectDomain: string;
  prospectTitle?: string | null;
  contactName?: string | null;
  /** For unlinked mentions: where they mentioned you. */
  mentionUrl?: string | null;
  /** For broken-link outreach: the dead URL on their page. */
  brokenUrl?: string | null;
  /** Your page you are suggesting. */
  suggestedUrl?: string | null;
  senderName: string;
}

export interface Template {
  id: string;
  kind: string;
  label: string;
  /** Why this angle works, shown in the UI next to the draft. */
  rationale: string;
  subject: (c: TemplateContext) => string;
  body: (c: TemplateContext) => string;
}

const greeting = (c: TemplateContext): string =>
  c.contactName ? `Hi ${c.contactName},` : "Hi,";

const signoff = (c: TemplateContext): string =>
  `Thanks,\n${c.senderName}\n${c.siteName} — ${c.siteUrl}`;

export const TEMPLATES: Template[] = [
  {
    id: "unlinked_mention",
    kind: "unlinked_mention",
    label: "Unlinked mention — attribution request",
    rationale:
      "Highest conversion rate of any outreach type. They already chose to " +
      "mention you, so you are asking for a citation fix, not a favour. Keep it " +
      "to three sentences and make the exact change obvious.",
    subject: (c) => `Quick fix on your ${c.prospectDomain} piece`,
    body: (c) =>
      `${greeting(c)}\n\n` +
      `Thanks for mentioning ${c.siteName} in ${c.mentionUrl ?? c.prospectUrl} — ` +
      `much appreciated.\n\n` +
      `Would you mind linking the mention to ${c.suggestedUrl ?? c.siteUrl}? ` +
      `It saves readers searching for us, and it takes about ten seconds.\n\n` +
      `Either way, thanks for the write-up.\n\n${signoff(c)}`,
  },
  {
    id: "broken_link",
    kind: "broken_link",
    label: "Broken link — replacement suggestion",
    rationale:
      "You are doing them a favour first. Lead with the specific dead URL so " +
      "they can verify it in one click; a vague 'you have broken links' reads " +
      "as a template and gets deleted.",
    subject: (c) => `Dead link on ${c.prospectTitle ?? c.prospectDomain}`,
    body: (c) =>
      `${greeting(c)}\n\n` +
      `I was reading ${c.prospectUrl} and noticed the link to ` +
      `${c.brokenUrl ?? "one of the external resources"} returns a 404.\n\n` +
      `If you need a replacement, we have a piece covering the same ground: ` +
      `${c.suggestedUrl ?? c.siteUrl}. Use it or don't — either way I thought ` +
      `you would want to know about the dead link.\n\n${signoff(c)}`,
  },
  {
    id: "resource_page",
    kind: "resource_page",
    label: "Resource page — inclusion request",
    rationale:
      "Say specifically what your page adds that the list does not already " +
      "cover. Resource page curators get dozens of identical 'please add my " +
      "site' emails a week and ignore all of them.",
    subject: (c) => `Suggestion for your resources page`,
    body: (c) =>
      `${greeting(c)}\n\n` +
      `Your resources list at ${c.prospectUrl} is a useful roundup — I ended up ` +
      `on it while researching.\n\n` +
      `One suggestion: ${c.suggestedUrl ?? c.siteUrl}. ` +
      `[Replace this line with the specific gap it fills — what does it cover ` +
      `that nothing already on the list does?]\n\n` +
      `No worries if it is not a fit.\n\n${signoff(c)}`,
  },
  {
    id: "guest_post",
    kind: "guest_post",
    label: "Contribution pitch",
    rationale:
      "Pitch a specific headline and angle, not 'I would like to write for " +
      "you'. Editors commission ideas, not volunteers. Read their submission " +
      "guidelines before sending and match their format.",
    subject: (c) => `Pitch: [specific headline] for ${c.prospectDomain}`,
    body: (c) =>
      `${greeting(c)}\n\n` +
      `I write for ${c.siteName} (${c.siteUrl}) and saw you accept ` +
      `contributions at ${c.prospectUrl}.\n\n` +
      `One idea: [specific headline]. The angle would be [what is new or ` +
      `counterintuitive here], drawing on [your data, reporting or access].\n\n` +
      `Happy to send an outline or a full draft on spec. Would that be useful?\n\n` +
      `${signoff(c)}`,
  },
  {
    id: "competitor_gap",
    kind: "competitor_gap",
    label: "Relevance pitch (competitor gap)",
    rationale:
      "Never mention the competitor. The pitch is 'here is something useful for " +
      "your readers', and it must stand on its own merits — the gap analysis is " +
      "how you found them, not a reason for them to link.",
    subject: (c) => `Story idea for ${c.prospectDomain}`,
    body: (c) =>
      `${greeting(c)}\n\n` +
      `I run ${c.siteName} (${c.siteUrl}). We cover ` +
      `[your beat, specifically] and I thought this might fit what you publish.\n\n` +
      `[One sentence on the specific piece, data or story you are offering, and ` +
      `why their audience in particular would care.]\n\n` +
      `Worth a look? ${c.suggestedUrl ?? c.siteUrl}\n\n${signoff(c)}`,
  },
  {
    id: "followup",
    kind: "followup",
    label: "Follow-up (one only)",
    rationale:
      "Send at most one follow-up, roughly a week later. Two or more is where " +
      "outreach becomes spam, and it costs you the relationship for good.",
    subject: (c) => `Re: ${c.prospectDomain}`,
    body: (c) =>
      `${greeting(c)}\n\n` +
      `Bumping this once in case it got buried. If it is not a fit, no reply ` +
      `needed and I will not chase it again.\n\n${signoff(c)}`,
  },
];

export function templateFor(kind: string): Template {
  return TEMPLATES.find((t) => t.kind === kind) ?? TEMPLATES[4]!;
}

export function renderTemplate(
  template: Template,
  ctx: Partial<TemplateContext> & { prospectUrl: string; prospectDomain: string },
): { subject: string; body: string } {
  const full: TemplateContext = {
    siteName: ctx.siteName ?? config.targetSite,
    siteUrl: ctx.siteUrl ?? `https://${config.targetSite}`,
    senderName: ctx.senderName ?? "[your name]",
    prospectUrl: ctx.prospectUrl,
    prospectDomain: ctx.prospectDomain,
    prospectTitle: ctx.prospectTitle ?? null,
    contactName: ctx.contactName ?? null,
    mentionUrl: ctx.mentionUrl ?? null,
    brokenUrl: ctx.brokenUrl ?? null,
    suggestedUrl: ctx.suggestedUrl ?? null,
  };
  return { subject: template.subject(full), body: template.body(full) };
}

export interface OutreachRecord {
  id: number;
  prospectId: number;
  prospectUrl: string;
  prospectDomain: string;
  contactEmail: string | null;
  stage: Stage;
  subject: string | null;
  body: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  wonAt: string | null;
  wonUrl: string | null;
  notes: string | null;
}

export function createDraft(prospectId: number, contactId?: number | null): number {
  const conn = ready();
  const prospect = conn
    .prepare<[number], { url: string; domain: string; kind: string; title: string | null }>(
      "SELECT url, domain, kind, title FROM prospects WHERE id = ?",
    )
    .get(prospectId);

  if (!prospect) throw new Error(`Prospect ${prospectId} not found`);

  const contact = contactId
    ? conn
        .prepare<[number], { email: string; name: string | null }>(
          "SELECT email, name FROM contacts WHERE id = ?",
        )
        .get(contactId)
    : conn
        .prepare<[string], { id: number; email: string; name: string | null }>(
          "SELECT id, email, name FROM contacts WHERE domain = ? ORDER BY confidence DESC LIMIT 1",
        )
        .get(prospect.domain);

  const resolvedContactId =
    contactId ??
    (contact && "id" in contact ? (contact as { id: number }).id : null);

  const template = templateFor(prospect.kind);
  const { subject, body } = renderTemplate(template, {
    prospectUrl: prospect.url,
    prospectDomain: prospect.domain,
    prospectTitle: prospect.title,
    contactName: contact?.name ?? null,
    mentionUrl: prospect.kind === "unlinked_mention" ? prospect.url : null,
  });

  const info = conn
    .prepare(
      `INSERT INTO outreach (prospect_id, contact_id, stage, subject, body)
       VALUES (?, ?, 'draft', ?, ?)`,
    )
    .run(prospectId, resolvedContactId, subject, body);

  conn
    .prepare("UPDATE prospects SET status = 'queued' WHERE id = ? AND status IN ('new','qualified')")
    .run(prospectId);

  return Number(info.lastInsertRowid);
}

export function advanceStage(
  outreachId: number,
  stage: Stage,
  extra: { wonUrl?: string; notes?: string } = {},
): void {
  const conn = ready();
  const now = "datetime('now')";

  const timestampColumn =
    stage === "sent" || stage === "followup_1" || stage === "followup_2"
      ? "sent_at"
      : stage === "replied"
        ? "replied_at"
        : stage === "won"
          ? "won_at"
          : null;

  conn
    .prepare(
      `UPDATE outreach
          SET stage = ?,
              ${timestampColumn ? `${timestampColumn} = ${now},` : ""}
              won_url = COALESCE(?, won_url),
              notes = COALESCE(?, notes),
              updated_at = ${now}
        WHERE id = ?`,
    )
    .run(stage, extra.wonUrl ?? null, extra.notes ?? null, outreachId);

  // Keep the prospect's status in step so the pipeline board and the prospect
  // table never disagree about where something stands.
  const prospectStatus =
    stage === "won"
      ? "won"
      : stage === "lost" || stage === "bounced"
        ? "lost"
        : stage === "draft"
          ? "queued"
          : "contacted";

  conn
    .prepare(
      `UPDATE prospects SET status = ?
        WHERE id = (SELECT prospect_id FROM outreach WHERE id = ?)`,
    )
    .run(prospectStatus, outreachId);
}

export function listOutreach(stage?: Stage): OutreachRecord[] {
  const conn = ready();
  const sql = `
    SELECT o.id, o.prospect_id, p.url AS prospect_url, p.domain AS prospect_domain,
           c.email AS contact_email, o.stage, o.subject, o.body,
           o.sent_at, o.replied_at, o.won_at, o.won_url, o.notes
      FROM outreach o
      JOIN prospects p ON p.id = o.prospect_id
      LEFT JOIN contacts c ON c.id = o.contact_id
     ${stage ? "WHERE o.stage = ?" : ""}
     ORDER BY o.updated_at DESC
     LIMIT 500`;

  type Row = {
    id: number;
    prospect_id: number;
    prospect_url: string;
    prospect_domain: string;
    contact_email: string | null;
    stage: Stage;
    subject: string | null;
    body: string | null;
    sent_at: string | null;
    replied_at: string | null;
    won_at: string | null;
    won_url: string | null;
    notes: string | null;
  };

  const rows = stage
    ? conn.prepare<[Stage], Row>(sql).all(stage)
    : conn.prepare<[], Row>(sql).all();

  return rows.map((r) => ({
    id: r.id,
    prospectId: r.prospect_id,
    prospectUrl: r.prospect_url,
    prospectDomain: r.prospect_domain,
    contactEmail: r.contact_email,
    stage: r.stage,
    subject: r.subject,
    body: r.body,
    sentAt: r.sent_at,
    repliedAt: r.replied_at,
    wonAt: r.won_at,
    wonUrl: r.won_url,
    notes: r.notes,
  }));
}

export interface PipelineStats {
  byStage: Record<string, number>;
  sent: number;
  replied: number;
  won: number;
  replyRate: number;
  winRate: number;
}

export function pipelineStats(): PipelineStats {
  const rows = ready()
    .prepare<[], { stage: string; n: number }>(
      "SELECT stage, COUNT(*) AS n FROM outreach GROUP BY stage",
    )
    .all();

  const byStage: Record<string, number> = {};
  for (const s of STAGES) byStage[s] = 0;
  for (const r of rows) byStage[r.stage] = r.n;

  // Anything past draft has been sent, including the terminal outcomes.
  const sent =
    (byStage.sent ?? 0) +
    (byStage.followup_1 ?? 0) +
    (byStage.followup_2 ?? 0) +
    (byStage.replied ?? 0) +
    (byStage.won ?? 0) +
    (byStage.lost ?? 0) +
    (byStage.bounced ?? 0);
  const replied = (byStage.replied ?? 0) + (byStage.won ?? 0);
  const won = byStage.won ?? 0;

  return {
    byStage,
    sent,
    replied,
    won,
    replyRate: sent > 0 ? replied / sent : 0,
    winRate: sent > 0 ? won / sent : 0,
  };
}
