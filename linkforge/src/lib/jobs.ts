import { config } from "@/lib/config";
import { ready } from "@/lib/db";
import { discoverLinkingPages, takeSnapshot } from "@/lib/engine/discover";
import { competitorGap, resourcePages, unlinkedMentions } from "@/lib/engine/prospect";
import { auditReferringDomains } from "@/lib/engine/spam";
import { verifyBatch } from "@/lib/engine/verifier";
import { discoverContacts } from "@/lib/engine/contacts";
import { resolveAuthority } from "@/lib/providers/authority";
import { registrableDomain } from "@/lib/engine/url";

/**
 * Job queue.
 *
 * Crawls take minutes, which is longer than a serverless request should live.
 * Jobs are rows in SQLite; the dashboard enqueues and polls, and a worker
 * (`npm run worker`, or the in-process runner below) executes them. That keeps
 * long crawls off the request path without adding Redis or a broker for what is
 * a single-site tool.
 */

export type JobKind =
  | "verify_backlinks"
  | "discover_linking_pages"
  | "audit_domains"
  | "resolve_authority"
  | "find_competitor_gaps"
  | "find_unlinked_mentions"
  | "find_resource_pages"
  | "discover_contacts"
  | "snapshot";

export interface Job {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  total: number | null;
  processed: number;
  message: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function enqueue(kind: JobKind, payload: Record<string, unknown> = {}): number {
  const info = ready()
    .prepare("INSERT INTO jobs (kind, payload) VALUES (?, ?)")
    .run(kind, JSON.stringify(payload));
  return Number(info.lastInsertRowid);
}

export function getJob(id: number): Job | null {
  const row = ready()
    .prepare<[number], Record<string, unknown>>("SELECT * FROM jobs WHERE id = ?")
    .get(id);
  return row ? hydrate(row) : null;
}

export function listJobs(limit = 25): Job[] {
  return ready()
    .prepare<[number], Record<string, unknown>>(
      "SELECT * FROM jobs ORDER BY id DESC LIMIT ?",
    )
    .all(limit)
    .map(hydrate);
}

function hydrate(row: Record<string, unknown>): Job {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(String(row.payload ?? "{}")) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    id: Number(row.id),
    kind: String(row.kind) as JobKind,
    payload,
    status: String(row.status) as Job["status"],
    progress: Number(row.progress ?? 0),
    total: row.total == null ? null : Number(row.total),
    processed: Number(row.processed ?? 0),
    message: (row.message as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

function setProgress(id: number, processed: number, total: number, message?: string): void {
  ready()
    .prepare(
      `UPDATE jobs SET processed = ?, total = ?, progress = ?, message = COALESCE(?, message)
        WHERE id = ?`,
    )
    .run(processed, total, total > 0 ? processed / total : 0, message ?? null, id);
}

/**
 * Claims the next queued job atomically, so two workers cannot pick up the same
 * row.
 */
export function claimNext(): Job | null {
  const conn = ready();
  const claim = conn.transaction((): Job | null => {
    const row = conn
      .prepare<[], Record<string, unknown>>(
        "SELECT * FROM jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1",
      )
      .get();
    if (!row) return null;
    conn
      .prepare(
        "UPDATE jobs SET status = 'running', started_at = datetime('now') WHERE id = ?",
      )
      .run(row.id);
    return hydrate({ ...row, status: "running" });
  });
  return claim();
}

function finish(id: number, message: string): void {
  ready()
    .prepare(
      `UPDATE jobs SET status = 'done', progress = 1, message = ?, finished_at = datetime('now')
        WHERE id = ?`,
    )
    .run(message, id);
}

function fail(id: number, error: string): void {
  ready()
    .prepare(
      `UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now')
        WHERE id = ?`,
    )
    .run(error, id);
}

export async function runJob(job: Job): Promise<void> {
  const targetSite = String(job.payload.targetSite ?? config.targetSite);

  try {
    switch (job.kind) {
      case "verify_backlinks": {
        const limit = Number(job.payload.limit ?? 100);
        const summary = await verifyBatch(targetSite, limit, (done, total) =>
          setProgress(job.id, done, total),
        );
        takeSnapshot(targetSite);
        finish(
          job.id,
          `Checked ${summary.checked}: ${summary.live} live, ${summary.lost} lost, ` +
            `${summary.unreachable} unreachable, ${summary.changes.length} changed.`,
        );
        break;
      }

      case "discover_linking_pages": {
        const domains = Array.isArray(job.payload.domains)
          ? (job.payload.domains as string[])
          : pendingDiscoveryDomains(targetSite, Number(job.payload.limit ?? 25));

        let found = 0;
        let checked = 0;
        for (const [i, domain] of domains.entries()) {
          const res = await discoverLinkingPages(domain, targetSite, {
            maxPages: Number(job.payload.maxPages ?? 40),
          });
          found += res.linksFound;
          checked += res.pagesChecked;
          setProgress(job.id, i + 1, domains.length, `${domain}: ${res.linksFound} link(s)`);
        }
        finish(
          job.id,
          `Crawled ${checked} page(s) across ${domains.length} domain(s), found ${found} link(s).`,
        );
        break;
      }

      case "audit_domains": {
        const siteLanguage = String(job.payload.siteLanguage ?? "en");
        const assessments = auditReferringDomains(targetSite, siteLanguage);
        const toxic = assessments.filter((a) => a.recommendation === "disavow").length;
        const review = assessments.filter((a) => a.recommendation === "review").length;
        setProgress(job.id, assessments.length, assessments.length);
        finish(
          job.id,
          `Scored ${assessments.length} referring domain(s): ${toxic} flagged for disavow, ${review} for review.`,
        );
        break;
      }

      case "resolve_authority": {
        const conn = ready();
        const domains = Array.isArray(job.payload.domains)
          ? (job.payload.domains as string[])
          : conn
              .prepare<[], { domain: string }>(
                `SELECT domain FROM domains WHERE authority IS NULL LIMIT 1000`,
              )
              .all()
              .map((r) => r.domain);

        const resolved = await resolveAuthority(domains);
        const withScore = [...resolved.values()].filter((r) => r.score != null).length;
        setProgress(job.id, domains.length, domains.length);
        finish(job.id, `Resolved authority for ${withScore}/${domains.length} domain(s).`);
        break;
      }

      case "find_competitor_gaps": {
        const competitors = Array.isArray(job.payload.competitors)
          ? (job.payload.competitors as string[])
          : config.competitors;
        const { prospects, note } = await competitorGap(competitors, {
          crawl: Boolean(job.payload.crawl),
          limit: Number(job.payload.limit ?? 200),
        });
        finish(job.id, `${prospects.length} prospect(s). ${note}`);
        break;
      }

      case "find_unlinked_mentions": {
        const { prospects, note } = await unlinkedMentions({
          brandTerms: Array.isArray(job.payload.brandTerms)
            ? (job.payload.brandTerms as string[])
            : undefined,
          manualUrls: job.payload.manualUrls ? String(job.payload.manualUrls) : undefined,
          limit: Number(job.payload.limit ?? 100),
        });
        finish(job.id, `${prospects.length} unlinked mention(s). ${note}`);
        break;
      }

      case "find_resource_pages": {
        const seeds = Array.isArray(job.payload.seedDomains)
          ? (job.payload.seedDomains as string[])
          : [];
        const { prospects, note } = await resourcePages(seeds, {
          crawl: Boolean(job.payload.crawl),
          perDomain: Number(job.payload.perDomain ?? 200),
        });
        finish(job.id, `${prospects.length} prospect(s). ${note}`);
        break;
      }

      case "discover_contacts": {
        const conn = ready();
        const domains = Array.isArray(job.payload.domains)
          ? (job.payload.domains as string[])
          : conn
              .prepare<[number], { domain: string }>(
                `SELECT DISTINCT p.domain
                   FROM prospects p
                   LEFT JOIN contacts c ON c.domain = p.domain
                  WHERE c.id IS NULL AND p.status IN ('new','qualified','queued')
                  ORDER BY p.priority DESC
                  LIMIT ?`,
              )
              .all(Number(job.payload.limit ?? 25))
              .map((r) => r.domain);

        let total = 0;
        for (const [i, domain] of domains.entries()) {
          const contacts = await discoverContacts(domain);
          total += contacts.length;
          setProgress(job.id, i + 1, domains.length, `${domain}: ${contacts.length} contact(s)`);
        }
        finish(job.id, `Found ${total} contact(s) across ${domains.length} domain(s).`);
        break;
      }

      case "snapshot": {
        takeSnapshot(targetSite);
        finish(job.id, "Snapshot recorded.");
        break;
      }

      default: {
        fail(job.id, `Unknown job kind: ${String(job.kind)}`);
      }
    }
  } catch (err) {
    fail(job.id, err instanceof Error ? `${err.message}` : String(err));
  }
}

/** Referring domains we know about but have not yet crawled for exact pages. */
function pendingDiscoveryDomains(targetSite: string, limit: number): string[] {
  const targetDomain = registrableDomain(targetSite) ?? targetSite;
  return ready()
    .prepare<[string, number], { source_domain: string }>(
      `SELECT DISTINCT b.source_domain
         FROM backlinks b
         LEFT JOIN domains d ON d.domain = b.source_domain
        WHERE b.target_domain = ?
          AND (d.last_crawled IS NULL OR d.last_crawled < datetime('now', '-30 days'))
        ORDER BY b.source_domain
        LIMIT ?`,
    )
    .all(targetDomain, limit)
    .map((r) => r.source_domain);
}

/** Drains the queue. Used by both the CLI worker and the dev in-process runner. */
export async function drain(maxJobs = Infinity): Promise<number> {
  let ran = 0;
  while (ran < maxJobs) {
    const job = claimNext();
    if (!job) break;
    await runJob(job);
    ran++;
  }
  return ran;
}

let runnerActive = false;

/**
 * Fire-and-forget drain, so clicking a button in the dashboard starts work
 * without needing a separate worker process during development. Guarded so
 * concurrent API calls do not start overlapping drains.
 */
export function kickRunner(): void {
  if (runnerActive) return;
  runnerActive = true;
  void drain()
    .catch(() => undefined)
    .finally(() => {
      runnerActive = false;
    });
}
