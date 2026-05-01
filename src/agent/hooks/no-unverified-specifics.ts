import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { logRefusal } from "../../persistence/operational.js";
import type { Trace } from "../../observability/trace.js";
import { FQ_TOOLS } from "../tools/index.js";
import { evaluateMessage } from "./specifics-detector.js";

export type HookContext = {
  userId: string;
  trace: Trace;
  // Absolute paths of files the agent has read/written this turn.
  // The hook re-reads them at send-time to build the corpus.
  filesTouchedThisTurn: Set<string>;
  // Refusal counter per turn — we don't loop forever.
  refusalCount: { value: number };
};

const MAX_REFUSALS_PER_TURN = 3;

function resolveAbs(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

function buildCorpus(paths: Set<string>): string {
  const chunks: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      chunks.push(readFileSync(p, "utf8"));
    } catch {
      // best-effort; a corrupt file shouldn't crash the hook
    }
  }
  return chunks.join("\n\n");
}

export function noUnverifiedSpecificsHook(ctx: HookContext): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    const pre = input as PreToolUseHookInput;
    const cwd = pre.cwd;

    // Track every file the agent touches this turn — Read, Write, Edit
    // all contribute to the grounding corpus. Writes count because asset
    // registration writes user-stated facts the agent should be able to
    // confirm in the same turn.
    const ti = pre.tool_input as { file_path?: string } | undefined;
    if (
      ti?.file_path &&
      (pre.tool_name === "Read" ||
        pre.tool_name === "Write" ||
        pre.tool_name === "Edit")
    ) {
      ctx.filesTouchedThisTurn.add(resolveAbs(cwd, ti.file_path));
    }

    if (pre.tool_name !== FQ_TOOLS.sendTelegramMessage) {
      return { continue: true };
    }

    const sendInput = pre.tool_input as { text?: string } | undefined;
    const text = sendInput?.text ?? "";
    const corpus = buildCorpus(ctx.filesTouchedThisTurn);
    const verdict = evaluateMessage(text, corpus);

    if (verdict.ok) {
      ctx.trace.write({
        type: "hook_decision",
        hook: "no-unverified-specifics",
        decision: "allow",
      });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      };
    }

    ctx.refusalCount.value += 1;
    const phrase = verdict.unverified.map((s) => s.raw).join(" | ");
    const outcome =
      ctx.refusalCount.value >= MAX_REFUSALS_PER_TURN ? "hard_failure" : "revised";
    logRefusal(ctx.userId, phrase, outcome, ctx.trace.path);
    ctx.trace.write({
      type: "hook_decision",
      hook: "no-unverified-specifics",
      decision: "deny",
      reason: verdict.reason,
    });

    const finalReason =
      ctx.refusalCount.value >= MAX_REFUSALS_PER_TURN
        ? `${verdict.reason}\n\nYou've been refused ${ctx.refusalCount.value} times this turn. Stop trying to ground this; either rephrase generically with no specifics, or stay silent.`
        : verdict.reason;

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: finalReason,
      },
    };
  };
}
