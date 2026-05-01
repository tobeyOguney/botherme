import { readFileSync } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

let cached: string | null = null;

export function loadSystemPrompt(): string {
  if (cached !== null) return cached;
  const promptPath = path.resolve(env.BOTHERME_PROMPTS_DIR, "BOTHERME.md");
  cached = readFileSync(promptPath, "utf8");
  return cached;
}

export function loadSubagentPrompt(name: "recall-writer" | "pushback-evaluator"): string {
  const promptPath = path.resolve(env.BOTHERME_PROMPTS_DIR, `${name}.md`);
  return readFileSync(promptPath, "utf8");
}

// Useful for `tsx watch` — clear cache so prompt edits take effect.
export function clearPromptCache(): void {
  cached = null;
}
