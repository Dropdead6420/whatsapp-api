# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the NexaFlow API in a npm workspaces monorepo.
# Build context: the repo root (NOT apps/api). Build with:
#   docker build -f apps/api/Dockerfile -t nexaflow-api:dev .

# -----------------------------------------------------------------------------
# deps — install workspace dependencies once, cache aggressively
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# OpenSSL is required by Prisma's query engine on Alpine.
RUN apk add --no-cache libc6-compat openssl

# Copy only manifests so npm ci can cache when source files change.
COPY package.json package-lock.json* turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/ui/package.json ./packages/ui/

# Harden npm install against flaky networks (registry hiccups, slow CI).
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# build — generate Prisma client + compile shared/db/api to dist
# -----------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

# Source for everything the API needs at build time.
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN npx prisma generate --schema packages/db/prisma/schema.prisma
RUN cd packages/shared && npx tsc
RUN cd packages/db && npx tsc
RUN cd apps/api && npx tsc

# -----------------------------------------------------------------------------
# runtime — dev/runtime image with compiled packages + API source
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV PORT=3001

# Non-root user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nexaflow

# Copy node_modules from the deps stage (includes generated Prisma client).
# In a monorepo we copy the whole node_modules tree so workspace symlinks resolve.
COPY --from=build --chown=nexaflow:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nexaflow:nodejs /app/package.json ./package.json
COPY --from=build --chown=nexaflow:nodejs /app/packages ./packages
COPY --from=build --chown=nexaflow:nodejs /app/apps/api/src ./apps/api/src
COPY --from=build --chown=nexaflow:nodejs /app/apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY --from=build --chown=nexaflow:nodejs /app/apps/api/package.json ./apps/api/package.json

USER nexaflow

EXPOSE 3001

# Basic healthcheck against the public health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3001/api/v1/health || exit 1

# The API currently uses extensionless ESM imports that are valid through
# tsx/bundler resolution but not through plain `node dist/*.js`.
CMD ["./node_modules/.bin/tsx", "apps/api/src/index.ts"]
