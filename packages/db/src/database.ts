import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS records (
     collection TEXT NOT NULL,
     id         TEXT NOT NULL,
     lead_id    TEXT,
     status     TEXT,
     skey       TEXT,
     json       TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (collection, id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_records_lead   ON records (collection, lead_id)`,
  `CREATE INDEX IF NOT EXISTS idx_records_status ON records (collection, status)`,
  `CREATE INDEX IF NOT EXISTS idx_records_skey   ON records (collection, skey)`,
  `CREATE INDEX IF NOT EXISTS idx_records_created ON records (collection, created_at)`,
  `CREATE TABLE IF NOT EXISTS record_keys (
     collection TEXT NOT NULL,
     key        TEXT NOT NULL,
     id         TEXT NOT NULL,
     PRIMARY KEY (collection, key, id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_record_keys ON record_keys (collection, key)`,
  `CREATE TABLE IF NOT EXISTS jobs (
     id           TEXT PRIMARY KEY,
     type         TEXT NOT NULL,
     payload      TEXT NOT NULL,
     status       TEXT NOT NULL,
     trace_id     TEXT NOT NULL,
     lead_id      TEXT,
     run_at       TEXT NOT NULL,
     attempts     INTEGER NOT NULL DEFAULT 0,
     max_attempts INTEGER NOT NULL DEFAULT 3,
     last_error   TEXT,
     created_at   TEXT NOT NULL,
     updated_at   TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (status, run_at)`,
];

export function openDatabase(dataDir: string, fileName = "william.db"): Db {
  const path = join(dataDir, fileName);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  for (const sql of MIGRATIONS) db.exec(sql);
  return db;
}

/** In-memory database for tests and ephemeral demo runs. */
export function openMemoryDatabase(): Db {
  const db = new DatabaseSync(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  return db;
}
