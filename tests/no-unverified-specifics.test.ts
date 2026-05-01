import { describe, it, expect } from "vitest";
import {
  detectSpecifics,
  isGrounded,
  evaluateMessage,
} from "../src/agent/hooks/specifics-detector.js";

// ──────────────────────────────────────────────────────────────────
// detectSpecifics — what counts as a specific
// ──────────────────────────────────────────────────────────────────

describe("detectSpecifics: nothing to ground", () => {
  it("plain how-are-you", () => {
    expect(detectSpecifics("how are things?")).toEqual([]);
  });

  it("any update on the book?", () => {
    expect(detectSpecifics("any update on the book?")).toEqual([]);
  });

  it("greeting only", () => {
    expect(detectSpecifics("hey")).toEqual([]);
  });

  it("ignores capitalized sentence-start words", () => {
    expect(detectSpecifics("Today's been quiet, want to try?")).toEqual([]);
  });

  it("ignores stopword days/months", () => {
    expect(detectSpecifics("Monday going OK?")).toEqual([]);
  });

  it("ignores the bot's own name", () => {
    // "BotherMe" appears mid-sentence so we explicitly stopword it
    expect(detectSpecifics("worth saying BotherMe is here.")).toEqual([]);
  });
});

describe("detectSpecifics: proper nouns", () => {
  it("flags a mid-sentence proper noun", () => {
    const out = detectSpecifics("hope Sarah is doing alright");
    expect(out).toEqual([{ kind: "proper_noun", raw: "Sarah" }]);
  });

  it("flags multiple proper nouns and dedupes", () => {
    const out = detectSpecifics("Dan and Dani and Dan again");
    expect(out.map((s) => s.raw).sort()).toEqual(["Dan", "Dani"]);
  });

  it("does not flag I, You, We", () => {
    expect(detectSpecifics("I think You are right.")).toEqual([]);
  });
});

describe("detectSpecifics: numbers with units", () => {
  it("flags 'read for 20 min'", () => {
    const out = detectSpecifics("you read for 20 min yesterday");
    const numUnits = out.filter((s) => s.kind === "number_unit");
    expect(numUnits).toHaveLength(1);
    expect(numUnits[0]!.raw).toMatch(/20\s*min/i);
  });

  it("flags chapter references", () => {
    const out = detectSpecifics("ch 3 was rough");
    const numUnits = out.filter((s) => s.kind === "number_unit");
    expect(numUnits).toHaveLength(1);
  });

  it("skips offers ('want to try 20 min')", () => {
    const out = detectSpecifics("want to try 20 min today?");
    const numUnits = out.filter((s) => s.kind === "number_unit");
    expect(numUnits).toEqual([]);
  });

  it("skips 'in 3 days' (future)", () => {
    const out = detectSpecifics("check in in 3 days?");
    const numUnits = out.filter((s) => s.kind === "number_unit");
    expect(numUnits).toEqual([]);
  });

  it("skips 'next 2 weeks' (future)", () => {
    const out = detectSpecifics("plan for next 2 weeks?");
    const numUnits = out.filter((s) => s.kind === "number_unit");
    expect(numUnits).toEqual([]);
  });
});

