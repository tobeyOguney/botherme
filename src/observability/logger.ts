import pino from "pino";
import { env } from "../config/env.js";

const isTty = process.stdout.isTTY;

export const logger = pino({
  level: env.BOTHERME_LOG_LEVEL,
  base: { svc: "botherme" },
  ...(isTty
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
