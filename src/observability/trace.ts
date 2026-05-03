import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type TraceEvent =
  | { type: "turn_start"; userId: string; kind: "inbound" | "outbound"; message?: string }
  | { type: "turn_end"; userId: string; durationMs: number; finalText?: string; sessionId?: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; ok: boolean; result?: unknown }
  | { type: "hook_decision"; hook: string; decision: "allow" | "deny"; reason?: string }
  | { type: "subagent_invoke"; name: string }
  | { type: "error"; message: string; stack?: string }
  | {
      type: "session_recovered";
      stale_session_id: string;
      reason: string;
    };

export class Trace {
  readonly path: string;
  private readonly startedAt: number;

  constructor(public readonly userId: string) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.resolve(env.BOTHERME_TRACES_DIR, userId);
    mkdirSync(dir, { recursive: true });
    this.path = path.join(dir, `${ts}.jsonl`);
    this.startedAt = Date.now();
  }

  write(event: TraceEvent): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    try {
      appendFileSync(this.path, line, "utf8");
    } catch {
      // intentional swallow — trace failures must not break a turn
    }
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}
