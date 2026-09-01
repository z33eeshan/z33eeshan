import path from "node:path";

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(name: string): string[] {
  return str(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  targetSite: str("TARGET_SITE", "livenewsof.com"),
  brandTerms: list("BRAND_TERMS"),
  competitors: list("COMPETITORS"),

  databasePath: path.resolve(
    process.cwd(),
    str("DATABASE_PATH", "./data/linkforge.db"),
  ),

  crawler: {
    userAgent: str(
      "CRAWLER_USER_AGENT",
      "LinkForgeBot/0.1 (+https://example.com/bot)",
    ),
    hostDelayMs: int("CRAWLER_HOST_DELAY_MS", 1500),
    concurrency: int("CRAWLER_CONCURRENCY", 5),
    maxBytes: int("CRAWLER_MAX_BYTES", 3_000_000),
    timeoutMs: int("CRAWLER_TIMEOUT_MS", 20_000),
  },

  google: {
    clientId: str("GOOGLE_CLIENT_ID"),
    clientSecret: str("GOOGLE_CLIENT_SECRET"),
    redirectUri: str(
      "GOOGLE_REDIRECT_URI",
      "http://localhost:3000/api/auth/google/callback",
    ),
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  sessionSecret: str("SESSION_SECRET"),

  openPageRankKey: str("OPENPAGERANK_API_KEY"),
  domainRanksUrl: str("DOMAIN_RANKS_URL"),

  serp: {
    provider: str("SERP_PROVIDER", "none") as "none" | "brave",
    braveKey: str("BRAVE_SEARCH_API_KEY"),
  },
} as const;

/**
 * Which features are usable right now. The dashboard renders this so the setup
 * state is visible instead of surfacing as a confusing empty table.
 */
export function featureAvailability() {
  return [
    {
      id: "crawler",
      label: "Crawler & link verification",
      available: true,
      note: "Built in. No API key required.",
    },
    {
      id: "gsc",
      label: "Search Console (your own backlinks)",
      available: config.google.configured,
      note: config.google.configured
        ? "OAuth client configured."
        : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    },
    {
      id: "ranks",
      label: "Free authority scores",
      available: Boolean(config.domainRanksUrl) || Boolean(config.openPageRankKey),
      note: "Run `npm run ranks:import` for Common Crawl ranks, or set OPENPAGERANK_API_KEY.",
    },
    {
      id: "serp",
      label: "Unlinked mention discovery",
      available: config.serp.provider === "brave" && Boolean(config.serp.braveKey),
      note:
        config.serp.provider === "brave"
          ? "Brave Search API configured."
          : "Set SERP_PROVIDER=brave + BRAVE_SEARCH_API_KEY, or use manual SERP import.",
    },
  ];
}
