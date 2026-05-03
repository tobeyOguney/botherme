import { describe, it, expect, beforeEach } from "vitest";
import { rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import * as memory from "../src/persistence/memory.js";

const USER_ID = "test-user-1";

beforeEach(() => {
  // Clean per-user directory between tests. setup.ts pinned BOTHERME_USERS_DIR
  // to a tmp path before this module loaded.
  const userDir = path.join(process.env.BOTHERME_USERS_DIR!, USER_ID);
  if (existsSync(userDir)) rmSync(userDir, { recursive: true, force: true });
});

describe("writeAssetFile", () => {
  it("writes a well-formed asset file with correct frontmatter", () => {
    const result = memory.writeAssetFile(USER_ID, {
      name: "Grokking Deep Learning",
      slug: "grokking-deep-learning",
      whatEngagementLooksLike: "30 min reading + a sentence about what stuck",
      cadence: "weekly-ish",
      cadenceHint: "regular",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(result.path)).toBe(true);

    const raw = readFileSync(result.path, "utf8");
    const parsed = matter(raw);
    expect(parsed.data).toMatchObject({
      asset: "grokking-deep-learning",
      name: "Grokking Deep Learning",
      cadence: "weekly-ish",
      cadence_hint: "regular",
      status: "active",
    });
    expect(parsed.data.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.content).toContain("30 min reading + a sentence about what stuck");
    expect(parsed.content).toContain("# Grokking Deep Learning");
    expect(parsed.content).toContain("## Facts (user-stated, dated)");
    expect(parsed.content).toContain("## Engagement log");
  });

  it("rejects invalid slugs", () => {
    const result = memory.writeAssetFile(USER_ID, {
      name: "Mom",
      slug: "Mom", // uppercase = invalid
      whatEngagementLooksLike: "a real call or message",
      cadence: "bi-weekly",
      cadenceHint: "regular",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_slug");
  });

  it("rejects when an active asset with the same slug exists", () => {
    memory.writeAssetFile(USER_ID, {
      name: "Mom",
      slug: "mom",
      whatEngagementLooksLike: "a real call or message",
      cadence: "bi-weekly",
      cadenceHint: "regular",
    });
    const second = memory.writeAssetFile(USER_ID, {
      name: "Mom Again",
      slug: "mom",
      whatEngagementLooksLike: "different",
      cadence: "weekly",
      cadenceHint: "regular",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already_exists");
  });

  it("rejects when a killed asset with the same slug exists (no resurrection)", () => {
    memory.writeAssetFile(USER_ID, {
      name: "Duolingo",
      slug: "duolingo",
      whatEngagementLooksLike: "10 min/day",
      cadence: "daily",
      cadenceHint: "frequent",
    });
    memory.killAssetFile(USER_ID, "duolingo");
    const retry = memory.writeAssetFile(USER_ID, {
      name: "Duolingo",
      slug: "duolingo",
      whatEngagementLooksLike: "10 min/day",
      cadence: "daily",
      cadenceHint: "frequent",
    });
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.reason).toBe("already_exists");
  });
});

describe("killAssetFile", () => {
  it("moves the file to _killed/ and updates frontmatter", () => {
    memory.writeAssetFile(USER_ID, {
      name: "Piano practice",
      slug: "piano-practice",
      whatEngagementLooksLike: "20 min noodling",
      cadence: "irregular",
      cadenceHint: "occasional",
    });
    const result = memory.killAssetFile(USER_ID, "piano-practice", "lost interest");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(existsSync(memory.activeAssetPath(USER_ID, "piano-practice"))).toBe(false);
    expect(existsSync(result.path)).toBe(true);

    const parsed = matter(readFileSync(result.path, "utf8"));
    expect(parsed.data.status).toBe("killed");
    expect(parsed.data.killed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.data.killed_reason).toBe("lost interest");
    expect(parsed.data.asset).toBe("piano-practice"); // preserved
  });

  it("omits killed_reason when not provided", () => {
    memory.writeAssetFile(USER_ID, {
      name: "Piano",
      slug: "piano",
      whatEngagementLooksLike: "20 min",
      cadence: "weekly",
      cadenceHint: "regular",
    });
    const result = memory.killAssetFile(USER_ID, "piano");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = matter(readFileSync(result.path, "utf8"));
    expect(parsed.data.killed_reason).toBeUndefined();
  });

  it("returns not_found when no active asset exists", () => {
    const result = memory.killAssetFile(USER_ID, "nonexistent");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
  });

  it("returns invalid_slug for a malformed slug", () => {
    const result = memory.killAssetFile(USER_ID, "Bad Slug");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_slug");
  });
});

describe("validateAssetMarkdown", () => {
  it("returns null for well-formed active frontmatter", () => {
    const raw = matter.stringify("body", {
      asset: "x",
      created: "2026-05-03",
      cadence: "weekly",
      cadence_hint: "occasional",
      status: "active",
    });
    expect(memory.validateAssetMarkdown(raw)).toBeNull();
  });

  it("returns null for an exploring asset with explicit nulls", () => {
    const raw = matter.stringify("body", {
      asset: "x",
      created: "2026-05-03",
      cadence: null,
      cadence_hint: null,
      status: "exploring",
      last_engaged: null,
    });
    expect(memory.validateAssetMarkdown(raw)).toBeNull();
  });

  it("flags a bogus status", () => {
    const raw = matter.stringify("body", {
      asset: "x",
      created: "2026-05-03",
      cadence: "weekly",
      cadence_hint: "occasional",
      status: "snoozing",
    });
    const issues = memory.validateAssetMarkdown(raw);
    expect(issues).not.toBeNull();
    expect(issues!.some((s) => s.startsWith("status:"))).toBe(true);
  });

  it("flags missing required field", () => {
    const raw = matter.stringify("body", {
      asset: "x",
      // created missing
      cadence: "weekly",
    });
    const issues = memory.validateAssetMarkdown(raw);
    expect(issues).not.toBeNull();
    expect(issues!.some((s) => s.startsWith("created:"))).toBe(true);
  });
});

describe("regenerateIndex", () => {
  it("reflects active assets in frontmatter and body", () => {
    memory.ensureUserTree(USER_ID);
    memory.writeAssetFile(USER_ID, {
      name: "Driving theory",
      slug: "driving-theory",
      whatEngagementLooksLike: "30 min on the app",
      cadence: "daily-ish",
      cadenceHint: "frequent",
    });
    memory.writeAssetFile(USER_ID, {
      name: "Swedish",
      slug: "swedish",
      whatEngagementLooksLike: "10 min in Duolingo",
      cadence: "daily",
      cadenceHint: "frequent",
    });

    memory.regenerateIndex(USER_ID);

    const idxPath = path.join(
      process.env.BOTHERME_USERS_DIR!,
      USER_ID,
      "index.md",
    );
    const parsed = matter(readFileSync(idxPath, "utf8"));
    expect(parsed.data.active_assets).toBe(2);
    expect(parsed.content).toContain("Driving theory");
    expect(parsed.content).toContain("Swedish");
    expect(parsed.content).toContain("daily");
  });

  it("excludes killed assets from the count and listing", () => {
    memory.ensureUserTree(USER_ID);
    memory.writeAssetFile(USER_ID, {
      name: "Keep",
      slug: "keep",
      whatEngagementLooksLike: "do the thing",
      cadence: "weekly",
      cadenceHint: "occasional",
    });
    memory.writeAssetFile(USER_ID, {
      name: "Drop",
      slug: "drop",
      whatEngagementLooksLike: "do the other thing",
      cadence: "weekly",
      cadenceHint: "occasional",
    });
    memory.killAssetFile(USER_ID, "drop", "lost interest");
    memory.regenerateIndex(USER_ID);

    const idxPath = path.join(
      process.env.BOTHERME_USERS_DIR!,
      USER_ID,
      "index.md",
    );
    const parsed = matter(readFileSync(idxPath, "utf8"));
    expect(parsed.data.active_assets).toBe(1);
    expect(parsed.content).toContain("Keep");
    expect(parsed.content).not.toContain("- **Drop**");
  });

  it("lists exploring assets in their own section, not in active count", () => {
    memory.ensureUserTree(USER_ID);
    memory.writeAssetFile(USER_ID, {
      name: "Active",
      slug: "active",
      whatEngagementLooksLike: "do the thing",
      cadence: "weekly",
      cadenceHint: "occasional",
    });
    // Hand-roll an "exploring" asset since register_asset only writes active.
    // Include explicit nulls on every optional field — that's the shape the
    // agent actually produces via the Write tool (YAML serializer emits null).
    const fm = matter.stringify("# Swedish\n\nuser mentioned wanting to learn", {
      asset: "swedish",
      name: "Swedish",
      created: "2026-05-03",
      cadence: null,
      cadence_hint: null,
      status: "exploring",
      last_engaged: null,
    });
    const exploringPath = path.join(
      process.env.BOTHERME_USERS_DIR!,
      USER_ID,
      "assets",
      "swedish.md",
    );
    require("node:fs").writeFileSync(exploringPath, fm, "utf8");

    memory.regenerateIndex(USER_ID);

    const idxPath = path.join(
      process.env.BOTHERME_USERS_DIR!,
      USER_ID,
      "index.md",
    );
    const parsed = matter(readFileSync(idxPath, "utf8"));
    expect(parsed.data.active_assets).toBe(1);
    expect(parsed.content).toContain("Active");
    expect(parsed.content).toContain("Exploring (no cadence yet)");
    expect(parsed.content).toContain("Swedish");
    expect(parsed.content).toContain("ask the user to commit or drop");
  });

  it("renders the empty state when no assets exist", () => {
    memory.ensureUserTree(USER_ID);
    memory.regenerateIndex(USER_ID);

    const idxPath = path.join(
      process.env.BOTHERME_USERS_DIR!,
      USER_ID,
      "index.md",
    );
    const parsed = matter(readFileSync(idxPath, "utf8"));
    expect(parsed.data.active_assets).toBe(0);
    expect(parsed.content).toContain("new user");
    expect(parsed.content).toContain("(none yet");
  });
});
