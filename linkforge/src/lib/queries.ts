import { config } from "@/lib/config";
import { ready } from "@/lib/db";
import { registrableDomain } from "@/lib/engine/url";

/** Read models for the dashboard. Kept in one place so pages stay thin. */

export interface Overview {
  targetDomain: string;
  totalBacklinks: number;
  referringDomains: number;
  liveBacklinks: number;
  lostBacklinks: number;
  unverifiedBacklinks: number;
  followRatio: number;
  medianAuthority: number | null;
  toxicDomains: number;
  reviewDomains: number;
  prospects: { total: number; new: number; won: number };
  lastVerified: string | null;
}

export function overview(targetSite = config.targetSite): Overview {
  const conn = ready();
  const targetDomain = registrableDomain(targetSite) ?? targetSite;

  const links = conn
    .prepare<
      [string],
      {
        total: number;
        refdomains: number;
        live: number;
        lost: number;
        unverified: number;
        follows: number;
        last_verified: string | null;
      }
    >(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT source_domain) AS refdomains,
              SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) AS live,
              SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost,
              SUM(CASE WHEN status = 'unverified' THEN 1 ELSE 0 END) AS unverified,
              SUM(CASE WHEN is_nofollow = 0 THEN 1 ELSE 0 END) AS follows,
              MAX(last_verified) AS last_verified
         FROM backlinks WHERE target_domain = ?`,
    )
    .get(targetDomain);

  const spam = conn
    .prepare<[string], { toxic: number; review: number }>(
      `SELECT SUM(CASE WHEN d.spam_score >= 70 THEN 1 ELSE 0 END) AS toxic,
              SUM(CASE WHEN d.spam_score >= 45 AND d.spam_score < 70 THEN 1 ELSE 0 END) AS review
         FROM domains d
         JOIN (SELECT DISTINCT source_domain FROM backlinks
                WHERE target_domain = ? AND status != 'lost') b
           ON b.source_domain = d.domain`,
    )
    .get(targetDomain);

  const authorities = conn
    .prepare<[string], { authority: number }>(
      `SELECT d.authority
         FROM domains d
         JOIN (SELECT DISTINCT source_domain FROM backlinks
                WHERE target_domain = ? AND status != 'lost') b
           ON b.source_domain = d.domain
        WHERE d.authority IS NOT NULL
        ORDER BY d.authority`,
    )
    .all(targetDomain)
    .map((r) => r.authority);

  const prospectRow = conn
    .prepare<[], { total: number; fresh: number; won: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS fresh,
              SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won
         FROM prospects`,
    )
    .get();

  const mid = Math.floor(authorities.length / 2);
  const medianAuthority =
    authorities.length === 0
      ? null
      : authorities.length % 2 === 1
        ? authorities[mid]!
        : (authorities[mid - 1]! + authorities[mid]!) / 2;

  return {
    targetDomain,
    totalBacklinks: links?.total ?? 0,
    referringDomains: links?.refdomains ?? 0,
    liveBacklinks: links?.live ?? 0,
    lostBacklinks: links?.lost ?? 0,
    unverifiedBacklinks: links?.unverified ?? 0,
    followRatio: links && links.total > 0 ? (links.follows ?? 0) / links.total : 0,
    medianAuthority,
    toxicDomains: spam?.toxic ?? 0,
    reviewDomains: spam?.review ?? 0,
    prospects: {
      total: prospectRow?.total ?? 0,
      new: prospectRow?.fresh ?? 0,
      won: prospectRow?.won ?? 0,
    },
    lastVerified: links?.last_verified ?? null,
  };
}

export interface BacklinkRow {
  id: number;
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  anchorText: string | null;
  isNofollow: boolean;
  isSponsored: boolean;
  isUgc: boolean;
  position: string | null;
  status: string;
  authority: number | null;
  spamScore: number | null;
  discoveredVia: string;
  firstSeen: string;
  lastVerified: string | null;
}

