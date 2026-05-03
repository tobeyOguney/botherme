import type { CadenceHint } from "../persistence/memory.js";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

const BASE_INTERVAL_HOURS: Record<CadenceHint, [number, number]> = {
  frequent: [9, 18], // ~half-daily
  regular: [24, 48], // ~daily-ish
  occasional: [60, 120], // ~every 2-5 days
  dormant: [120, 240], // ~weekly-ish
};

export type SchedulerJitterState = {
  /** Unix-ms timestamp of the last inbound user message, or null if none. */
  lastInbound: number | null;
  /** Outbounds since last inbound. */
  consecutiveOutbound: number;
};

/**
 * Decides when the next scheduler tick should consider firing for a user.
 * Returns a Unix-ms timestamp.
 *
 * Pure: same args + same `rand` produce the same output. Tests pass a
 * seeded RNG; production passes Math.random.
 */
export function nextCheckTime(
  hint: CadenceHint,
  now: number,
  state: SchedulerJitterState,
  rand: () => number = Math.random,
): number {
  const [lo, hi] = BASE_INTERVAL_HOURS[hint];
  let hours = lo + (hi - lo) * rand();

  // Penalty: back-to-back outbounds without a user response stretch out.
  if (state.consecutiveOutbound >= 2) {
    hours *= 2 + rand();
  }

  // Bias: a recently-inbound user gets a sooner next-check (relationship is warm).
  if (state.lastInbound !== null && now - state.lastInbound < DAY_MS) {
    hours *= 0.5 + rand() * 0.5;
  }

  // Coarse-grain noise so users never phase-lock at the same wake time.
  hours += (rand() - 0.5) * 4;

  // Floor at 4h — give the user some breathing room even with all the shrinks.
  return now + Math.max(4, hours) * HOUR_MS;
}

/**
 * Probability that the scheduler should *invoke the agent* on this tick,
 * given the user's recent outbound pattern. The agent itself can still
 * decide to stay silent — this is the cheap kill-switch that runs first.
 */
export function shouldSpeakProbability(state: {
  consecutiveOutbound: number;
}): number {
  if (state.consecutiveOutbound >= 3) return 0.5;
  if (state.consecutiveOutbound >= 2) return 0.75;
  return 0.95;
}
