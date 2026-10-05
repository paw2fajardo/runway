# Multi-stage Standalone Dockerfile for LedgerFlow Next.js 15 PWA

FROM node:22-alpine AS base

# Stage 1: Dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# One-off owner password recovery image with only the CLI's runtime packages.
FROM node:22-alpine AS auth-recovery
WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_cache=/tmp/npm-cache
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 recovery
RUN npm init -y \
    && npm pkg set 'scripts.auth:reset-owner-password=tsx scripts/reset-owner-password.ts' \
    && npm install --omit=dev --no-save --package-lock=false tsx@4.23.15 drizzle-orm@0.40.1 postgres@3.4.9 dotenv@16.6.1
COPY --chown=recovery:nodejs scripts/reset-owner-password.ts ./scripts/reset-owner-password.ts
COPY --chown=recovery:nodejs src/db/index.ts ./src/db/index.ts
COPY --chown=recovery:nodejs src/db/schema.ts ./src/db/schema.ts
COPY --chown=recovery:nodejs src/lib/auth/password.ts ./src/lib/auth/password.ts
USER recovery
CMD ["npm", "run", "auth:reset-owner-password"]

# Standalone payday scheduler and push delivery worker.
FROM base AS payday-worker
WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_cache=/tmp/npm-cache
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 worker
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=worker:nodejs package.json tsconfig.json ./
COPY --chown=worker:nodejs src ./src
USER worker
CMD ["npm", "run", "payday:worker"]

# Stage 2: Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Stage 3: Runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy static assets and standalone server output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
