# ── Base: pnpm workspace ─────────────────────────────────────────────
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./

COPY apps/monitor/package.json              apps/monitor/
COPY packages/core/package.json             packages/core/
COPY packages/database/package.json         packages/database/
COPY packages/analyzer/package.json         packages/analyzer/
COPY packages/notifier/package.json         packages/notifier/
COPY packages/scraper/package.json          packages/scraper/

RUN pnpm install --frozen-lockfile

COPY apps/monitor/src          apps/monitor/src/
COPY apps/monitor/tsconfig.json apps/monitor/
COPY apps/monitor/tsdown.config.ts apps/monitor/
COPY packages/core/src         packages/core/src/
COPY packages/core/tsconfig.json packages/core/
COPY packages/database/src     packages/database/src/
COPY packages/database/tsconfig.json packages/database/
COPY packages/analyzer/src     packages/analyzer/src/
COPY packages/analyzer/tsconfig.json packages/analyzer/
COPY packages/notifier/src     packages/notifier/src/
COPY packages/notifier/tsconfig.json packages/notifier/
COPY packages/scraper/src      packages/scraper/src/
COPY packages/scraper/tsconfig.json packages/scraper/

# ── Monitor builder ───────────────────────────────────────────────────
FROM base AS monitor-builder
RUN pnpm build

# ── Monitor runner ────────────────────────────────────────────────────
FROM node:22-alpine AS monitor-runner
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY --from=monitor-builder /app/apps/monitor/package.json ./apps/monitor/
COPY --from=monitor-builder /app/apps/monitor/dist ./apps/monitor/dist/

# Copy built packages
COPY --from=monitor-builder /app/packages/core/package.json ./packages/core/
COPY --from=monitor-builder /app/packages/core/dist ./packages/core/dist/
COPY --from=monitor-builder /app/packages/database/package.json ./packages/database/
COPY --from=monitor-builder /app/packages/database/dist ./packages/database/dist/
COPY --from=monitor-builder /app/packages/analyzer/package.json ./packages/analyzer/
COPY --from=monitor-builder /app/packages/analyzer/dist ./packages/analyzer/dist/
COPY --from=monitor-builder /app/packages/notifier/package.json ./packages/notifier/
COPY --from=monitor-builder /app/packages/notifier/dist ./packages/notifier/dist/
COPY --from=monitor-builder /app/packages/scraper/package.json ./packages/scraper/
COPY --from=monitor-builder /app/packages/scraper/dist ./packages/scraper/dist/

RUN pnpm install --prod --frozen-lockfile

ENV NODE_ENV=production
CMD ["node", "--max-old-space-size=512", "apps/monitor/dist/index.js"]
