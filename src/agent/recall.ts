import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import type { Trace } from "../observability/trace.js";
import { loadSubagentPrompt } from "./system-prompt.js";

const RECALL_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];
const RECALL_MAX_TURNS = 20;
const RECALL_TIMEOUT_MS = 60_000;

/**
 * End-of-turn memory writer. Runs as a separate SDK invocation (not as a
 * delegated subagent) so the recall pass cannot be skipped by the parent
 * agent's judgment — memory updates are infrastructure, not a decision.
 *
 * Failure here must not propagate: the user already got their reply.
 * We log and move on; the next turn's reads will pick up from whatever
 * partial state exists.
 */
export async function runRecallWriter(
  userId: string,
  userMessage: string,
  assistantReply: string,
  trace: Trace,
): Promise<void> {
  const cwd = path.resolve(env.BOTHERME_USERS_DIR, userId);
  const today = new Date().toISOString().slice(0, 10);
  const transcript = [
    `Today: ${today}`,
    "",
    "Recent turn:",
    `USER: ${userMessage}`,
    `ASSISTANT: ${assistantReply || "<silent>"}`,
    "",
    `Update memory now per your guidelines. Append to journal/${today}.md and update any touched assets/<slug>.md files. Do not call send_telegram_message. Be efficient — most turns need at most one journal append plus zero or one asset edit.`,
  ].join("\n");

  trace.write({ type: "subagent_invoke", name: "recall-writer" });

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), RECALL_TIMEOUT_MS);

  try {
    const q = query({
      prompt: transcript,
      options: {
        cwd,
        model: env.BOTHERME_MODEL_RECALL,
        systemPrompt: loadSubagentPrompt("recall-writer"),
        tools: RECALL_TOOLS,
        allowedTools: RECALL_TOOLS,
        settingSources: [],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        maxTurns: RECALL_MAX_TURNS,
        abortController,
        stderr: (data) =>
          logger.debug({ stderr: data, scope: "recall-writer" }, "sdk stderr"),
      },
    });

    let summary = "";
    for await (const message of q) {
      if (message.type === "result" && message.subtype === "success") {
        summary = message.result;
      }
      if (message.type === "result" && message.subtype !== "success") {
        logger.warn(
          { userId, subtype: message.subtype },
          "recall-writer ended non-success",
        );
      }
    }
    trace.write({
      type: "tool_result",
      tool: "recall-writer",
      ok: true,
      result: summary.slice(0, 500),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    trace.write({ type: "error", message: `recall-writer failed: ${msg}` });
    logger.warn({ err, userId }, "recall-writer failed; continuing");
  } finally {
    clearTimeout(timer);
  }
}
