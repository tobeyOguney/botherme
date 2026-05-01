import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { killAssetFile } from "../../persistence/memory.js";
import { SLUG_PATTERN } from "../../util/slugify.js";
import type { Trace } from "../../observability/trace.js";

/**
 * Graceful kill. Moves an active asset to assets/_killed/, updates its
 * frontmatter status, and records an optional reason. The killed file is
 * preserved (not deleted) so future tone callbacks can be authentic
 * ("you'd dropped duolingo a while back, right?").
 */
export function buildKillAssetTool(chatId: string, trace: Trace) {
  return tool(
    "kill_asset",
    "Gracefully retire an asset when the user clearly says they're done with it. Don't second-guess them — accept the kill cleanly. The file is moved to assets/_killed/ and preserved.",
    {
      slug: z
        .string()
        .regex(SLUG_PATTERN, "lowercase letters/digits, hyphen-separated")
        .max(60),
      reason: z
        .string()
        .max(200)
        .optional()
        .describe("Optional short note in the user's words; e.g. 'tried for 3 weeks, hated it'"),
    },
    async ({ slug, reason }) => {
      trace.write({
        type: "tool_call",
        tool: "kill_asset",
        input: { slug, ...(reason ? { reason } : {}) },
      });
      const result = killAssetFile(chatId, slug, reason);
      if (!result.ok) {
        trace.write({
          type: "tool_result",
          tool: "kill_asset",
          ok: false,
          result: result.reason,
        });
        const msg =
          result.reason === "not_found"
            ? `no active asset '${slug}' (might already be killed; check assets/_killed/)`
            : `slug '${slug}' is invalid`;
        return { content: [{ type: "text", text: msg }], isError: true };
      }
      trace.write({
        type: "tool_result",
        tool: "kill_asset",
        ok: true,
        result: { path: result.path },
      });
      return {
        content: [{ type: "text", text: `killed '${slug}', moved to assets/_killed/` }],
      };
    },
  );
}
