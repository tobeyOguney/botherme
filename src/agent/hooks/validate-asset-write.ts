import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  HookCallback,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { Trace } from "../../observability/trace.js";
import { validateAssetMarkdown } from "../../persistence/memory.js";

/**
 * Refuses any Write/Edit landing in `assets/*.md` (excluding `_killed/`)
 * whose result would have invalid frontmatter. The agent occasionally
 * uses raw Write to create "exploring" entries, and a slip in YAML
 * (e.g. last_engaged: null when the schema didn't allow it) used to mean
 * the file landed on disk but Zod silently dropped it on read — the file
 * was effectively invisible.
 *
 * This hook fails the write loudly so the agent gets immediate feedback
 * and can correct the frontmatter rather than producing an asset no
 * subsequent turn will see.
 */
export function validateAssetWriteHook(ctx: {
  trace: Trace;
}): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    const pre = input as PreToolUseHookInput;
    if (pre.tool_name !== "Write" && pre.tool_name !== "Edit") {
      return { continue: true };
    }

    const ti = pre.tool_input as
      | { file_path?: string; content?: string; new_string?: string }
      | undefined;
    const filePath = ti?.file_path;
    if (!filePath) return { continue: true };

    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(pre.cwd, filePath);
    const segments = abs.split(path.sep);
    const inAssetsDir =
      segments.includes("assets") &&
      !segments.includes("_killed") &&
      abs.endsWith(".md");
    if (!inAssetsDir) return { continue: true };

    // For Write, the new content is in `content`. For Edit, we synthesise
    // the post-edit body by applying new_string to the existing file (best
    // effort — if we can't reconstruct it, we let the SDK try and rely on
    // regenerateIndex's read-time validation as a backstop).
    let nextBody: string | null = null;
    if (pre.tool_name === "Write" && typeof ti.content === "string") {
      nextBody = ti.content;
    } else if (
      pre.tool_name === "Edit" &&
      typeof ti.new_string === "string" &&
      existsSync(abs)
    ) {
      try {
        const old = readFileSync(abs, "utf8");
        const olds = (pre.tool_input as { old_string?: string }).old_string;
        if (typeof olds === "string" && old.includes(olds)) {
          nextBody = old.replace(olds, ti.new_string);
        }
      } catch {
        // fall through; allow the write
      }
    }
    if (nextBody === null) return { continue: true };

    const issues = validateAssetMarkdown(nextBody);
    if (!issues) {
      ctx.trace.write({
        type: "hook_decision",
        hook: "validate-asset-write",
        decision: "allow",
      });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      };
    }

    const reason = `asset frontmatter would not validate: ${issues.join("; ")}. Use register_asset for active assets, and ensure exploring assets keep their slug/created/status fields well-formed.`;
    ctx.trace.write({
      type: "hook_decision",
      hook: "validate-asset-write",
      decision: "deny",
      reason,
    });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  };
}
