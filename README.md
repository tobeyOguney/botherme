# BotherMe

> ⚠️ **Early WIP — here be dragons.** This is the v0 of a research-stage project. The voice is unpolished, the recall mechanic is being tuned, and the bot will sometimes go quiet when it shouldn't (or talk when it shouldn't). Expect rough edges. File issues if you spot them.

A Telegram bot that helps you engage with the things you've already decided matter to you — the unread book, the unfinished course, the friend you mean to call, the skill you keep meaning to practice — by manufacturing the salience the physical world doesn't provide for them.

It is not a planner, tracker, tutor, or coach. It does not show streaks, dashboards, or progress charts. It registers what you've chosen to engage with, asks specific questions about it later, remembers what you said, occasionally tells you it doesn't believe you, and goes quiet when needed.

## Run it yourself

You'll need a Telegram bot token (via [`@BotFather`](https://t.me/BotFather)) and an [Anthropic API key](https://console.anthropic.com/).

By default the bot is **closed** — set `BOTHERME_ALLOWED_TELEGRAM_USERS` to a comma-separated list of Telegram user IDs to let specific people through. Empty = nobody.

### Locally (Node 20+, pnpm)

```bash
git clone https://github.com/tobeyOguney/botherme.git && cd botherme
pnpm install
cp .env.example .env       # paste TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
pnpm dev                   # watch mode; or `pnpm start` for plain run
```

Open Telegram, message your bot. The bot remembers across restarts.

### As a container

A multi-arch image is published to GHCR on every push to `main`:

```bash
docker run --rm \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e TELEGRAM_BOT_TOKEN=12345:ABC... \
  -e BOTHERME_ALLOWED_TELEGRAM_USERS=YOUR_CHAT_ID \
  -v "$PWD/data:/data" -v "$PWD/users:/users" -v "$PWD/traces:/traces" \
  ghcr.io/tobeyoguney/botherme:latest
```

### Hetzner Cloud, end to end

There's a self-contained Terraform module under [`terraform/`](terraform/) that provisions a single Hetzner VM, attaches a persistent volume for `/data` and `/users`, locks the firewall to SSH-only, and runs the container under systemd with auto-pull on restart. About €5/month. See [`terraform/README.md`](terraform/README.md) for the bootstrap. The same module works as a template for any other long-running Node container with similar shape (no inbound HTTP, file-based state).

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
