-- LinkForge schema. Applied by scripts/migrate.ts, which runs each numbered
-- block exactly once and records it in _migrations.

-- migration:001 core
CREATE TABLE IF NOT EXISTS domains (
  domain            TEXT PRIMARY KEY,          -- registrable domain, lowercase
  first_seen        TEXT NOT NULL DEFAULT (datetime('now')),
  last_crawled      TEXT,
  http_status       INTEGER,
  title             TEXT,
  language          TEXT,
  country           TEXT,
  ip_hash           TEXT,                      -- for C-class / same-network clustering
  authority         REAL,                      -- 0-100 normalised authority
  authority_source  TEXT,                      -- 'commoncrawl' | 'openpagerank' | 'manual'
  spam_score        REAL,                      -- 0-100, higher = more toxic
  spam_signals      TEXT,                      -- JSON array of signal ids that fired
  relevance         REAL,                      -- 0-100 topical fit with target site
  outbound_link_count INTEGER,
  is_indexable      INTEGER,                   -- 0/1, from robots/meta
  notes             TEXT
);

CREATE TABLE IF NOT EXISTS backlinks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url      TEXT NOT NULL,
  source_domain   TEXT NOT NULL,
  target_url      TEXT NOT NULL,
  target_domain   TEXT NOT NULL,
  anchor_text     TEXT,
  rel             TEXT,                        -- raw rel attribute
  is_nofollow     INTEGER NOT NULL DEFAULT 0,
  is_sponsored    INTEGER NOT NULL DEFAULT 0,
  is_ugc          INTEGER NOT NULL DEFAULT 0,
  link_position   TEXT,                        -- 'content' | 'nav' | 'footer' | 'sidebar' | 'comment'
  surrounding_text TEXT,
  http_status     INTEGER,                     -- status of source_url at last check
  discovered_via  TEXT NOT NULL,               -- 'gsc' | 'commoncrawl' | 'crawl' | 'manual' | 'import'
  first_seen      TEXT NOT NULL DEFAULT (datetime('now')),
  last_verified   TEXT,
  status          TEXT NOT NULL DEFAULT 'unverified', -- 'live' | 'lost' | 'unverified' | 'unreachable'
  UNIQUE (source_url, target_url)
);

CREATE INDEX IF NOT EXISTS idx_backlinks_source_domain ON backlinks (source_domain);
CREATE INDEX IF NOT EXISTS idx_backlinks_target_domain ON backlinks (target_domain);
CREATE INDEX IF NOT EXISTS idx_backlinks_status ON backlinks (status);

-- Point-in-time counts so "lost links" and authority trends are real history
-- rather than a guess reconstructed from current rows.
CREATE TABLE IF NOT EXISTS link_snapshots (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at           TEXT NOT NULL DEFAULT (datetime('now')),
  target_domain      TEXT NOT NULL,
  total_backlinks    INTEGER NOT NULL,
  referring_domains  INTEGER NOT NULL,
  live_backlinks     INTEGER NOT NULL,
  lost_backlinks     INTEGER NOT NULL,
  nofollow_ratio     REAL,
  median_authority   REAL,
  toxic_domains      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_snapshots_domain_time
  ON link_snapshots (target_domain, taken_at);

-- migration:002 prospecting
CREATE TABLE IF NOT EXISTS prospects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  url            TEXT NOT NULL UNIQUE,
  domain         TEXT NOT NULL,
  kind           TEXT NOT NULL,   -- 'competitor_gap'|'unlinked_mention'|'resource_page'|'guest_post'|'broken_link'|'manual'
  title          TEXT,
  evidence       TEXT,            -- why we think this is an opportunity (JSON)
  authority      REAL,
  relevance      REAL,
  spam_score     REAL,
  difficulty     REAL,            -- 0-100 estimated effort to win the link
  priority       REAL,            -- composite ranking score
  status         TEXT NOT NULL DEFAULT 'new', -- new|qualified|rejected|queued|contacted|won|lost
  discovered_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at    TEXT,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects (status);
CREATE INDEX IF NOT EXISTS idx_prospects_priority ON prospects (priority DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_kind ON prospects (kind);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT NOT NULL,
  email       TEXT,
  name        TEXT,
  role        TEXT,
  source_url  TEXT,
  confidence  REAL NOT NULL DEFAULT 0,  -- 0-1
  found_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (domain, email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_domain ON contacts (domain);

CREATE TABLE IF NOT EXISTS outreach (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id  INTEGER NOT NULL REFERENCES prospects (id) ON DELETE CASCADE,
  contact_id   INTEGER REFERENCES contacts (id) ON DELETE SET NULL,
  stage        TEXT NOT NULL DEFAULT 'draft', -- draft|sent|followup_1|followup_2|replied|won|lost|bounced
  subject      TEXT,
  body         TEXT,
  sent_at      TEXT,
  replied_at   TEXT,
  won_at       TEXT,
  won_url      TEXT,
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_prospect ON outreach (prospect_id);
CREATE INDEX IF NOT EXISTS idx_outreach_stage ON outreach (stage);

-- migration:003 infrastructure
-- Conditional-request cache. We store validators, not bodies: re-fetching with
-- If-None-Match is cheap and keeps the DB small.
CREATE TABLE IF NOT EXISTS fetch_cache (
  url            TEXT PRIMARY KEY,
  fetched_at     TEXT NOT NULL,
  http_status    INTEGER,
  etag           TEXT,
  last_modified  TEXT,
  content_hash   TEXT,
  error          TEXT
);

CREATE TABLE IF NOT EXISTS robots_cache (
  origin      TEXT PRIMARY KEY,   -- scheme://host
  fetched_at  TEXT NOT NULL,
  body        TEXT,
  http_status INTEGER
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'queued', -- queued|running|done|failed|cancelled
  progress    REAL NOT NULL DEFAULT 0,
  total       INTEGER,
  processed   INTEGER NOT NULL DEFAULT 0,
  message     TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  started_at  TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Host-level authority imported from the Common Crawl webgraph ranks file.
-- Separate table because it can hold tens of millions of rows.
CREATE TABLE IF NOT EXISTS domain_ranks (
  domain         TEXT PRIMARY KEY,
  harmonic_pos   INTEGER,
  harmonic_val   REAL,
  pagerank_pos   INTEGER,
  pagerank_val   REAL,
  normalised     REAL   -- 0-100 authority derived from harmonic centrality
);

-- migration:004 disavow history
CREATE TABLE IF NOT EXISTS disavow_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT NOT NULL,   -- 'domain' | 'url'
  value       TEXT NOT NULL,
  reason      TEXT,
  spam_score  REAL,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  exported_at TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (scope, value)
);
