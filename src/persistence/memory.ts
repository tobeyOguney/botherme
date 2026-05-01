import matter from "gray-matter";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";

export const IndexFrontmatter = z.object({
  user: z.string(),
  last_updated: z.string().optional(),
  active_assets: z.number().int().nonnegative().default(0),
  last_message_in: z.string().optional(),
  last_message_out: z.string().optional(),
});
export type IndexFrontmatter = z.infer<typeof IndexFrontmatter>;

export const AssetFrontmatter = z.object({
  asset: z.string(),
  created: z.string(),
  cadence: z.string(),
  status: z.enum(["active", "dormant", "killed"]).default("active"),
  last_engaged: z.string().optional(),
});
export type AssetFrontmatter = z.infer<typeof AssetFrontmatter>;

export const JournalFrontmatter = z.object({
  date: z.string(),
  turns: z.number().int().nonnegative().default(0),
});
export type JournalFrontmatter = z.infer<typeof JournalFrontmatter>;

export function userDir(userId: string): string {
  return path.resolve(env.BOTHERME_USERS_DIR, userId);
}

export function ensureUserTree(userId: string): string {
  const root = userDir(userId);
  mkdirSync(path.join(root, "assets"), { recursive: true });
  mkdirSync(path.join(root, "assets", "_killed"), { recursive: true });
  mkdirSync(path.join(root, "journal"), { recursive: true });
  mkdirSync(path.join(root, "meta"), { recursive: true });
  mkdirSync(path.join(root, ".session"), { recursive: true });

  // Seed an initial index.md if missing — first turn always reads it.
  const idx = path.join(root, "index.md");
  if (!existsSync(idx)) {
    const seed = matter.stringify(
      [
        "# new user",
        "",
        "No assets registered yet. Onboarding: ask what they're trying to engage with",
        "and what doing it would look like, concretely.",
        "",
        "## Active assets",
        "_(none yet)_",
        "",
        "## Recent journal",
        "_(none yet)_",
      ].join("\n"),
      {
        user: userId,
        last_updated: new Date().toISOString().slice(0, 10),
        active_assets: 0,
      },
    );
    atomicWrite(idx, seed);
  }
  return root;
}

export function atomicWrite(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, filePath);
}

export function readMarkdown<F>(
  filePath: string,
  frontmatterSchema: z.ZodType<F>,
): { frontmatter: F; body: string } | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    const fm = frontmatterSchema.safeParse(parsed.data);
    if (!fm.success) {
      logger.warn(
        { filePath, issues: fm.error.issues },
        "frontmatter validation failed; skipping file",
      );
      return null;
    }
    return { frontmatter: fm.data, body: parsed.content };
  } catch (err) {
    logger.warn({ filePath, err }, "failed to read markdown file");
    return null;
  }
}
