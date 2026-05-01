import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { sendTelegramMessage } from "../../channel/telegram.js";
import type { Trace } from "../../observability/trace.js";
import { recordOutbound } from "../../persistence/operational.js";

/**
 * Single chokepoint for outbound text. The PreToolUse hook
 * (`no-unverified-specifics`) gates this tool — it's the only path
 * for the agent to reach the user, so guarding here covers all cases.
 *
 * Closure-captured `chatId` ensures the agent cannot address other users.
 */
export function buildSendMessageTool(chatId: string, trace: Trace) {
  return tool(
    "send_telegram_message",
    "Deliver a message to the user via Telegram. The single way to reach the user; you cannot speak to them by any other channel. Inputs go through a hallucination-defence hook that may refuse messages containing unverified specifics.",
    { text: z.string().min(1).max(3500) },
    async ({ text }) => {
      trace.write({
        type: "tool_call",
        tool: "send_telegram_message",
        input: { text },
      });
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
