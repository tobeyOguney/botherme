/**
 * Pure functions for the no-unverified-specifics hallucination defence.
 *
 * The contract: an outbound message containing specifics-shaped content
 * must have every specific groundable in the corpus of files the agent
 * read this turn. False-allows are bad (hallucinated callbacks); false-
 * denies are tolerable (the agent will revise to a safer phrasing).
 *
 * This file has no I/O. The hook layer feeds it the message text and the
 * read-file corpus; everything here is regex + string ops, fully testable.
 */

export type SpecificKind = "proper_noun" | "number_unit" | "recall_phrase";

export type Specific = {
  kind: SpecificKind;
  raw: string;
};

export type Verdict =
  | { ok: true }
  | { ok: false; unverified: Specific[]; reason: string };

// Phrases that *claim* the user said or did something. On their own they
// don't violate the rule, but they require at least one accompanying
// grounded specific — otherwise we have a recall claim with no source.
export const RECALL_PHRASES: readonly RegExp[] = [
  /\byou (?:mentioned|said|told me|wrote)\b/i,
  /\blast time (?:we (?:talked|spoke)|you said|you mentioned)\b/i,
  /\bback (?:on|in) [A-Z]\w+\b/i, // "back in March"
  /\bremember (?:when|that)\b/i,
  /\b(?:on|the other day) you\b/i,
];

// Capitalized words ≥3 chars are candidate proper nouns.
export const PROPER_NOUN = /\b[A-Z][a-z]{2,}\b/g;

export const STOPWORDS: ReadonlySet<string> = new Set([
  // pronouns / sentence starters that often capitalize
  "I",
  "You",
  "We",
  "They",
  "He",
  "She",
  "It",
  "Hey",
  "Hi",
  "Hello",
  "Yes",
  "No",
  "Sure",
  "Okay",
  "Maybe",
  // calendar
  "Today",
  "Yesterday",
  "Tomorrow",
  "Tonight",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  // bot's own name
  "BotherMe",
  "Botherme",
  // generic concepts often capitalized in casual writing
  "OK",
  "TV",
  "DM",
  "PM",
  "AM",
]);

// Number-first phrases: durations and counts. "20 min", "3 days", "5 reps".
export const NUMBERS_WITH_UNITS_NUMBER_FIRST =
  /\b\d+\s*(?:min(?:ute)?s?|hours?|hrs?|days?|weeks?|months?|years?|pages?|pgs?|chapters?|chs?|times?|sessions?|reps?)\b/gi;

// Unit-first phrases: structural references. "chapter 7", "ch 3", "page 12".
export const NUMBERS_WITH_UNITS_UNIT_FIRST =
  /\b(?:chapters?|chs?|pages?|pgs?|sections?|episodes?|eps?|parts?|lessons?|sets?|rounds?)\s+\d+\b/gi;

