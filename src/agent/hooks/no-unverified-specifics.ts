/**
 * Day-5 work tightens this. v0 stub returns `allow` for every send so the
 * inbound/outbound path can be exercised end-to-end. The hook signature and
 * wiring point are committed now; the regex/grounding implementation lands
 * with the dedicated test suite in `tests/no-unverified-specifics.test.ts`.
 */
import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { Trace } from "../../observability/trace.js";

export type NoUnverifiedSpecificsContext = {
  trace: Trace;
  filesReadThisTurn: Set<string>;
};

export function noUnverifiedSpecificsHook(
  ctx: NoUnverifiedSpecificsContext,
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }
    const pre = input as PreToolUseHookInput;

    // Track files the agent reads so the Day-5 grounding check has a corpus.
    if (pre.tool_name === "Read") {
      const ti = pre.tool_input as { file_path?: string } | undefined;
      if (ti?.file_path) ctx.filesReadThisTurn.add(ti.file_path);
    }

    if (pre.tool_name !== "send_telegram_message") {
      return { continue: true };
    }

    // TODO(day-5): inspect message text, run specifics detector, ground each
    // claim against `ctx.filesReadThisTurn`, refuse with reason on failure.
    ctx.trace.write({
      hook: "no-unverified-specifics",
      type: "hook_decision",
      decision: "allow",
      reason: "stub — Day 5 implementation pending",
    });

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    };
  };
}
