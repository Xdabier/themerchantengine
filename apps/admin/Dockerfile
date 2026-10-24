# syntax=docker/dockerfile:1.7
# ────────────────────────────────────────────────────────────────────────────
# merchants-engine Admin (Angular 21 SPA), production image
# Build context: repo root.  Build:
#   docker build -f apps/admin/Dockerfile -t merchants-engine/admin:<tag> .
# ────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
# Harden `npm ci` against transient registry errors with a fail-fast budget,
# as in apps/api/Dockerfile: 5 retries, a stalled request capped at 2 min.
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=60000 \
    NPM_CONFIG_FETCH_TIMEOUT=120000
COPY package.json package-lock.json .npmrc ./
# `npm ci` runs the root prepare hook; it exits 0 here, with no .git.
COPY scripts/install-git-hooks.mjs ./scripts/
RUN npm ci --include=dev --no-audit --no-fund

FROM deps AS build
WORKDIR /app
# Angular 21 production build (esbuild + Tailwind 3.4) sits close to the
# Node 2 GB heap ceiling on a small CI runner. Pre-emptively bump to 4 GB
# to match the storefront + unit-tests CI heap setting and avoid future
# OOM regressions as the bundle grows.
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY tsconfig.base.json tsconfig.json nx.json prisma.config.ts ./
COPY prisma ./prisma
COPY apps/admin ./apps/admin
COPY libs ./libs
# libs/shared/common imports @prisma/client, whose types exist only once the
# client is generated; on a developer machine that happened long ago, in a
# fresh image it has not.
RUN npx prisma generate
RUN npx nx build admin --configuration=production

# ── Runtime: nginx:alpine serving compiled SPA ────────────────────────────
FROM nginx:1.29-alpine AS runtime
RUN rm -rf /etc/nginx/conf.d/default.conf /usr/share/nginx/html/*
COPY apps/admin/nginx.conf /etc/nginx/nginx.conf
COPY apps/admin/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist/apps/admin/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
