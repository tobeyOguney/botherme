import { env } from "./config/env.js";
import { logger } from "./observability/logger.js";
import "./persistence/operational.js"; // side-effect: opens DB and runs migrations
import { startTelegram, stopTelegram } from "./channel/telegram.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import {
  scheduleDailySummary,
  stopDailySummary,
} from "./observability/daily-summary.js";

async function main(): Promise<void> {
  logger.info(
    {
      nodeEnv: env.NODE_ENV,
      modelMain: env.BOTHERME_MODEL_MAIN,
      modelRecall: env.BOTHERME_MODEL_RECALL,
      schedulerPaused: env.BOTHERME_SCHEDULER_PAUSED,
      allowedUsers: env.BOTHERME_ALLOWED_TELEGRAM_USERS.size,
    },
    "botherme starting",
  );

  await startTelegram();
  startScheduler();
  scheduleDailySummary();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopDailySummary();
    stopScheduler();
    await stopTelegram();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "boot failed");
  process.exit(1);
});
