import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { sendTelegramMessage } from "../../channel/telegram.js";
import { logger } from "../../observability/logger.js";
import type { Trace } from "../../observability/trace.js";
import { recordOutbound } from "../../persistence/operational.js";

export type SendToolOptions = {
  /** When true, log the would-be message instead of calling Telegram. */
  dryRun?: boolean;
};

/**
 * Single chokepoint for outbound text. The PreToolUse hook
 * (`no-unverified-specifics`) gates this tool — it's the only path
 * for the agent to reach the user, so guarding here covers all cases.
 *
 * Closure-captured `chatId` ensures the agent cannot address other users.
 */
export function buildSendMessageTool(
  chatId: string,
  trace: Trace,
  opts: SendToolOptions = {},
) {
  return tool(
    "send_telegram_message",
    "Deliver a message to the user via Telegram. The single way to reach the user; you cannot speak to them by any other channel. Inputs go through a hallucination-defence hook that may refuse messages containing unverified specifics.",
    { text: z.string().min(1).max(3500) },
    async ({ text }) => {
      trace.write({
        type: "tool_call",
        tool: "send_telegram_message",
        input: { text, ...(opts.dryRun ? { dryRun: true } : {}) },
      });

      if (opts.dryRun) {
        logger.info({ chatId, text }, "[dry-run] would send");
        trace.write({
          type: "tool_result",
          tool: "send_telegram_message",
          ok: true,
          result: "dry-run",
        });
        return { content: [{ type: "text", text: "delivered (dry run)" }] };
      }

      try {
        await sendTelegramMessage(chatId, text);
        recordOutbound(chatId);
        trace.write({
          type: "tool_result",
          tool: "send_telegram_message",
          ok: true,
        });
        return { content: [{ type: "text", text: "delivered" }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        trace.write({
          type: "tool_result",
          tool: "send_telegram_message",
          ok: false,
          result: msg,
        });
        return {
          content: [{ type: "text", text: `send failed: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
