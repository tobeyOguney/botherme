import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const Schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(20, "ANTHROPIC_API_KEY missing or too short"),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]+$/, "TELEGRAM_BOT_TOKEN must look like '12345:ABC...'"),

  BOTHERME_DATA_DIR: z.string().default("./data"),
  BOTHERME_USERS_DIR: z.string().default("./users"),
  BOTHERME_TRACES_DIR: z.string().default("./traces"),
  BOTHERME_PROMPTS_DIR: z.string().default("./prompts"),

  BOTHERME_SCHEDULER_PAUSED: z
    .string()
    .default("false")
    .transform((s) => s.toLowerCase() === "true"),
  BOTHERME_LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
  BOTHERME_ALLOWED_TELEGRAM_USERS: z
    .string()
    .default("")
    .transform((s) => new Set(s.split(",").map((x) => x.trim()).filter(Boolean))),

  BOTHERME_MODEL_MAIN: z.string().default("claude-sonnet-4-5"),
  BOTHERME_MODEL_RECALL: z.string().default("claude-haiku-4-5"),
  BOTHERME_MODEL_PUSHBACK: z.string().default("claude-haiku-4-5"),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Environment validation failed:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
