import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { writeAssetFile, CadenceHint } from "../../persistence/memory.js";
import { SLUG_PATTERN } from "../../util/slugify.js";
import type { Trace } from "../../observability/trace.js";

/**
 * Conversational asset registration. The agent extracts the three things
 * (name, what-engagement-looks-like, cadence) from the conversation, then
 * calls this tool. Slug is the lowercase-hyphenated form of the name.
 *
 * The tool is deterministic: given the same args, it always produces the
 * same file. Slug collisions (active or previously-killed) are reported
 * back so the agent can ask the user how to disambiguate.
 */
export function buildRegisterAssetTool(chatId: string, trace: Trace) {
  return tool(
    "register_asset",
    "Persist a new asset (obligation the user has chosen to engage with). Use this once you have all three: a name, a concrete description of what engagement looks like, and a rough cadence. Do not call this with vague commitments — push back conversationally first.",
    {
      name: z
        .string()
        .min(1)
        .max(100)
        .describe("Human-readable asset name, e.g. 'Grokking Deep Learning' or 'Mom'"),
      slug: z
        .string()
        .regex(SLUG_PATTERN, "lowercase letters/digits, hyphen-separated")
        .max(60)
        .describe("Filesystem slug, e.g. 'grokking-deep-learning' or 'mom'"),
      what_engagement_looks_like: z
        .string()
        .min(5)
        .max(500)
        .describe("Concrete: '30 min reading + a sentence about what stuck', not 'study more'"),
      cadence: z
        .string()
        .min(1)
        .max(60)
        .describe("User-facing cadence phrase, e.g. 'weekly-ish' or 'every 2-3 days'"),
      cadence_hint: CadenceHint.exclude(["dormant"]).describe(
        "Scheduler bucket: 'frequent' (~daily), 'regular' (~every 2-4 days), 'occasional' (~weekly+)",
      ),
    },
    async (args) => {
      trace.write({
        type: "tool_call",
        tool: "register_asset",
        input: args,
      });
      const result = writeAssetFile(chatId, {
        name: args.name,
        slug: args.slug,
        whatEngagementLooksLike: args.what_engagement_looks_like,
        cadence: args.cadence,
        cadenceHint: args.cadence_hint,
      });
      if (!result.ok) {
        trace.write({
          type: "tool_result",
          tool: "register_asset",
          ok: false,
          result: result.reason,
        });
        const msg =
          result.reason === "already_exists"
            ? `asset '${args.slug}' already exists (active or previously killed). pick a different slug or ask the user.`
            : `slug '${args.slug}' is invalid; must be lowercase alphanumeric with hyphens.`;
        return { content: [{ type: "text", text: msg }], isError: true };
      }
      trace.write({
        type: "tool_result",
        tool: "register_asset",
        ok: true,
        result: { path: result.path },
      });
      return {
        content: [
          {
            type: "text",
            text: `registered asset '${args.slug}'. file: assets/${args.slug}.md`,
          },
        ],
      };
    },
  );
}