// If the number-unit phrase is preceded by an offer-y word within ~25
// chars, treat it as a future suggestion, not a past claim.
export const OFFER_TRIGGERS =
  /\b(?:could|try|trying|let'?s|maybe|how about|what if|want to|wanna|in|next|this)\b/i;

export function detectSpecifics(message: string): Specific[] {
  const found: Specific[] = [];

  // 1. Recall phrases — weaker signal; grounding step requires another
  //    grounded specific to accompany them.
  for (const re of RECALL_PHRASES) {
    const m = message.match(re);
    if (m) {
      found.push({ kind: "recall_phrase", raw: m[0] });
      break;
    }
  }

  // 2. Proper nouns (capitalized non-stopwords, skipping sentence-starts).
  for (const m of message.matchAll(PROPER_NOUN)) {
    const word = m[0];
    if (STOPWORDS.has(word)) continue;
    const idx = m.index ?? 0;
    if (idx === 0) continue;
    const before = idx >= 2 ? message.slice(idx - 2, idx) : "";
    if (/[.!?]\s/.test(before)) continue;
    found.push({ kind: "proper_noun", raw: word });
  }

  // 3. Numbers with units (both orderings), skipping offer-context.
  for (const re of [NUMBERS_WITH_UNITS_NUMBER_FIRST, NUMBERS_WITH_UNITS_UNIT_FIRST]) {
    for (const m of message.matchAll(re)) {
      const idx = m.index ?? 0;
      const window = message.slice(Math.max(0, idx - 25), idx);
      if (OFFER_TRIGGERS.test(window)) continue;
      found.push({ kind: "number_unit", raw: m[0].trim() });
    }
  }

  return dedupe(found);
}

function dedupe(specifics: Specific[]): Specific[] {
  const seen = new Set<string>();
  const out: Specific[] = [];
  for (const s of specifics) {
    const key = `${s.kind}:${s.raw.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * - Proper nouns: case-insensitive substring match.
 * - Numbers with units: exact phrase OR a known abbreviation variant.
 * - Recall phrases: never directly grounded; treated as a flag in evaluate().
 */
export function isGrounded(specific: Specific, corpus: string): boolean {
  if (specific.kind === "recall_phrase") return false;

  const lcCorpus = corpus.toLowerCase();
  const lcRaw = specific.raw.toLowerCase();

  if (specific.kind === "proper_noun") {
    return lcCorpus.includes(lcRaw);
  }

  // number_unit
  if (lcCorpus.includes(lcRaw)) return true;
  const variants = numberUnitVariants(lcRaw);
  return variants.some((v) => lcCorpus.includes(v));
}

function numberUnitVariants(s: string): string[] {
  const variants = new Set<string>();
  // chapter <-> ch (handles 'chapter 7' <-> 'ch 7' and '7 chapters' <-> '7 ch')
  if (/\bchapters?\b/.test(s)) variants.add(s.replace(/chapters?/g, "ch"));
  if (/\bchs?\b/.test(s)) variants.add(s.replace(/\bchs?\b/g, "chapter"));
  // page <-> pg
  if (/\bpages?\b/.test(s)) variants.add(s.replace(/pages?/g, "pg"));
  if (/\bpgs?\b/.test(s)) variants.add(s.replace(/\bpgs?\b/g, "page"));
  // minute <-> min
  if (/\bminutes?\b/.test(s)) variants.add(s.replace(/minutes?/g, "min"));
  if (/\bmin\b/.test(s)) variants.add(s.replace(/\bmin\b/g, "minute"));
  // hour <-> hr
  if (/\bhours?\b/.test(s)) variants.add(s.replace(/hours?/g, "hr"));
  if (/\bhrs?\b/.test(s)) variants.add(s.replace(/\bhrs?\b/g, "hour"));
  return [...variants];
}

/**
 * Top-level evaluation. Returns ok:true if safe to send, ok:false with
 * the unverified specifics + a refusal reason otherwise.
 */
export function evaluateMessage(message: string, corpus: string): Verdict {
  const specifics = detectSpecifics(message);
  if (specifics.length === 0) return { ok: true };

  const groundable = specifics.filter((s) => s.kind !== "recall_phrase");
  const recallFlag = specifics.some((s) => s.kind === "recall_phrase");

  if (!corpus.trim()) {
    return {
      ok: false,
      unverified: specifics,
      reason:
        "no files were read this turn, so any specific claim is unverified. Read index.md (and any relevant asset files) before sending, or rephrase generically.",
    };
  }

  const ungrounded = groundable.filter((s) => !isGrounded(s, corpus));

  if (recallFlag) {
    const anyGrounded = groundable.some((s) => isGrounded(s, corpus));
    if (!anyGrounded) {
      return {
        ok: false,
        unverified: specifics.filter((s) => s.kind === "recall_phrase").concat(ungrounded),
        reason:
          "the message uses a recall phrase ('you mentioned', 'last time', etc.) but doesn't cite a specific that's in any file you read. Either ground the claim or remove the recall phrasing.",
      };
    }
  }

  if (ungrounded.length > 0) {
    return {
      ok: false,
      unverified: ungrounded,
      reason: `unverified specific${ungrounded.length === 1 ? "" : "s"}: ${ungrounded
        .map((s) => `"${s.raw}"`)
        .join(", ")}. Either read the file containing the fact or rephrase without the claim.`,
    };
  }

  return { ok: true };
}
