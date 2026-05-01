import { describe, it, expect } from "vitest";
import {
  nextCheckTime,
  shouldSpeakProbability,
} from "../src/scheduler/jitter.js";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Simple seeded LCG so tests are deterministic.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const NOW = 1_700_000_000_000;

describe("nextCheckTime: bounds", () => {
  it("frequent: hours fall within [8, ~40] on plain cold state", () => {
    for (let seed = 1; seed < 100; seed++) {
      const r = nextCheckTime(
        "frequent",
        NOW,
        { lastInbound: null, consecutiveOutbound: 0 },
        seeded(seed),
      );
      const hours = (r - NOW) / HOUR_MS;
      expect(hours).toBeGreaterThanOrEqual(8);
      expect(hours).toBeLessThanOrEqual(40); // 36 + 2 noise + small slack
    }
  });

  it("regular: hours roughly within [8, ~100]", () => {
    for (let seed = 1; seed < 100; seed++) {
      const r = nextCheckTime(
        "regular",
        NOW,
        { lastInbound: null, consecutiveOutbound: 0 },
        seeded(seed),
      );
      const hours = (r - NOW) / HOUR_MS;
      expect(hours).toBeGreaterThanOrEqual(8);
      expect(hours).toBeLessThanOrEqual(100);
    }
  });

  it("dormant: hours significantly larger than frequent", () => {
    const meanFor = (hint: "frequent" | "dormant") => {
      let sum = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const r = nextCheckTime(
          hint,
          NOW,
          { lastInbound: null, consecutiveOutbound: 0 },
          seeded(i + 1),
        );
        sum += (r - NOW) / HOUR_MS;
      }
      return sum / N;
    };
    expect(meanFor("dormant")).toBeGreaterThan(meanFor("frequent") * 5);
  });
});

describe("nextCheckTime: penalty for consecutive outbounds", () => {
  it("doubles+ when consecutiveOutbound >= 2", () => {
    const meanAt = (consec: number) => {
      let sum = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const r = nextCheckTime(
          "regular",
          NOW,
          { lastInbound: null, consecutiveOutbound: consec },
          seeded(i + 1),
        );
        sum += (r - NOW) / HOUR_MS;
      }
      return sum / N;
    };
    expect(meanAt(2)).toBeGreaterThan(meanAt(0) * 2);
  });

  it("treats consecutiveOutbound=0 and =1 the same", () => {
    const meanAt = (consec: number) => {
      let sum = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const r = nextCheckTime(
          "regular",
          NOW,
          { lastInbound: null, consecutiveOutbound: consec },
          seeded(i + 1),
        );
        sum += (r - NOW) / HOUR_MS;
      }
      return sum / N;
    };
    const m0 = meanAt(0);
    const m1 = meanAt(1);
    expect(Math.abs(m0 - m1) / m0).toBeLessThan(0.05); // within 5%
  });
});

describe("nextCheckTime: warmth bias for recent inbound", () => {
  it("shrinks the wait when lastInbound is recent", () => {
    const meanWith = (lastInbound: number | null) => {
      let sum = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const r = nextCheckTime(
          "regular",
          NOW,
          { lastInbound, consecutiveOutbound: 0 },
          seeded(i + 1),
        );
        sum += (r - NOW) / HOUR_MS;
      }
      return sum / N;
    };
    const cold = meanWith(null);
    const warm = meanWith(NOW - HOUR_MS); // 1h ago
    expect(warm).toBeLessThan(cold * 0.85);
  });

  it("does NOT shrink when lastInbound is older than a day", () => {
    const meanWith = (lastInbound: number | null) => {
      let sum = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const r = nextCheckTime(
          "regular",
          NOW,
          { lastInbound, consecutiveOutbound: 0 },
          seeded(i + 1),
        );
        sum += (r - NOW) / HOUR_MS;
      }
      return sum / N;
    };
    const stale = meanWith(NOW - 2 * DAY_MS);
    const cold = meanWith(null);
    expect(Math.abs(stale - cold) / cold).toBeLessThan(0.05);
  });
});

describe("nextCheckTime: floor", () => {
  it("never returns less than 8 hours ahead, even with all shrinks", () => {
    for (let seed = 1; seed < 200; seed++) {
      const r = nextCheckTime(
        "frequent",
        NOW,
        { lastInbound: NOW - 60 * 1000, consecutiveOutbound: 0 },
        seeded(seed),
      );
      const hours = (r - NOW) / HOUR_MS;
      expect(hours).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("nextCheckTime: no phase-locking", () => {
  it("two different seeds produce different times for identical state", () => {
    const t1 = nextCheckTime(
      "regular",
      NOW,
      { lastInbound: null, consecutiveOutbound: 0 },
      seeded(1),
    );
    const t2 = nextCheckTime(
      "regular",
      NOW,
      { lastInbound: null, consecutiveOutbound: 0 },
      seeded(2),
    );
    expect(t1).not.toBe(t2);
  });

  it("seeded RNG is stable: same seed = same output", () => {
    const t1 = nextCheckTime(
      "regular",
      NOW,
      { lastInbound: null, consecutiveOutbound: 0 },
      seeded(42),
    );
    const t2 = nextCheckTime(
      "regular",
      NOW,
      { lastInbound: null, consecutiveOutbound: 0 },
      seeded(42),
    );
    expect(t1).toBe(t2);
  });
});

describe("shouldSpeakProbability", () => {
  it("returns 0.85 by default", () => {
    expect(shouldSpeakProbability({ consecutiveOutbound: 0 })).toBe(0.85);
  });

  it("returns 0.85 at 1 consecutive", () => {
    expect(shouldSpeakProbability({ consecutiveOutbound: 1 })).toBe(0.85);
  });

  it("drops to 0.6 at 2 consecutive", () => {
    expect(shouldSpeakProbability({ consecutiveOutbound: 2 })).toBe(0.6);
  });

  it("drops to 0.3 at 3 consecutive", () => {
    expect(shouldSpeakProbability({ consecutiveOutbound: 3 })).toBe(0.3);
  });

  it("stays at 0.3 beyond 3 consecutive", () => {
    expect(shouldSpeakProbability({ consecutiveOutbound: 7 })).toBe(0.3);
  });

  it("is monotonically non-increasing in consecutiveOutbound", () => {
    let prev = 1;
    for (let c = 0; c <= 10; c++) {
      const p = shouldSpeakProbability({ consecutiveOutbound: c });
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});
