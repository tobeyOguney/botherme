import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { Trace } from "../observability/trace.js";
import { ensureUserTree } from "../persistence/memory.js";
import { getSessionId, saveSessionId } from "../persistence/operational.js";
import { loadSystemPrompt } from "./system-prompt.js";
import { noUnverifiedSpecificsHook } from "./hooks/no-unverified-specifics.js";
import { recallWriterAgent } from "./subagents/recall-writer.js";
import { buildSendMessageMcpServer } from "./tools/send-telegram-message.js";

const ALLOWED_FS_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];
const SEND_TOOL = "mcp__botherme-channel__send_telegram_message";

type TurnKind = "inbound" | "outbound";

async function runTurn(
  userId: string,
  promptText: string,
  kind: TurnKind,
): Promise<string> {
  const cwd = path.resolve(env.BOTHERME_USERS_DIR, userId);
  ensureUserTree(userId);

  const trace = new Trace(userId);
  trace.write({
    type: "turn_start",
    userId,
    kind,
    ...(kind === "inbound" ? { message: promptText } : {}),
  });

  const filesReadThisTurn = new Set<string>();
  const hookCtx = { trace, filesReadThisTurn };

  const mcpServer = buildSendMessageMcpServer(userId, trace);
  const resumeSession = getSessionId(userId);

  let finalText = "";
  let sessionId: string | undefined;

  try {
    const q = query({
      prompt: promptText,
      options: {
        cwd,
        model: env.BOTHERME_MODEL_MAIN,
        systemPrompt: loadSystemPrompt(),
        // Restrict built-ins to filesystem tools; outbound goes through the MCP tool.
        tools: ALLOWED_FS_TOOLS,
        allowedTools: [...ALLOWED_FS_TOOLS, SEND_TOOL],
        mcpServers: { "botherme-channel": mcpServer },
        agents: { "recall-writer": recallWriterAgent() },
        hooks: {
          PreToolUse: [{ hooks: [noUnverifiedSpecificsHook(hookCtx)] }],
        },
        // SDK isolation: don't load ~/.claude or .claude/ settings.
        settingSources: [],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        ...(resumeSession ? { resume: resumeSession } : {}),
        maxTurns: 12,
        stderr: (data) => logger.debug({ stderr: data }, "sdk stderr"),
      },
    });

    for await (const message of q) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }
      if (message.type === "assistant" && message.parent_tool_use_id === null) {
        const blocks = message.message.content;
        for (const block of blocks) {
          if (block.type === "text") finalText += block.text;
        }
      }
      if (message.type === "result") {
        if (message.subtype === "success") {
          // Prefer the final assembled `result` field — it dedupes streamed text.
          finalText = message.result;
        } else {
          logger.warn(
            { subtype: message.subtype, userId },
            "turn ended with non-success result",
          );
        }
      }
    }

    if (sessionId) saveSessionId(userId, sessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    trace.write({ type: "error", message: msg, ...(stack ? { stack } : {}) });
    logger.error({ err, userId, kind }, "turn failed");
    throw err;
  } finally {
    trace.write({
      type: "turn_end",
      userId,
      durationMs: trace.elapsedMs,
      ...(finalText ? { finalText } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
  }

  return finalText;
}

export async function runInboundTurn(
  userId: string,
  message: string,
): Promise<string> {
  return runTurn(userId, message, "inbound");
}

export async function runOutboundTurn(userId: string): Promise<string> {
  const prompt =
    "Outbound check-in. Read index.md first. Decide if there's anything specific worth saying right now — choosing to stay quiet is fine and often correct. If you decide to speak, deliver via send_telegram_message; if not, just say <silent/> and stop.";
  return runTurn(userId, prompt, "outbound");
}