export function backlinks(opts: {
  targetSite?: string;
  status?: string;
  minAuthority?: number;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "authority" | "spam" | "recent";
}): { rows: BacklinkRow[]; total: number } {
  const conn = ready();
  const targetDomain =
    registrableDomain(opts.targetSite ?? config.targetSite) ??
    (opts.targetSite ?? config.targetSite);

  const where: string[] = ["b.target_domain = ?"];
  const params: (string | number)[] = [targetDomain];

  if (opts.status && opts.status !== "all") {
    where.push("b.status = ?");
    params.push(opts.status);
  }
  if (opts.minAuthority != null && opts.minAuthority > 0) {
    where.push("COALESCE(d.authority, 0) >= ?");
    params.push(opts.minAuthority);
  }
  if (opts.search?.trim()) {
    where.push("(b.source_domain LIKE ? OR b.anchor_text LIKE ? OR b.source_url LIKE ?)");
    const like = `%${opts.search.trim()}%`;
    params.push(like, like, like);
  }

  const whereSql = where.join(" AND ");
  const orderSql =
    opts.sort === "spam"
      ? "COALESCE(d.spam_score, -1) DESC"
      : opts.sort === "recent"
        ? "b.first_seen DESC"
        : "COALESCE(d.authority, -1) DESC";

  const total =
    conn
      .prepare<(string | number)[], { n: number }>(
        `SELECT COUNT(*) AS n FROM backlinks b
           LEFT JOIN domains d ON d.domain = b.source_domain
          WHERE ${whereSql}`,
      )
      .get(...params)?.n ?? 0;

  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  const rows = conn
    .prepare<
      (string | number)[],
      {
        id: number;
        source_url: string;
        source_domain: string;
        target_url: string;
        anchor_text: string | null;
        is_nofollow: number;
        is_sponsored: number;
        is_ugc: number;
        link_position: string | null;
        status: string;
        authority: number | null;
        spam_score: number | null;
        discovered_via: string;
        first_seen: string;
        last_verified: string | null;
      }
    >(
      `SELECT b.id, b.source_url, b.source_domain, b.target_url, b.anchor_text,
              b.is_nofollow, b.is_sponsored, b.is_ugc, b.link_position, b.status,
              d.authority, d.spam_score, b.discovered_via, b.first_seen, b.last_verified
         FROM backlinks b
         LEFT JOIN domains d ON d.domain = b.source_domain
        WHERE ${whereSql}
        ORDER BY ${orderSql}
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      sourceUrl: r.source_url,
      sourceDomain: r.source_domain,
      targetUrl: r.target_url,
      anchorText: r.anchor_text,
      isNofollow: r.is_nofollow === 1,
      isSponsored: r.is_sponsored === 1,
      isUgc: r.is_ugc === 1,
      position: r.link_position,
      status: r.status,
      authority: r.authority,
      spamScore: r.spam_score,
      discoveredVia: r.discovered_via,
      firstSeen: r.first_seen,
      lastVerified: r.last_verified,
    })),
  };
}

export interface ProspectListRow {
  id: number;
  url: string;
  domain: string;
  kind: string;
  title: string | null;
  authority: number | null;
  relevance: number | null;
  spamScore: number | null;
  difficulty: number | null;
  priority: number;
  status: string;
  evidence: Record<string, unknown>;
  contactCount: number;
  discoveredAt: string;
}

export function prospects(opts: {
  kind?: string;
  status?: string;
  limit?: number;
  offset?: number;
  minPriority?: number;
}): { rows: ProspectListRow[]; total: number } {
  const conn = ready();
  const where: string[] = ["1=1"];
  const params: (string | number)[] = [];

  if (opts.kind && opts.kind !== "all") {
    where.push("p.kind = ?");
    params.push(opts.kind);
  }
  if (opts.status && opts.status !== "all") {
    where.push("p.status = ?");
    params.push(opts.status);
  }
  if (opts.minPriority != null && opts.minPriority > 0) {
    where.push("p.priority >= ?");
    params.push(opts.minPriority);
  }

  const whereSql = where.join(" AND ");
  const total =
    conn
      .prepare<(string | number)[], { n: number }>(
        `SELECT COUNT(*) AS n FROM prospects p WHERE ${whereSql}`,
      )
      .get(...params)?.n ?? 0;

  const rows = conn
    .prepare<
      (string | number)[],
      {
        id: number;
        url: string;
        domain: string;
        kind: string;
        title: string | null;
        authority: number | null;
        relevance: number | null;
        spam_score: number | null;
        difficulty: number | null;
        priority: number;
        status: string;
        evidence: string | null;
        contact_count: number;
        discovered_at: string;
      }
    >(
      `SELECT p.*, (SELECT COUNT(*) FROM contacts c WHERE c.domain = p.domain) AS contact_count
         FROM prospects p
        WHERE ${whereSql}
        ORDER BY p.priority DESC, p.discovered_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit ?? 100, opts.offset ?? 0);

  return {
    total,
    rows: rows.map((r) => {
      let evidence: Record<string, unknown> = {};
      try {
        evidence = JSON.parse(r.evidence ?? "{}") as Record<string, unknown>;
      } catch {
        evidence = {};
      }
      return {
        id: r.id,
        url: r.url,
        domain: r.domain,
        kind: r.kind,
        title: r.title,
        authority: r.authority,
        relevance: r.relevance,
        spamScore: r.spam_score,
        difficulty: r.difficulty,
        priority: r.priority,
        status: r.status,
        evidence,
        contactCount: r.contact_count,
        discoveredAt: r.discovered_at,
      };
    }),
  };
}

