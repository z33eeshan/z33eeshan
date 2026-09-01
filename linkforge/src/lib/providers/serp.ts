import { config } from "@/lib/config";
import { normaliseUrl, registrableDomain } from "@/lib/engine/url";

/**
 * SERP provider behind one interface, so the unlinked-mention finder does not
 * care where results come from.
 *
 * - `brave`: Brave Search API. Has a real free tier, no card required for it.
 * - `none`:  manual import. You paste result URLs from a browser search into
 *            the UI. Unglamorous, but it costs nothing and needs no account,
 *            and for a handful of brand queries a week it is perfectly workable.
 *
 * Deliberately NOT included: scraping Google or Bing HTML. It violates their
 * terms, breaks constantly, and gets your server IP blocked — which would also
 * take out the legitimate crawler.
 */

export interface SerpResult {
  url: string;
  title: string;
  snippet: string;
  domain: string | null;
  rank: number;
}

export interface SerpProvider {
  readonly name: string;
  readonly available: boolean;
  search(query: string, opts?: { count?: number; country?: string }): Promise<SerpResult[]>;
}

class BraveProvider implements SerpProvider {
  readonly name = "brave";

  get available(): boolean {
    return Boolean(config.serp.braveKey);
  }

  async search(
    query: string,
    opts: { count?: number; country?: string } = {},
  ): Promise<SerpResult[]> {
    if (!this.available) throw new Error("BRAVE_SEARCH_API_KEY is not set.");

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(opts.count ?? 20, 20)),
      result_filter: "web",
    });
    if (opts.country) params.set("country", opts.country);

    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        accept: "application/json",
        "accept-encoding": "gzip",
        "x-subscription-token": config.serp.braveKey,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 429) throw new Error("Brave Search rate limit reached. Try again later.");
    if (!res.ok) throw new Error(`Brave Search failed: HTTP ${res.status}`);

    const json = (await res.json()) as {
      web?: { results?: { url?: string; title?: string; description?: string }[] };
    };

    return (json.web?.results ?? []).flatMap((r, i) => {
      const url = r.url ? normaliseUrl(r.url) : null;
      if (!url) return [];
      return [
        {
          url,
          title: r.title ?? "",
          snippet: stripTags(r.description ?? ""),
          domain: registrableDomain(url),
          rank: i + 1,
        },
      ];
    });
  }
}

class ManualProvider implements SerpProvider {
  readonly name = "manual";
  readonly available = false;

  async search(): Promise<SerpResult[]> {
    throw new Error(
      "No SERP provider configured. Either set SERP_PROVIDER=brave with a free " +
        "BRAVE_SEARCH_API_KEY, or paste result URLs via the manual import in the UI.",
    );
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function serpProvider(): SerpProvider {
  return config.serp.provider === "brave" ? new BraveProvider() : new ManualProvider();
}

/**
 * Turns a pasted list of URLs (one per line, or whitespace separated) into
 * SerpResults. This is the manual fallback path.
 */
export function parseManualSerp(input: string): SerpResult[] {
  const out: SerpResult[] = [];
  const seen = new Set<string>();
  for (const token of input.split(/[\s,]+/)) {
    if (!/^https?:\/\//i.test(token)) continue;
    const url = normaliseUrl(token);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: "",
      snippet: "",
      domain: registrableDomain(url),
      rank: out.length + 1,
    });
  }
  return out;
}

/**
 * Search operators that surface link opportunities. Kept here as data so the
 * UI can offer them as one-click queries whether or not an API key is set —
 * with no key you run them in a browser and paste the results back.
 */
export function opportunityQueries(topic: string, brand: string): {
  label: string;
  query: string;
  kind: string;
}[] {
  const t = topic.trim();
  const b = brand.trim();
  return [
    {
      label: "Unlinked brand mentions",
      query: `"${b}" -site:${config.targetSite}`,
      kind: "unlinked_mention",
    },
    {
      label: "Resource pages",
      query: `${t} intitle:"resources" OR intitle:"useful links" -site:${config.targetSite}`,
      kind: "resource_page",
    },
    {
      label: "Write-for-us pages",
      query: `${t} "write for us" OR "contribute" OR "guest post"`,
      kind: "guest_post",
    },
    {
      label: "News source lists",
      query: `${t} intitle:"news sources" OR "recommended news"`,
      kind: "resource_page",
    },
    {
      label: "Journalist requests",
      query: `${t} "looking for sources" OR "expert commentary" OR #journorequest`,
      kind: "manual",
    },
  ];
}
