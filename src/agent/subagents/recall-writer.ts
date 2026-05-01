import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { loadSubagentPrompt } from "../system-prompt.js";

/**
 * End-of-turn memory writer. Day-4 work tightens the prompt and verifies
 * deterministic file mutation. v0 wires the AgentDefinition so the surface
 * exists; the parent agent decides when to delegate via the Task tool.
 */
export function recallWriterAgent(): AgentDefinition {
  return {
    description:
      "Background memory writer. Invoke at the end of every turn to update journal/<today>.md and any touched assets/<slug>.md. Does not talk to the user.",
    prompt: loadSubagentPrompt("recall-writer"),
    tools: ["Read", "Write", "Edit", "Glob", "Grep"],
    model: "haiku",
  };
}
