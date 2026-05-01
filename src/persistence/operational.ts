import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";

const DB_FILENAME = "botherme.sqlite";

mkdirSync(env.BOTHERME_DATA_DIR, { recursive: true });
const dbPath = path.join(env.BOTHERME_DATA_DIR, DB_FILENAME);

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
     id              TEXT PRIMARY KEY,
     created_at      TEXT NOT NULL,
     active          INTEGER NOT NULL DEFAULT 1,
     display_name    TEXT,
     timezone        TEXT NOT NULL DEFAULT 'UTC'
   )`,
  `CREATE TABLE IF NOT EXISTS scheduler_state (
     user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     next_check           INTEGER NOT NULL,
     last_outbound        INTEGER,
     last_inbound         INTEGER,
     consecutive_outbound INTEGER NOT NULL DEFAULT 0,
     paused_until         INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduler_next_check
     ON scheduler_state(next_check)`,
  `CREATE TABLE IF NOT EXISTS refusal_log (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id     TEXT NOT NULL,
     ts          INTEGER NOT NULL,
     phrase      TEXT NOT NULL,
     outcome     TEXT NOT NULL CHECK (outcome IN ('revised','silent','hard_failure')),
     trace_path  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     session_id  TEXT NOT NULL,
     updated_at  INTEGER NOT NULL
   )`,
];

for (const stmt of SCHEMA_STATEMENTS) {
  db.prepare(stmt).run();
}
logger.info({ dbPath }, "operational store ready");

const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (id, created_at, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET display_name = COALESCE(excluded.display_name, display_name)
  `),
  getUser: db.prepare(`SELECT * FROM users WHERE id = ?`),
  initSchedulerState: db.prepare(`
    INSERT OR IGNORE INTO scheduler_state (user_id, next_check)
    VALUES (?, ?)
  `),
  setLastInbound: db.prepare(`
    UPDATE scheduler_state SET last_inbound = ? WHERE user_id = ?
  `),
  setLastOutbound: db.prepare(`
    UPDATE scheduler_state
    SET last_outbound = ?, consecutive_outbound = consecutive_outbound + 1
    WHERE user_id = ?
  `),
  resetConsecutiveOutbound: db.prepare(`
    UPDATE scheduler_state SET consecutive_outbound = 0 WHERE user_id = ?
  `),
  saveSession: db.prepare(`
    INSERT INTO sessions (user_id, session_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      session_id = excluded.session_id,
      updated_at = excluded.updated_at
  `),
  getSession: db.prepare(`SELECT session_id FROM sessions WHERE user_id = ?`),
  logRefusal: db.prepare(`
    INSERT INTO refusal_log (user_id, ts, phrase, outcome, trace_path)
    VALUES (?, ?, ?, ?, ?)
  `),
};

export function ensureUser(
  userId: string,
  displayName: string | null = null,
): void {
  const nowIso = new Date().toISOString();
  const nowSec = Math.floor(Date.now() / 1000);
  stmts.upsertUser.run(userId, nowIso, displayName);
  // First-time users get a far-future next_check so the scheduler doesn't
  // fire before they've registered an asset.
  stmts.initSchedulerState.run(userId, nowSec + 7 * 24 * 3600);
}

export function recordInbound(userId: string): void {
  stmts.setLastInbound.run(Math.floor(Date.now() / 1000), userId);
  stmts.resetConsecutiveOutbound.run(userId);
}

export function recordOutbound(userId: string): void {
  stmts.setLastOutbound.run(Math.floor(Date.now() / 1000), userId);
}

export function saveSessionId(userId: string, sessionId: string): void {
  stmts.saveSession.run(userId, sessionId, Math.floor(Date.now() / 1000));
}

export function getSessionId(userId: string): string | null {
  const row = stmts.getSession.get(userId) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}

export function logRefusal(
  userId: string,
  phrase: string,
  outcome: "revised" | "silent" | "hard_failure",
  tracePath: string,
): void {
  stmts.logRefusal.run(
    userId,
    Math.floor(Date.now() / 1000),
    phrase,
    outcome,
    tracePath,
  );
}
