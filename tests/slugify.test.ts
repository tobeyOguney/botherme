import { describe, it, expect } from "vitest";
import { slugify, isValidSlug, SLUG_PATTERN } from "../src/util/slugify.js";

describe("slugify", () => {
  it("lowercases simple input", () => {
    expect(slugify("Mom")).toBe("mom");
  });

  it("hyphenates whitespace", () => {
    expect(slugify("Grokking Deep Learning")).toBe("grokking-deep-learning");
  });

  it("trims surrounding whitespace", () => {
    expect(slugify("  Calculus  ")).toBe("calculus");
  });

  it("strips punctuation", () => {
    expect(slugify("passport renewal!")).toBe("passport-renewal");
  });

  it("ASCII-folds accents", () => {
    expect(slugify("Café visits")).toBe("cafe-visits");
  });

  it("collapses runs of separators", () => {
    expect(slugify("a -- b __ c")).toBe("a-b-c");
  });

  it("drops emoji and symbols", () => {
    expect(slugify("🎹 piano")).toBe("piano");
  });

  it("handles all-caps", () => {
    expect(slugify("ALL CAPS")).toBe("all-caps");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(slugify("   ")).toBe("");
  });

  it("is idempotent", () => {
    const inputs = ["Mom", "Grokking Deep Learning", "Café 100x", "Calc-2"];
    for (const i of inputs) {
      expect(slugify(slugify(i))).toBe(slugify(i));
    }
  });
});

describe("isValidSlug / SLUG_PATTERN", () => {
  it("accepts well-formed slugs", () => {
    expect(isValidSlug("mom")).toBe(true);
    expect(isValidSlug("grokking-deep-learning")).toBe(true);
    expect(isValidSlug("calc-2")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("a1b2")).toBe(true);
  });

  it("rejects malformed slugs", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Mom")).toBe(false); // uppercase
    expect(isValidSlug("-mom")).toBe(false); // leading hyphen
    expect(isValidSlug("mom-")).toBe(false); // trailing hyphen
    expect(isValidSlug("mom--dad")).toBe(false); // double hyphen
    expect(isValidSlug("mom_dad")).toBe(false); // underscore
    expect(isValidSlug("mom dad")).toBe(false); // space
    expect(isValidSlug("café")).toBe(false); // non-ASCII
  });

  it("regex matches isValidSlug", () => {
    const cases = ["mom", "Mom", "", "a-b-c", "a--b"];
    for (const s of cases) {
      expect(SLUG_PATTERN.test(s)).toBe(isValidSlug(s));
    }
  });
});
