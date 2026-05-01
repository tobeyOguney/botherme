import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { env } from "../config/env.js";
import { logger } from "../observability/logger.js";
import { ensureUser, recordInbound } from "../persistence/operational.js";
import { ensureUserTree } from "../persistence/memory.js";
import { runInboundTurn } from "../agent/run-turn.js";
import { withUserLock } from "../persistence/locks.js";

let botInstance: Bot | null = null;

export function getBot(): Bot {
  if (botInstance) return botInstance;
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  bot.api.config.use(autoRetry());
  botInstance = bot;
  return bot;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<void> {
  const bot = getBot();
  await bot.api.sendMessage(chatId, text);
}

function isAllowed(chatId: string): boolean {
  // Empty allowlist = closed bot. Founder must opt people in explicitly.
  return env.BOTHERME_ALLOWED_TELEGRAM_USERS.has(chatId);
}

export function registerHandlers(): void {
  const bot = getBot();

  bot.on("message:text", async (ctx) => {
    if (!ctx.chat?.id || !ctx.from) return;
    const userId = ctx.chat.id.toString();
    const displayName = ctx.from.first_name ?? null;

    if (!isAllowed(userId)) {
      logger.info({ userId }, "rejected message from non-allowlisted user");
      await ctx.reply(
        "not yet — this is invite-only while it's being tuned. check back later.",
      );
      return;
    }

    ensureUser(userId, displayName);
    ensureUserTree(userId);
    recordInbound(userId);

    try {
      await withUserLock(userId, async () => {
        const reply = await runInboundTurn(userId, ctx.message.text);
        if (reply.trim().length > 0) {
          await ctx.reply(reply);
        }
      });
    } catch (err) {
      logger.error({ err, userId }, "inbound turn failed");
      await ctx.reply("give me a sec, my brain's slow today.");
    }
  });

  // Photos, voice, documents — politely deflect for v0.
  bot.on(["message:photo", "message:voice", "message:document", "message:video"], async (ctx) => {
    if (!ctx.chat?.id) return;
    const userId = ctx.chat.id.toString();
    if (!isAllowed(userId)) return;
    await ctx.reply("text only for now.");
  });
}

export async function startTelegram(): Promise<void> {
  const bot = getBot();
  registerHandlers();

  // Long-poll. Webhooks come later when SaaS variant lands.
  bot.start({
    onStart: (info) => {
      logger.info({ username: info.username }, "telegram bot started");
    },
  });
}

export async function stopTelegram(): Promise<void> {
  if (botInstance) {
    await botInstance.stop();
  }
}
