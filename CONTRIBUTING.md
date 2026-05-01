# Contributing

Short version: this project has one design rule that everything else flows from. Read it before opening a PR.

## The one rule

The product dies the moment the user reclassifies the bot from **agent** to **tool** in their head. Streaks erode that classification. Dashboards erode it. Generic encouragement erodes it. Forms erode it. What defends it: memory of specifics, willingness to stay quiet, willingness to push back, willingness to release commitments.

**Any change that affects what the bot says must include a paragraph in the PR body explaining how it defends agent-classification — or honestly admits it doesn't and justifies the trade.** No exceptions.

## Running locally

1. Node 20+, pnpm
2. `pnpm install`
3. `cp .env.example .env`, paste `TELEGRAM_BOT_TOKEN` and `ANTHROPIC_API_KEY`
4. `pnpm dev`
5. Message your bot on Telegram

## Tests

`pnpm test`. CI runs `typecheck` + `test`.

Tests are required for changes to `src/agent/hooks/no-unverified-specifics.ts` — that file is the structural hallucination defence and the trust contract lives there. Add a case for every real refusal that looks wrong in production.

Tests are not required for prompt changes, tone tuning, or anything in `prompts/*.md`. For those, include a trace example showing before/after behaviour in the PR body.

## What not to add

- Streaks, gamification, scoring
- Dashboards, settings pages, web UIs of any kind
- Generic encouragement templates
- Anything that pulls the user out of the chat to manage the chat

If you're unsure whether something fits, open an issue describing it before writing code.
