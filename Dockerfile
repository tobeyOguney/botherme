# syntax=docker/dockerfile:1.7

FROM node:20-bookworm AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

COPY package.json pnpm-lock.yaml ./
# tsx is a devDependency but is required at runtime ("node --import tsx ..."),
# so we install the full dependency set and do not prune.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY prompts ./prompts


FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    BOTHERME_DATA_DIR=/data \
    BOTHERME_USERS_DIR=/users \
    BOTHERME_TRACES_DIR=/traces \
    BOTHERME_PROMPTS_DIR=/app/prompts

# git + ripgrep are required by @anthropic-ai/claude-agent-sdk's bundled
# cli.js — without them every Claude Code subprocess exits 1 immediately.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data /users /traces \
 && chown -R node:node /data /users /traces

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/prompts ./prompts
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/tsconfig.json ./tsconfig.json

USER node

VOLUME ["/data", "/users", "/traces"]
STOPSIGNAL SIGTERM

CMD ["node", "--import", "tsx", "src/index.ts"]
