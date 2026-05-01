/**
 * Replay the most recent inbound turn for a given user against the current
 * system prompt, in dry-run mode. Used by the founder to iterate on
 * prompts/BOTHERME.md without burning a real conversation.
 *
 * Usage: pnpm replay <userId>
 *
 * Behaviour:
 *  - Reads the latest trace file for the user from `traces/<userId>/`.
 *  - Extracts the last inbound user message and the bot's actual reply.
 *  - Re-invokes runInboundTurn with dryRun: true (no Telegram send,
 *    no recall-writer mutation, no session persistence).
 *  - Prints the original reply alongside the replayed reply.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { env } from "../src/config/env.js";
import { runInboundTurn } from "../src/agent/run-turn.js";

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

const userId = process.argv[2];
if (!userId) die("usage: pnpm replay <userId>");

const tracesDir = path.resolve(env.BOTHERME_TRACES_DIR, userId);
if (!existsSync(tracesDir)) die(`no traces directory for user ${userId}`);

const traceFiles = readdirSync(tracesDir)
  .filter((f) => f.endsWith(".jsonl"))
  .sort()
  .reverse();

if (traceFiles.length === 0) die(`no trace files in ${tracesDir}`);

type TraceLine = {
  ts?: string;
  type: string;
  kind?: "inbound" | "outbound";
  message?: string;
  finalText?: string;
};

function readLatestInboundTurn(): {
  tracePath: string;
  userMessage: string;
  originalReply: string;
} | null {
  for (const file of traceFiles) {
    const tracePath = path.join(tracesDir, file);
    const lines = readFileSync(tracePath, "utf8").split("\n").filter(Boolean);
    let userMessage: string | null = null;
    let originalReply = "";
    let kind: "inbound" | "outbound" | null = null;
    for (const line of lines) {
      let parsed: TraceLine;
      try {
        parsed = JSON.parse(line) as TraceLine;
      } catch {
        continue;
      }
      if (parsed.type === "turn_start") {
        kind = parsed.kind ?? null;
        userMessage = parsed.message ?? null;
      }
      if (parsed.type === "turn_end" && parsed.finalText) {
        originalReply = parsed.finalText;
      }
    }
    if (kind === "inbound" && userMessage) {
      return { tracePath, userMessage, originalReply };
    }
  }
  return null;
}

const turn = readLatestInboundTurn();
if (!turn) die("no inbound turn found in trace history");

const banner = (title: string) =>
  `\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}\n`;

process.stdout.write(banner("Source"));
process.stdout.write(`trace: ${turn.tracePath}\nuserId: ${userId}\n`);

process.stdout.write(banner("USER"));
process.stdout.write(`${turn.userMessage}\n`);

process.stdout.write(banner("ORIGINAL ASSISTANT REPLY"));
process.stdout.write(`${turn.originalReply || "<no reply captured>"}\n`);

process.stdout.write(banner("REPLAY (dry-run, current prompt)"));

const replayed = await runInboundTurn(userId, turn.userMessage, {
  dryRun: true,
});

process.stdout.write(`${replayed || "<silent>"}\n`);
process.stdout.write(banner("end"));
process.exit(0);
