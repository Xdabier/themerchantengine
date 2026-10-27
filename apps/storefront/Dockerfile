# syntax=docker/dockerfile:1.7
# ────────────────────────────────────────────────────────────────────────────
# merchants-engine Storefront (Analog SSR / Nitro), production image
# Build context: repo root.  Build:
#   docker build -f apps/storefront/Dockerfile -t merchants-engine/storefront:<tag> .
# ────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=22-bookworm-slim

# ── Stage 1: deps ─────────────────────────────────────────────────────────
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

# ── Stage 2: build (storefront via nx → analog/Nitro server bundle) ──────
FROM deps AS build
WORKDIR /app
# Vite SSR + Nitro Server bundling crosses the Node default 2 GB heap on
# a small CI runner during the "Building Server..." rollup phase
# (vendor-angular SSR chunk hits 1.3 MB and rollup's tree-shaking + symbol
# table push the heap past 2 GB). Bump to 4 GB to match the unit-tests CI
# job's heap setting.
ENV NODE_OPTIONS=--max-old-space-size=4096
# Cloudflare Turnstile public site key (2026-06-23). Vite inlines
# `import.meta.env.VITE_TURNSTILE_SITE_KEY` at build time, so it must be present
# here. It is PUBLIC (safe to bake). Empty default → the register form's captcha
# widget stays inert, matching the API captcha plugin (gated on TURNSTILE_SECRET).
# Activate prod by passing --build-arg VITE_TURNSTILE_SITE_KEY=... (CI sources it
# from apps/storefront/.env.production) AND setting TURNSTILE_SECRET on the API.
ARG VITE_TURNSTILE_SITE_KEY=""
ENV VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY}
COPY tsconfig.base.json tsconfig.json nx.json prisma.config.ts ./
COPY prisma ./prisma
COPY apps/storefront ./apps/storefront
COPY libs ./libs
# libs/shared/common imports @prisma/client, whose types exist only once the
# client is generated; on a developer machine that happened long ago, in a
# fresh image it has not. The first local install found this build red.
RUN npx prisma generate
RUN npx nx build storefront --configuration=production

# ── Stage 3: runtime — Nitro server entry only, no node_modules needed ───
# Nitro bundles all deps into the server output. Image stays slim (~120 MB).
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=54300 \
    HOST=0.0.0.0 \
    NITRO_PORT=54300 \
    NITRO_HOST=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r app && useradd -r -g app -d /app app

COPY --from=build /app/dist/apps/storefront/analog ./analog
COPY --from=build /app/dist/apps/storefront/client ./public
RUN chown -R app:app /app
USER app

EXPOSE 54300
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:54300/ || exit 1

CMD ["node", "analog/server/index.mjs"]