export interface SnapshotRow {
  takenAt: string;
  referringDomains: number;
  liveBacklinks: number;
  lostBacklinks: number;
  medianAuthority: number | null;
  toxicDomains: number;
}

export function snapshots(targetSite = config.targetSite, limit = 60): SnapshotRow[] {
  const targetDomain = registrableDomain(targetSite) ?? targetSite;
  return ready()
    .prepare<
      [string, number],
      {
        taken_at: string;
        referring_domains: number;
        live_backlinks: number;
        lost_backlinks: number;
        median_authority: number | null;
        toxic_domains: number;
      }
    >(
      `SELECT taken_at, referring_domains, live_backlinks, lost_backlinks,
              median_authority, toxic_domains
         FROM link_snapshots
        WHERE target_domain = ?
        ORDER BY taken_at DESC
        LIMIT ?`,
    )
    .all(targetDomain, limit)
    .reverse()
    .map((r) => ({
      takenAt: r.taken_at,
      referringDomains: r.referring_domains,
      liveBacklinks: r.live_backlinks,
      lostBacklinks: r.lost_backlinks,
      medianAuthority: r.median_authority,
      toxicDomains: r.toxic_domains,
    }));
}

export interface ReferringDomainRow {
  domain: string;
  links: number;
  authority: number | null;
  spamScore: number | null;
  signals: string[];
  followLinks: number;
  lastCrawled: string | null;
  title: string | null;
}

export function referringDomains(
  targetSite = config.targetSite,
  opts: { minSpam?: number; limit?: number } = {},
): ReferringDomainRow[] {
  const targetDomain = registrableDomain(targetSite) ?? targetSite;
  const rows = ready()
    .prepare<
      [string, number, number],
      {
        domain: string;
        links: number;
        follow_links: number;
        authority: number | null;
        spam_score: number | null;
        spam_signals: string | null;
        last_crawled: string | null;
        title: string | null;
      }
    >(
      `SELECT b.source_domain AS domain,
              COUNT(*) AS links,
              SUM(CASE WHEN b.is_nofollow = 0 THEN 1 ELSE 0 END) AS follow_links,
              d.authority, d.spam_score, d.spam_signals, d.last_crawled, d.title
         FROM backlinks b
         LEFT JOIN domains d ON d.domain = b.source_domain
        WHERE b.target_domain = ? AND b.status != 'lost'
        GROUP BY b.source_domain
       HAVING COALESCE(d.spam_score, 0) >= ?
        ORDER BY COALESCE(d.spam_score, 0) DESC, links DESC
        LIMIT ?`,
    )
    .all(targetDomain, opts.minSpam ?? 0, opts.limit ?? 200);

  return rows.map((r) => {
    let signals: string[] = [];
    try {
      signals = JSON.parse(r.spam_signals ?? "[]") as string[];
    } catch {
      signals = [];
    }
    return {
      domain: r.domain,
      links: r.links,
      followLinks: r.follow_links,
      authority: r.authority,
      spamScore: r.spam_score,
      signals,
      lastCrawled: r.last_crawled,
      title: r.title,
    };
  });
}
