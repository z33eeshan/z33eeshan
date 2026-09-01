# LinkForge

An all-in-one backlink toolkit built for a single site: crawl and verify your
own backlinks, score referring domains for spam signals, generate a
justified disavow file, find new link opportunities, and run outreach — all
self-hosted, built on free data sources.

Built for [livenewsof.com](https://livenewsof.com), but not tied to it —
everything reads from `TARGET_SITE` in your environment.

## What this is, honestly

No tool — including the paid ones — can crawl the entire web from scratch.
Ahrefs, Semrush and Moz sell access to their own crawler indexes; that is
what you are actually paying for with a subscription. This tool uses three
free sources instead, and is honest in the UI about what each one can and
cannot tell you:

- **Google Search Console** — authoritative for *your own* site's backlinks
  and search queries. The "Top linking sites" report has no public API
  (nobody's tool can pull it programmatically), so it is imported as a CSV
  export — the same route every tool uses.
- **Common Crawl** — a free, web-scale crawl archive. Its host-level webgraph
  gives a real authority metric (harmonic centrality, the same family of
  signal commercial "Domain Rating" scores approximate), and its URL index
  helps discover prospect pages cheaply before spending your own crawl budget.
  It is a URL index, not a link graph — it cannot answer "who links to this
  competitor," only "what pages exist on this domain."
- **This tool's own crawler** — verifies links are actually live, extracts
  real anchor text/rel attributes/placement, and discovers editorial contact
  addresses from a site's own published contact pages.

The provider layer (`src/lib/providers/`) is an interface, not a hard
dependency — if you later buy DataForSEO or Ahrefs API credits, competitor
backlink data slots in without a rewrite.

**On paid links:** buying links violates Google's spam policies and is a
common cause of the exact link penalties this tool's audit module is built
to catch. The opportunity finder targets earned placements — unlinked
mentions, resource pages, journalist requests, broken-link replacement — not
paid placements.

## Modules

| Page | What it does |
|---|---|
| **Overview** | Link profile health, trend chart, guided pipeline (discover → resolve authority → verify → audit) |
| **Backlinks** | Every known backlink: anchor text, rel attributes, placement, live/lost status |
| **Audit** | Spam-score every referring domain with full signal explanations, build a disavow file |
| **Anchors** | Anchor-text distribution vs. healthy ranges — the clearest tell of manipulated link building |
| **Opportunities** | Competitor gap analysis, unlinked mentions, resource pages, broken-link replacement, contact discovery |
| **Outreach** | Template drafts per opportunity type, pipeline tracking (draft → sent → replied → won) |
| **Jobs** | Background crawl/scoring job queue and history |
| **Settings** | Connect Search Console, import CSVs, build the relevance model, configure competitors/brand terms |

## Setup

```bash
cd linkforge
npm install
cp .env.example .env.local   # fill in what you have — every feature degrades gracefully
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The Overview page tells you what to do first.

### 1. Import your backlinks (5 minutes, no API key)

Search Console → **Links** → "Top linking sites" → **Export** → download the
CSV. Upload it in **Settings → Import backlinks**. This works even before
anything else below is configured.

### 2. Connect Search Console (optional but recommended, free)

Unlocks: authoritative link data going forward, and the relevance model that
ranks prospects by topical fit rather than authority alone.

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
   create an OAuth 2.0 **Web application** client.
2. Add authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
   (matches `GOOGLE_REDIRECT_URI` in `.env.local`).
3. Enable the **Search Console API** for the project.
4. Put the client ID/secret in `.env.local`, restart the dev server.
5. **Settings → Connect Search Console.**

### 3. Free authority scores (optional, ~10 min one-time)

```bash
npm run ranks:import -- <url-from-commoncrawl.org/web-graphs>
```

Get the current file URL from
[commoncrawl.org/web-graphs](https://commoncrawl.org/web-graphs) (look for
the domain-level "ranks" file for the latest graph). Expect a few hundred MB
gzipped and 5–20 minutes; the result is a local, unlimited authority lookup.
If that's more disk than you want, get a free
[OpenPageRank](https://www.domcop.com/openpagerank/) API key instead (1000
lookups/day, no card) — set `OPENPAGERANK_API_KEY`.

### 4. Set your project details

**Settings** → brand terms, competitors, commercial keywords, disavow
allowlist. These drive anchor classification, competitor-gap analysis, and
unlinked-mention search.

### 5. Run the pipeline

From the Overview page, in order: **Discover linking pages** → **Resolve
authority** → **Verify links** → **Run audit**. Each step writes to SQLite;
later steps read what earlier ones found.

## Running crawls in the background

Crawls take minutes. The dashboard kicks off an in-process runner for
convenience in dev, but for anything real, run the worker alongside it:

```bash
npm run worker
```

## The one destructive action: disavow files

Everything else in this tool is additive or reversible. A disavow file is
not — it tells Google to ignore links, and undoing it means re-uploading and
waiting for a recrawl. Google's own guidance is that most sites never need
one; their spam systems already discount obvious junk. Use it only if you
have a manual action for unnatural links, or you know links were bought or
built manipulatively. The Audit page requires an explicit preview before any
download, and every line in the file is annotated with the exact signals
that triggered it — never submit one you can't justify domain by domain.

## Outreach: drafts, not sends

This tool drafts and tracks outreach; it does not send email. That's
deliberate: bulk sending from an app like this, without domain warmup,
SPF/DKIM alignment, and bounce handling, is how a sending domain ends up
blocklisted. Copy the draft into the mailbox the recipient expects to hear
from, send it there, and log replies back in.

## Development

```bash
npm test          # unit tests (node:test + tsx), no network required
npm run typecheck
npm run build
npx tsx scripts/smoke.ts   # end-to-end check against live HTTP + Common Crawl
```

`scripts/smoke.ts` needs unrestricted outbound internet — it will correctly
report failures if run somewhere with an egress allowlist (a locked-down CI
box, for instance). The import/scoring/disavow sections need no network and
should always pass.

## Project layout

```
src/lib/engine/      crawler, robots.txt, link parsing, spam scoring, disavow,
                      anchor analysis, relevance scoring, prospecting, outreach
src/lib/providers/    Google Search Console, Common Crawl, authority scores,
                      SERP, CSV import — the pluggable data-source layer
src/lib/db/           SQLite schema + migrations
src/lib/jobs.ts        background job queue
src/app/               Next.js pages + API routes
scripts/               DB migration, domain-ranks import, background worker, smoke test
```

## Environment variables

See `.env.example` for the full list with explanations. Nothing is required
to start — `TARGET_SITE` defaults to `livenewsof.com`, and every integration
reports its own status on the Settings page.
