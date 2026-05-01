/**
 * Daily founder-facing summary. Aggregates per-user activity from trace
 * files + SQLite refusal_log into a single readable markdown document.
 *
 * The bot does not read this directory — it lives outside `users/`.
 *
 * Scheduled in-process via node-cron from `src/index.ts` at 04:00 local.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import cron from "node-cron";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { db } from "../persistence/operational.js";

type TraceEvent = {
  ts?: string;
  type: string;
  kind?: "inbound" | "outbound";
  message?: string;
  finalText?: string;
  durationMs?: number;
  hook?: string;
  decision?: "allow" | "deny";
  reason?: string;
};

type PerUserDay = {
  inboundTurns: number;
  outboundTurns: number;
  refusals: number;
  hardFailures: number;
  longestTurnMs: number;
  silentOutbounds: number;
};

function dayBoundaryIso(date: Date): { startSec: number; endSec: number } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startSec: Math.floor(start.getTime() / 1000),
    endSec: Math.floor(end.getTime() / 1000),
  };
}

function loadUserTraces(userId: string, dateIsoPrefix: string): TraceEvent[] {
  const dir = path.join(env.BOTHERME_TRACES_DIR, userId);
  if (!existsSync(dir)) return [];
  const events: TraceEvent[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".jsonl")) continue;
    if (!file.startsWith(dateIsoPrefix)) continue;
    const fullPath = path.join(dir, file);
    for (const line of readFileSync(fullPath, "utf8").split("\n")) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as TraceEvent);
      } catch {
        // skip corrupt lines
      }
    }
  }
  return events;
}

function aggregateUserDay(events: TraceEvent[]): PerUserDay {
  const acc: PerUserDay = {
    inboundTurns: 0,
    outboundTurns: 0,
    refusals: 0,
    hardFailures: 0,
    longestTurnMs: 0,
    silentOutbounds: 0,
  };

  let currentKind: "inbound" | "outbound" | null = null;
  let currentReplyText = "";
  for (const e of events) {
    if (e.type === "turn_start") {
      currentKind = e.kind ?? null;
      currentReplyText = "";
      if (currentKind === "inbound") acc.inboundTurns += 1;
      if (currentKind === "outbound") acc.outboundTurns += 1;
    }
    if (e.type === "turn_end") {
      if (typeof e.durationMs === "number") {
        acc.longestTurnMs = Math.max(acc.longestTurnMs, e.durationMs);
      }
      if (currentKind === "outbound" && !e.finalText?.trim()) {
        acc.silentOutbounds += 1;
      }
      currentReplyText = e.finalText ?? "";
    }
    if (e.type === "hook_decision" && e.decision === "deny") {
      acc.refusals += 1;
    }
  }
  void currentReplyText;
  return acc;
}

function listUsers(): string[] {
  if (!existsSync(env.BOTHERME_USERS_DIR)) return [];
  return readdirSync(env.BOTHERME_USERS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function countHardFailures(startSec: number, endSec: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM refusal_log
       WHERE ts >= ? AND ts < ? AND outcome = 'hard_failure'`,
    )
    .get(startSec, endSec) as { n: number };
  return row.n;
}

function countAssetChanges(userId: string, dateIsoPrefix: string): {
  registered: number;
  killed: number;
} {
  // Approximation: assets created today = files whose `created` frontmatter
  // starts with dateIsoPrefix; same for killed_at.
  const dir = path.join(env.BOTHERME_USERS_DIR, userId, "assets");
  if (!existsSync(dir)) return { registered: 0, killed: 0 };

  let registered = 0;
  let killed = 0;
  const scan = (subdir: string, isKilledDir: boolean): void => {
    const target = path.join(dir, subdir);
    if (!existsSync(target)) return;
    for (const file of readdirSync(target)) {
      if (!file.endsWith(".md")) continue;
      const raw = readFileSync(path.join(target, file), "utf8");
      const fm = raw.split("\n---")[0] ?? "";
      if (!isKilledDir && fm.includes(`created: ${dateIsoPrefix}`)) registered += 1;
      if (isKilledDir && fm.includes(`killed_at: ${dateIsoPrefix}`)) killed += 1;
    }
  };
  scan(".", false);
  scan("_killed", true);
  return { registered, killed };
}

export function generateDailySummary(date: Date): string {
  const isoDate = date.toISOString().slice(0, 10);
  const { startSec, endSec } = dayBoundaryIso(date);
  const users = listUsers();
  const lines: string[] = [];

  lines.push(`# BotherMe daily summary — ${isoDate}`);
  lines.push("");
  lines.push(`Active users: **${users.length}**`);

  let totalIn = 0;
  let totalOut = 0;
  let totalRefusals = 0;
  let totalSilent = 0;
  const perUser: { id: string; agg: PerUserDay; assets: { registered: number; killed: number } }[] = [];

  for (const userId of users) {
    const events = loadUserTraces(userId, isoDate);
    if (events.length === 0) continue;
    const agg = aggregateUserDay(events);
    const assets = countAssetChanges(userId, isoDate);
    perUser.push({ id: userId, agg, assets });
    totalIn += agg.inboundTurns;
    totalOut += agg.outboundTurns;
    totalRefusals += agg.refusals;
    totalSilent += agg.silentOutbounds;
  }

  const hardFailures = countHardFailures(startSec, endSec);

  lines.push(`Inbound turns: **${totalIn}** | Outbound turns: **${totalOut}** | Silent outbounds: **${totalSilent}**`);
  lines.push(`Hook refusals: **${totalRefusals}** (hard failures: **${hardFailures}**)`);
  lines.push("");

  if (perUser.length === 0) {
    lines.push("_No user activity today._");
  } else {
    lines.push("## Per-user");
    lines.push("");
    for (const u of perUser) {
      lines.push(`### ${u.id}`);
      lines.push(
        `- inbound: ${u.agg.inboundTurns}, outbound: ${u.agg.outboundTurns}, silent: ${u.agg.silentOutbounds}`,
      );
      lines.push(
        `- refusals: ${u.agg.refusals}, longest turn: ${(u.agg.longestTurnMs / 1000).toFixed(1)}s`,
      );
      lines.push(
        `- assets: +${u.assets.registered} registered, -${u.assets.killed} killed`,
      );
      lines.push("");
    }
  }

  // Hard failure detail
  if (hardFailures > 0) {
    lines.push("## Hard-failure refusals (read these)");
    const rows = db
      .prepare(
        `SELECT user_id, phrase, trace_path, ts FROM refusal_log
         WHERE ts >= ? AND ts < ? AND outcome = 'hard_failure'
         ORDER BY ts ASC`,
      )
      .all(startSec, endSec) as Array<{
      user_id: string;
      phrase: string;
      trace_path: string;
      ts: number;
    }>;
    for (const r of rows) {
      lines.push(`- \`${r.user_id}\`: "${r.phrase}" (trace: ${r.trace_path})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function writeDailySummary(date: Date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10);
  const dailyDir = path.join(env.BOTHERME_TRACES_DIR, "daily");
  mkdirSync(dailyDir, { recursive: true });
  const out = path.join(dailyDir, `${isoDate}.md`);
  const content = generateDailySummary(date);
  writeFileSync(out, content, "utf8");
  logger.info({ out }, "daily summary written");
  return out;
}

let task: ReturnType<typeof cron.schedule> | null = null;

/**
 * Schedule the daily summary at 04:00 local time. Idempotent —
 * subsequent calls replace any existing schedule.
 */
export function scheduleDailySummary(): void {
  if (task) task.stop();
  // 04:00 every day, local time of the host. Summarises the previous day.
  task = cron.schedule("0 4 * * *", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    try {
      writeDailySummary(yesterday);
    } catch (err) {
      logger.error({ err }, "daily summary failed");
    }
  });
  logger.info("daily summary cron scheduled (04:00 local)");
}

export function stopDailySummary(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

// Suppress unused-import warning when consumer doesn't import `Database`.
// (It's only here as a type-narrowing hint for `db` callers.)
void Database;