describe("detectSpecifics: recall phrases", () => {
  it("flags 'you mentioned X'", () => {
    const out = detectSpecifics("you mentioned trouble sleeping");
    expect(out.some((s) => s.kind === "recall_phrase")).toBe(true);
  });

  it("flags 'last time you said'", () => {
    const out = detectSpecifics("last time you said you'd try again");
    expect(out.some((s) => s.kind === "recall_phrase")).toBe(true);
  });

  it("flags 'remember when'", () => {
    const out = detectSpecifics("remember when you flagged this?");
    expect(out.some((s) => s.kind === "recall_phrase")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// isGrounded
// ──────────────────────────────────────────────────────────────────

describe("isGrounded", () => {
  it("matches a proper noun in the corpus (case-insensitive)", () => {
    expect(
      isGrounded({ kind: "proper_noun", raw: "Sarah" }, "user said Sarah called"),
    ).toBe(true);
  });

  it("does not match a missing proper noun", () => {
    expect(isGrounded({ kind: "proper_noun", raw: "Sarah" }, "no mention here")).toBe(
      false,
    );
  });

  it("matches 'chapter 3' against 'ch 3' via abbreviation variant", () => {
    expect(
      isGrounded({ kind: "number_unit", raw: "chapter 3" }, "got through ch 3 today"),
    ).toBe(true);
  });

  it("matches 'ch 3' against 'chapter 3' via abbreviation variant", () => {
    expect(
      isGrounded({ kind: "number_unit", raw: "ch 3" }, "chapter 3 was about backprop"),
    ).toBe(true);
  });

  it("matches 'minutes' against 'min'", () => {
    expect(
      isGrounded({ kind: "number_unit", raw: "20 minutes" }, "spent 20 min reading"),
    ).toBe(true);
  });

  it("recall phrases are never grounded directly", () => {
    expect(
      isGrounded({ kind: "recall_phrase", raw: "you mentioned" }, "you mentioned X"),
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// evaluateMessage — the integration verdict
// ──────────────────────────────────────────────────────────────────

const MOM_FILE = `---
asset: mom
---
# Mom
Facts:
- 2026-04-15: mentioned trouble sleeping
- lives in Lagos
`;

const GROKKING_FILE = `---
asset: grokking-deep-learning
---
# Grokking Deep Learning
Facts:
- ch 3 was about backprop
- read 20 min on 2026-04-22
`;

describe("evaluateMessage", () => {
  it("allows a generic check-in", () => {
    expect(evaluateMessage("how's the week shaping up?", "")).toEqual({ ok: true });
  });

  it("allows a generic check-in even with no corpus", () => {
    expect(evaluateMessage("hey, all good?", "")).toEqual({ ok: true });
  });

  it("denies recall claim with empty corpus", () => {
    const v = evaluateMessage("you mentioned trouble sleeping", "");
    expect(v.ok).toBe(false);
  });

  it("allows grounded recall claim", () => {
    const v = evaluateMessage(
      "you mentioned trouble sleeping — any update on Mom?",
      MOM_FILE,
    );
    expect(v.ok).toBe(true);
  });

  it("denies recall claim with unrelated corpus", () => {
    const v = evaluateMessage(
      "you mentioned chapter 3 about backprop",
      MOM_FILE,
    );
    expect(v.ok).toBe(false);
  });

  it("allows grounded chapter reference", () => {
    const v = evaluateMessage("how was chapter 3?", GROKKING_FILE);
    expect(v.ok).toBe(true);
  });

  it("denies hallucinated chapter reference", () => {
    const v = evaluateMessage("how was chapter 7?", GROKKING_FILE);
    expect(v.ok).toBe(false);
  });

  it("allows offers (no specifics-as-claims)", () => {
    expect(evaluateMessage("want to try 20 min today?", "")).toEqual({ ok: true });
  });

  it("denies past-tense number claim with empty corpus", () => {
    const v = evaluateMessage("you read 20 min yesterday — how was it?", "");
    expect(v.ok).toBe(false);
  });

  it("allows a recall phrase if accompanied by any grounded specific", () => {
    const v = evaluateMessage(
      "you mentioned ch 3 — feeling clearer on backprop?",
      GROKKING_FILE,
    );
    expect(v.ok).toBe(true);
  });

  it("denies a recall phrase without any grounded accompaniment", () => {
    const v = evaluateMessage(
      "you mentioned Brad and his dog",
      GROKKING_FILE,
    );
    expect(v.ok).toBe(false);
  });

  it("returns the unverified phrase in the refusal", () => {
    const v = evaluateMessage("how's Sarah?", "");
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.unverified.map((s) => s.raw)).toContain("Sarah");
  });
});
