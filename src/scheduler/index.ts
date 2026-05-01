import PQueue from "p-queue";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { runOutboundTurn } from "../agent/run-turn.js";
import { withUserLock } from "../persistence/locks.js";
import {
  claimUser,
  getDueUsers,
  getSchedulerState,
  setNextCheck,
} from "../persistence/operational.js";
import { deriveCadenceHint } from "../persistence/memory.js";
import { nextCheckTime, shouldSpeakProbability } from "./jitter.js";

const TICK_INTERVAL_MS = 30_000;
const PROVISIONAL_HOLD_SEC = 600; // 10 min — covers a slow outbound + retry

const queue = new PQueue({ concurrency: 4 });

let interval: NodeJS.Timeout | null = null;
let pausedLogTs = 0;

export function startScheduler(): void {
  logger.info(
    { paused: env.BOTHERME_SCHEDULER_PAUSED, tickIntervalMs: TICK_INTERVAL_MS },
    "scheduler starting",
  );
  // Fire one tick immediately so we don't wait 30s on cold boot.
  void tick();
  interval = setInterval(() => void tick(), TICK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  queue.clear();
  logger.info("scheduler stopped");
}

async function tick(): Promise<void> {
  if (env.BOTHERME_SCHEDULER_PAUSED) {
    const now = Date.now();
    if (now - pausedLogTs > 60_000) {
      logger.info("scheduler paused (BOTHERME_SCHEDULER_PAUSED=true)");
      pausedLogTs = now;
    }
    return;
  }

  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const due = getDueUsers(nowSec, 50);
  if (due.length === 0) return;

  for (const userId of due) {
    if (!claimUser(userId, nowSec, nowSec + PROVISIONAL_HOLD_SEC)) continue;
    void queue.add(() => runOutboundForUser(userId, now));
  }
}

async function runOutboundForUser(userId: string, now: number): Promise<void> {
  try {
    await withUserLock(userId, async () => {
      const state = getSchedulerState(userId);
      const consecutive = state?.consecutive_outbound ?? 0;
      const hint = deriveCadenceHint(userId);

      // No assets — don't bother the user; reschedule far out.
      if (hint === "dormant") {
        const nextMs = nextCheckTime(
          "dormant",
          now,
          { lastInbound: null, consecutiveOutbound: 0 },
          Math.random,
        );
        setNextCheck(userId, Math.floor(nextMs / 1000));
        logger.debug({ userId }, "dormant — no active assets, deferred");
        return;
      }

      // Probabilistic skip BEFORE invoking the agent (saves tokens).
      const speakP = shouldSpeakProbability({ consecutiveOutbound: consecutive });
      if (Math.random() > speakP) {
        logger.info(
          { userId, consecutive, speakP },
          "scheduler probabilistic skip",
        );
      } else {
        try {
          await runOutboundTurn(userId);
        } catch (err) {
          logger.error({ err, userId }, "outbound turn failed");
        }
      }

      // Reschedule based on fresh state (runOutboundTurn may have updated it).
      const fresh = getSchedulerState(userId);
      const lastInboundMs =
        fresh?.last_inbound != null ? fresh.last_inbound * 1000 : null;
      const nextMs = nextCheckTime(
        hint,
        now,
        {
          lastInbound: lastInboundMs,
          consecutiveOutbound: fresh?.consecutive_outbound ?? consecutive,
        },
        Math.random,
      );
      setNextCheck(userId, Math.floor(nextMs / 1000));
    });
  } catch (err) {
    logger.error({ err, userId }, "outbound dispatch failed");
  }
}
