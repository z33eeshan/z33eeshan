import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "@/lib/config";

let instance: Database.Database | null = null;

/**
 * Process-wide SQLite handle. WAL mode lets the dashboard read while the
 * crawl worker writes, which is the whole point of using SQLite here rather
 * than juggling a Postgres container for a single-site tool.
 */
export function db(): Database.Database {
  if (instance) return instance;

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const conn = new Database(config.databasePath);

  conn.pragma("journal_mode = WAL");
  conn.pragma("synchronous = NORMAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 10000");

  instance = conn;
  return conn;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** Split schema.sql on `-- migration:<id>` markers so each block runs once. */
export function parseMigrations(sql: string): { id: string; body: string }[] {
  const parts = sql.split(/^--\s*migration:(\S+).*$/gm);
  const out: { id: string; body: string }[] = [];
  // parts[0] is the preamble before the first marker; captures then alternate
  // id, body, id, body...
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i]?.trim();
    const body = parts[i + 1] ?? "";
    if (id && body.trim()) out.push({ id, body });
  }
  return out;
}

export function migrate(conn: Database.Database = db()): string[] {
  const schemaPath = path.join(process.cwd(), "src/lib/db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  conn.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    conn
      .prepare<[], { id: string }>("SELECT id FROM _migrations")
      .all()
      .map((r) => r.id),
  );

  const ran: string[] = [];
  for (const { id, body } of parseMigrations(sql)) {
    if (applied.has(id)) continue;
    conn.transaction(() => {
      conn.exec(body);
      conn.prepare("INSERT INTO _migrations (id) VALUES (?)").run(id);
    })();
    ran.push(id);
  }
  return ran;
}

/** Ensures the schema exists before the first query on a cold start. */
let migrated = false;
export function ready(): Database.Database {
  const conn = db();
  if (!migrated) {
    migrate(conn);
    migrated = true;
  }
  return conn;
}

export function getSetting(key: string): string | null {
  const row = ready()
    .prepare<[string], { value: string }>("SELECT value FROM settings WHERE key = ?")
    .get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  ready()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value);
}
