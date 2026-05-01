import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Test isolation: every vitest run gets a fresh tmp tree, and env vars are
// pinned to a known-good shape. Tests that need a clean per-user dir should
// rmSync(BOTHERME_USERS_DIR/<userId>) in beforeEach.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "botherme-vitest-"));

process.env.NODE_ENV = "test";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-padding-padding-padding";
process.env.TELEGRAM_BOT_TOKEN = "12345:test-token-abc";
process.env.BOTHERME_DATA_DIR = path.join(tmpRoot, "data");
process.env.BOTHERME_USERS_DIR = path.join(tmpRoot, "users");
process.env.BOTHERME_TRACES_DIR = path.join(tmpRoot, "traces");
process.env.BOTHERME_PROMPTS_DIR = path.join(tmpRoot, "prompts");
process.env.BOTHERME_LOG_LEVEL = "warn";

// Expose for any teardown that wants to remove the tree.
declare global {
  // eslint-disable-next-line no-var
  var __BOTHERME_TEST_ROOT__: string;
}
globalThis.__BOTHERME_TEST_ROOT__ = tmpRoot;
