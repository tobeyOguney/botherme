# BotherMe

> ⚠️ **Early WIP — here be dragons.** This is the v0 of a research-stage project. The voice is unpolished, the recall mechanic is being tuned, and the bot will sometimes go quiet when it shouldn't (or talk when it shouldn't). Expect rough edges. File issues if you spot them.

A Telegram bot that helps you engage with the things you've already decided matter to you — the unread book, the unfinished course, the friend you mean to call, the skill you keep meaning to practice — by manufacturing the salience the physical world doesn't provide for them.

It is not a planner, tracker, tutor, or coach. It does not show streaks, dashboards, or progress charts. It registers what you've chosen to engage with, asks specific questions about it later, remembers what you said, occasionally tells you it doesn't believe you, and goes quiet when needed.

## Run it yourself

You'll need: Node 20+, pnpm, a Telegram bot token (via [`@BotFather`](https://t.me/BotFather)), an Anthropic API key.

```bash
git clone <this repo> botherme && cd botherme
pnpm install
cp .env.example .env       # paste TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
pnpm dev                   # local; or: pnpm start (with pm2)
```

Open Telegram, message your bot. The bot remembers across restarts; user data lives in `./users/<chatId>/` as plain markdown files. You can read them.

By default the bot is **closed** — set `BOTHERME_ALLOWED_TELEGRAM_USERS` to a comma-separated list of chat IDs to allow specific people. Empty = nobody.

## What's in the directory after a few weeks of use

```
users/<chatId>/
├── index.md              # always loaded; ~200-500 tokens
├── assets/<slug>.md      # one file per active obligation
├── journal/YYYY-MM-DD.md # daily diary the bot maintains
└── meta/                 # voice notes, refusal log, pushback log
```

That's the entire memory model. No vector store, no opaque embeddings — if you want to know what the bot remembers about you, `cat` the file.

## License

Apache-2.0.
