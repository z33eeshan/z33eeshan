import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { config } from "@/lib/config";
import { getSetting, setSetting } from "@/lib/db";

/**
 * Google Search Console integration.
 *
 * Worth being precise about what GSC does and does not give you, because it
 * drives the whole design here:
 *
 *  - The Search Analytics API (queries, clicks, impressions, positions) is
 *    fully available programmatically. We use it for relevance signals and to
 *    tie link gains to ranking movement.
 *  - The LINKS report (the "Top linking sites" page) has NO public API. Google
 *    has never exposed it. The only way to get that data is the CSV export
 *    from the Search Console UI, so the app accepts that CSV as an import and
 *    treats it as the authoritative seed list for your own backlinks.
 *
 * That import path is not a workaround for a missing key — it is the only
 * route that exists, for every tool on the market.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

const TOKEN_KEY = "gsc_tokens";

export function oauthClient(): OAuth2Client {
  if (!config.google.configured) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

export function authUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  // Google only returns a refresh_token on the first consent. Preserve the one
  // we already hold so a re-auth doesn't silently break offline access.
  const existing = loadTokens();
  const merged = {
    ...existing,
    ...tokens,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token,
  };
  setSetting(TOKEN_KEY, JSON.stringify(merged));
}

type StoredTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  // Google's Credentials type allows undefined but not null here, and JSON
  // round-tripping can produce null, so it is normalised on load.
  scope?: string;
};

function loadTokens(): StoredTokens | null {
  const raw = getSetting(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredTokens & { scope?: string | null };
    return { ...parsed, scope: parsed.scope ?? undefined };
  } catch {
    return null;
  }
}

export function isConnected(): boolean {
  const t = loadTokens();
  return Boolean(t?.refresh_token || t?.access_token);
}

export function disconnect(): void {
  setSetting(TOKEN_KEY, JSON.stringify({}));
}

async function authorised(): Promise<OAuth2Client> {
  const tokens = loadTokens();
  if (!tokens || (!tokens.refresh_token && !tokens.access_token)) {
    throw new Error("Search Console is not connected. Authorise it in Settings.");
  }
  const client = oauthClient();
  client.setCredentials(tokens);
  // Persist refreshed access tokens so we don't re-mint one on every request.
  client.on("tokens", (fresh) => {
    const merged = {
      ...loadTokens(),
      ...fresh,
      refresh_token: fresh.refresh_token ?? loadTokens()?.refresh_token,
    };
    setSetting(TOKEN_KEY, JSON.stringify(merged));
  });
  return client;
}

export async function listSites(): Promise<{ siteUrl: string; permission: string }[]> {
  const auth = await authorised();
  const api = google.webmasters({ version: "v3", auth });
  const res = await api.sites.list();
  return (res.data.siteEntry ?? [])
    .filter((s) => s.siteUrl)
    .map((s) => ({
      siteUrl: s.siteUrl!,
      permission: s.permissionLevel ?? "unknown",
    }));
}

export interface QueryRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function searchAnalytics(opts: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: ("query" | "page" | "country" | "device" | "date")[];
  rowLimit?: number;
  startRow?: number;
}): Promise<QueryRow[]> {
  const auth = await authorised();
  const api = google.searchconsole({ version: "v1", auth });

  const res = await api.searchanalytics.query({
    siteUrl: opts.siteUrl,
    requestBody: {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: opts.dimensions ?? ["query"],
      rowLimit: opts.rowLimit ?? 1000,
      startRow: opts.startRow ?? 0,
      type: "web",
    },
  });

  return (res.data.rows ?? []).map((r) => ({
    keys: r.keys ?? [],
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));
}

/**
 * Pulls the site's top queries and turns them into a topic vocabulary. The
 * relevance scorer uses this so "on topic" means "matches what this site
 * actually ranks for", not a hand-written keyword guess.
 */
export async function topicVocabulary(
  siteUrl: string,
  days = 90,
): Promise<{ term: string; weight: number }[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const rows = await searchAnalytics({
    siteUrl,
    startDate: fmt(start),
    endDate: fmt(end),
    dimensions: ["query"],
    rowLimit: 2000,
  });

  const weights = new Map<string, number>();
  for (const row of rows) {
    const query = row.keys[0];
    if (!query) continue;
    for (const token of tokenise(query)) {
      // Impressions, not clicks: we want topical breadth, and a term can be
      // highly relevant while ranking too poorly to earn clicks yet.
      weights.set(token, (weights.get(token) ?? 0) + row.impressions);
    }
  }

  const max = Math.max(1, ...weights.values());
  return [...weights.entries()]
    .map(([term, w]) => ({ term, weight: w / max }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 400);
}

const STOPWORDS = new Set(
  ("a an the and or but if then than that this these those of in on at to for with by from as is are was were be been being " +
    "it its his her their our your my not no do does did how what when where why who which will would can could should " +
    "you i we they he she them us me him about into over under again more most other some such only own same so too very " +
    "news latest today update updates live com www http https org net")
    .split(" "),
);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length >= 3 && t.length <= 32 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}
