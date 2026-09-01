import { ready } from "@/lib/db";
import { fetchPage } from "./fetcher";
import { findLinksTo, parsePage } from "./linkparser";
import { registrableDomain } from "./url";

export interface VerifyOutcome {
  sourceUrl: string;
  status: "live" | "lost" | "unreachable";
  httpStatus: number;
  /** Present when the link is still there — attributes may have changed. */
  anchorText?: string;
  rel?: string | null;
  isNofollow?: boolean;
  isSponsored?: boolean;
  isUgc?: boolean;
  position?: string;
  changed: string[];
  error?: string;
}

/**
 * Re-fetches a linking page and confirms the link is still present.
 *
 * This is the part vendors get wrong most often: an index says a link exists,
 * but the page was edited three months ago and the link is now nofollow, or
 * gone entirely. Verifying against the live page is the only source of truth,
 * and it's the one thing we can do as well as anyone.
 */
export async function verifyBacklink(
  sourceUrl: string,
  targetDomain: string,
  known?: { anchorText?: string | null; isNofollow?: boolean },
): Promise<VerifyOutcome> {
  const res = await fetchPage(sourceUrl, { revalidate: false });

  if (!res.ok || !res.html) {
    // A 404/410 is a real "lost". A timeout or block is not — calling those
    // "lost" would generate false alarms every time a host rate-limits us.
    const definitivelyGone = res.status === 404 || res.status === 410;
    return {
      sourceUrl,
      status: definitivelyGone ? "lost" : "unreachable",
      httpStatus: res.status,
      changed: [],
      error: res.error ?? undefined,
    };
  }

  const page = parsePage(res.html, res.finalUrl);
  const hits = findLinksTo(page, targetDomain);

  if (hits.length === 0) {
    return { sourceUrl, status: "lost", httpStatus: res.status, changed: ["removed"] };
  }

  // Prefer the most valuable instance: a followed in-content link beats a
  // nofollowed footer link on the same page.
  const best =
    hits.find((h) => !h.isNofollow && h.position === "content") ??
    hits.find((h) => !h.isNofollow) ??
    hits[0]!;

  const changed: string[] = [];
  if (known?.anchorText != null && known.anchorText !== best.anchorText) {
    changed.push("anchor");
  }
  if (known?.isNofollow != null && known.isNofollow !== best.isNofollow) {
    changed.push(best.isNofollow ? "became-nofollow" : "became-follow");
  }

  return {
    sourceUrl,
    status: "live",
    httpStatus: res.status,
    anchorText: best.anchorText,
    rel: best.rel,
    isNofollow: best.isNofollow,
    isSponsored: best.isSponsored,
    isUgc: best.isUgc,
    position: best.position,
    changed,
  };
}

export interface VerifyRunSummary {
  checked: number;
  live: number;
  lost: number;
  unreachable: number;
  changes: { sourceUrl: string; changed: string[] }[];
}

/**
 * Verifies a batch of stored backlinks and writes the results back.
 * `onProgress` lets the job runner stream progress into the jobs table.
 */
export async function verifyBatch(
  targetDomain: string,
  limit = 100,
  onProgress?: (done: number, total: number) => void,
): Promise<VerifyRunSummary> {
  const conn = ready();
  const domain = registrableDomain(targetDomain) ?? targetDomain;

  const rows = conn
    .prepare<
      [string, number],
      { id: number; source_url: string; anchor_text: string | null; is_nofollow: number }
    >(
      `SELECT id, source_url, anchor_text, is_nofollow
         FROM backlinks
        WHERE target_domain = ?
          AND status != 'lost'
        ORDER BY COALESCE(last_verified, '1970-01-01') ASC
        LIMIT ?`,
    )
    .all(domain, limit);

  const update = conn.prepare(
    `UPDATE backlinks
        SET status = ?, http_status = ?, last_verified = datetime('now'),
            anchor_text = COALESCE(?, anchor_text),
            rel = COALESCE(?, rel),
            is_nofollow = COALESCE(?, is_nofollow),
            is_sponsored = COALESCE(?, is_sponsored),
            is_ugc = COALESCE(?, is_ugc),
            link_position = COALESCE(?, link_position)
      WHERE id = ?`,
  );

  const summary: VerifyRunSummary = {
    checked: 0,
    live: 0,
    lost: 0,
    unreachable: 0,
    changes: [],
  };

  let done = 0;
  const outcomes = await Promise.all(
    rows.map(async (row) => {
      const outcome = await verifyBacklink(row.source_url, domain, {
        anchorText: row.anchor_text,
        isNofollow: row.is_nofollow === 1,
      });
      done++;
      onProgress?.(done, rows.length);
      return { row, outcome };
    }),
  );

  const writeAll = conn.transaction(() => {
    for (const { row, outcome } of outcomes) {
      update.run(
        outcome.status,
        outcome.httpStatus || null,
        outcome.anchorText ?? null,
        outcome.rel ?? null,
        outcome.isNofollow === undefined ? null : outcome.isNofollow ? 1 : 0,
        outcome.isSponsored === undefined ? null : outcome.isSponsored ? 1 : 0,
        outcome.isUgc === undefined ? null : outcome.isUgc ? 1 : 0,
        outcome.position ?? null,
        row.id,
      );
      summary.checked++;
      if (outcome.status === "live") summary.live++;
      else if (outcome.status === "lost") summary.lost++;
      else summary.unreachable++;
      if (outcome.changed.length > 0) {
        summary.changes.push({ sourceUrl: row.source_url, changed: outcome.changed });
      }
    }
  });
  writeAll();

  return summary;
}
