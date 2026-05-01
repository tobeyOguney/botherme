import matter from "gray-matter";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { isValidSlug } from "../util/slugify.js";

export const IndexFrontmatter = z.object({
  user: z.string(),
  last_updated: z.string().optional(),
  active_assets: z.number().int().nonnegative().default(0),
  last_message_in: z.string().optional(),
  last_message_out: z.string().optional(),
});
export type IndexFrontmatter = z.infer<typeof IndexFrontmatter>;

export const CadenceHint = z.enum(["frequent", "regular", "occasional", "dormant"]);
export type CadenceHint = z.infer<typeof CadenceHint>;

export const AssetFrontmatter = z.object({
  asset: z.string(),
  name: z.string().optional(),
  created: z.string(),
  cadence: z.string(),
  cadence_hint: CadenceHint.default("regular"),
  status: z.enum(["active", "dormant", "killed"]).default("active"),
  last_engaged: z.string().optional(),
  killed_at: z.string().optional(),
  killed_reason: z.string().optional(),
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

// ──────────────────────────────────────────────────────────────────
// Asset file primitives (Day 3)
// Pure-ish file I/O; the MCP tools are thin wrappers around these so
// tests can verify behaviour without the SDK runtime.
// ──────────────────────────────────────────────────────────────────

export type RegisterAssetInput = {
  name: string;
  slug: string;
  whatEngagementLooksLike: string;
  cadence: string;
  cadenceHint: CadenceHint;
};

export type RegisterAssetResult =
  | { ok: true; path: string }
  | { ok: false; reason: "invalid_slug" | "already_exists" };

export function activeAssetPath(userId: string, slug: string): string {
  return path.join(userDir(userId), "assets", `${slug}.md`);
}

export function killedAssetPath(userId: string, slug: string): string {
  return path.join(userDir(userId), "assets", "_killed", `${slug}.md`);
}

export function writeAssetFile(
  userId: string,
  input: RegisterAssetInput,
): RegisterAssetResult {
  if (!isValidSlug(input.slug)) {
    return { ok: false, reason: "invalid_slug" };
  }
  ensureUserTree(userId);
  const target = activeAssetPath(userId, input.slug);
  const archived = killedAssetPath(userId, input.slug);
  if (existsSync(target) || existsSync(archived)) {
    return { ok: false, reason: "already_exists" };
  }
  const today = new Date().toISOString().slice(0, 10);
  const body = matter.stringify(
    [
      `# ${input.name}`,
      "",
      "## What engagement looks like",
      "",
      input.whatEngagementLooksLike,
      "",
      "## Facts (user-stated, dated)",
      "",
      "## Engagement log",
      "",
    ].join("\n"),
    {
      asset: input.slug,
      name: input.name,
      created: today,
      cadence: input.cadence,
      cadence_hint: input.cadenceHint,
      status: "active",
    },
  );
  atomicWrite(target, body);
  return { ok: true, path: target };
}

export type KillAssetResult =
  | { ok: true; path: string }
  | { ok: false; reason: "not_found" | "invalid_slug" };

/**
 * Counts active assets for a user by reading the filesystem (the source
 * of truth). Killed assets in `_killed/` don't count.
 */
export function countActiveAssets(userId: string): number {
  const dir = path.join(userDir(userId), "assets");
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) count += 1;
  }
  return count;
}

/**
 * Maps active asset count to a scheduler cadence bucket. Approximation —
 * a user with many assets is more likely to want frequent contact, but
 * the agent can still go quiet on any given outbound.
 */
export function deriveCadenceHint(userId: string): CadenceHint {
  const n = countActiveAssets(userId);
  if (n === 0) return "dormant";
  if (n === 1) return "occasional";
  if (n <= 3) return "regular";
  return "frequent";
}

export function killAssetFile(
  userId: string,
  slug: string,
  reason?: string,
): KillAssetResult {
  if (!isValidSlug(slug)) return { ok: false, reason: "invalid_slug" };
  const src = activeAssetPath(userId, slug);
  if (!existsSync(src)) return { ok: false, reason: "not_found" };

  const raw = readFileSync(src, "utf8");
  const parsed = matter(raw);
  const today = new Date().toISOString().slice(0, 10);
  const newFrontmatter: Record<string, unknown> = {
    ...parsed.data,
    status: "killed",
    killed_at: today,
  };
  if (reason && reason.trim().length > 0) {
    newFrontmatter.killed_reason = reason.trim();
  }
  const updated = matter.stringify(parsed.content, newFrontmatter);
  const dst = killedAssetPath(userId, slug);
  atomicWrite(dst, updated);
  unlinkSync(src);
  return { ok: true, path: dst };
}
