import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Trace } from "../../observability/trace.js";
import { buildSendMessageTool } from "./send-telegram-message.js";
import { buildRegisterAssetTool } from "./register-asset.js";
import { buildKillAssetTool } from "./kill-asset.js";

export const MCP_SERVER_NAME = "botherme";

/**
 * Builds a per-turn MCP server with all custom tools, scoped to a single
 * user via closure-captured chatId. The server is short-lived: one per
 * `runTurn()` invocation.
 */
export function buildAgentMcpServer(chatId: string, trace: Trace) {
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: "0.0.1",
    tools: [
      buildSendMessageTool(chatId, trace),
      buildRegisterAssetTool(chatId, trace),
      buildKillAssetTool(chatId, trace),
    ],
  });
}

export const FQ_TOOLS = {
  sendTelegramMessage: `mcp__${MCP_SERVER_NAME}__send_telegram_message`,
  registerAsset: `mcp__${MCP_SERVER_NAME}__register_asset`,
  killAsset: `mcp__${MCP_SERVER_NAME}__kill_asset`,
} as const;
