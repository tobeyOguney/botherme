import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { Trace } from "../observability/trace.js";
import { ensureUserTree, regenerateIndex } from "../persistence/memory.js";
import { getSessionId, saveSessionId } from "../persistence/operational.js";
import { loadSystemPrompt } from "./system-prompt.js";
import { noUnverifiedSpecificsHook } from "./hooks/no-unverified-specifics.js";
import { runRecallWriter } from "./recall.js";
import {
  buildAgentMcpServer,
  FQ_TOOLS,
  MCP_SERVER_NAME,
} from "./tools/index.js";

const ALLOWED_FS_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];
const ALLOWED_CUSTOM_TOOLS = [
  FQ_TOOLS.sendTelegramMessage,
  FQ_TOOLS.registerAsset,
  FQ_TOOLS.killAsset,
];

type TurnKind = "inbound" | "outbound";

export type RunTurnOptions = {
  /** When true: stub the send tool, skip session persistence, skip recall-writer. */
  dryRun?: boolean;
};

async function runTurn(
  userId: string,
  promptText: string,
  kind: TurnKind,
  opts: RunTurnOptions = {},
): Promise<string> {
  const cwd = path.resolve(env.BOTHERME_USERS_DIR, userId);
  ensureUserTree(userId);
  // Refresh index.md from the filesystem so the agent reads accurate state
  // (active asset count, last-engaged dates, recent journal entries).
  regenerateIndex(userId);

  const trace = new Trace(userId);
  trace.write({
    type: "turn_start",
    userId,
    kind,
    ...(kind === "inbound" ? { message: promptText } : {}),
  });

  const hookCtx = {
    userId,
    trace,
    filesTouchedThisTurn: new Set<string>(),
    refusalCount: { value: 0 },
  };

  const mcpServer = buildAgentMcpServer(userId, trace, { dryRun: opts.dryRun ?? false });
  const resumeSession = opts.dryRun ? null : getSessionId(userId);

  let finalText = "";
  let sessionId: string | undefined;

  try {
    const q = query({
      prompt: promptText,
      options: {
        cwd,
        model: env.BOTHERME_MODEL_MAIN,
        systemPrompt: loadSystemPrompt(),
        // Restrict built-ins to filesystem tools; outbound goes through MCP tools.
        tools: ALLOWED_FS_TOOLS,
        allowedTools: [...ALLOWED_FS_TOOLS, ...ALLOWED_CUSTOM_TOOLS],
        mcpServers: { [MCP_SERVER_NAME]: mcpServer },
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

    if (sessionId && !opts.dryRun) saveSessionId(userId, sessionId);
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
  opts: RunTurnOptions = {},
): Promise<string> {
  const reply = await runTurn(userId, message, "inbound", opts);
  // Fire-and-forget the recall pass. The user's reply must not wait on
  // memory updates; recall-writer's own try/catch swallows errors. Skip
  // entirely on dry-run so replay never mutates memory state.
  if (!opts.dryRun) {
    void runRecallWriter(userId, message, reply, new Trace(userId)).catch(
      (err) => {
        logger.warn({ err, userId }, "recall-writer fire-and-forget failed");
      },
    );
  }
  return reply;
}

export async function runOutboundTurn(
  userId: string,
  opts: RunTurnOptions = {},
): Promise<string> {
  const prompt = [
    "Outbound check-in. Read index.md to see active assets and the last-engaged date for each.",
    "For each active asset, ask yourself: when was it last logged or discussed? If it's been longer than the asset's cadence suggests, this is exactly the moment to nudge — that's the whole job.",
    "Pick the most-overdue asset and send ONE specific question about it via send_telegram_message. Specific = grounded in the asset's recorded facts, cadence, or last engagement (e.g. 'still on chapter 3?' not 'how's the reading going?'). Read the asset file before composing if you need the detail.",
    "Stay silent (<silent/>) only when there's genuinely nothing to ask — e.g. the user messaged within the last hour, OR every asset was logged today, OR there are no active assets at all. Treat <silent/> as the rare path, not the default.",
  ].join("\n\n");
  return runTurn(userId, prompt, "outbound", opts);
}
