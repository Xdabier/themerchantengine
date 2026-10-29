#!/usr/bin/env bash
# Boots the demo API and wipes the demo data every night at 03:00 UTC.
set -uo pipefail
cd /app

: "${DATABASE_URL:?Set DATABASE_URL as a Render secret (Neon direct URL, pooling off)}"

API_URL="${DEMO_API_URL:-${RENDER_EXTERNAL_URL:-https://themerchantengine-demo-api.onrender.com}}"
STORE_CONFIG=/tmp/demo-store.config.json
# The scenario fixture wraps the store config in a "fixture" key the strict schema rejects.
node -e "const c=require('/app/test/fixtures/store-configs/demo.config.json');delete c.fixture;require('fs').writeFileSync(process.argv[1],JSON.stringify(c))" "$STORE_CONFIG"

rand() { node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))"; }

export NODE_ENV=production PORT="${PORT:-10000}" API_GLOBAL_PREFIX=api LOG_LEVEL=info
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(rand)}"
export UNSUBSCRIBE_TOKEN_SECRET="${UNSUBSCRIBE_TOKEN_SECRET:-$(rand)}"
export SIGNED_URL_SECRET="${SIGNED_URL_SECRET:-$(rand)}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-https://demo.themerchantengine.com}"
export CORS_ORIGIN="${CORS_ORIGIN:-https://demo.themerchantengine.com,https://demo-admin.themerchantengine.com}"
export STOREFRONT_PUBLIC_BASE_URL="${STOREFRONT_PUBLIC_BASE_URL:-https://demo.themerchantengine.com}"
export ADMIN_PUBLIC_BASE_URL="${ADMIN_PUBLIC_BASE_URL:-https://demo-admin.themerchantengine.com}"
export API_PUBLIC_BASE_URL="$API_URL"
export UPLOADS_ROOT=uploads PRIVATE_UPLOADS_DIR=uploads-private
# Neon object storage when its keys are set as Render secrets, local disk otherwise.
if [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ]; then
  export STORAGE_DRIVER=s3 S3_REGION="${S3_REGION:-us-east-2}" S3_BUCKET="${S3_BUCKET:-demo-assets}"
  export S3_ENDPOINT="${S3_ENDPOINT:-https://br-lively-darkness-b5mes70m.storage.c-7.us-east-2.aws.neon.tech}"
  export S3_PUBLIC_URL="${S3_PUBLIC_URL:-$S3_ENDPOINT/$S3_BUCKET}" S3_FORCE_PATH_STYLE=true
else
  export STORAGE_DRIVER=local UPLOADS_BASE_URL="$API_URL/uploads"
fi
export MAIL_TRANSPORT=console GSC_SUBMISSION_ENABLED=false
# Production refuses to boot without a mail identity. The console transport sends nothing.
export RESEND_FROM_EMAIL=noreply@themerchantengine.com RESEND_FROM_NAME="The Merchant Engine Demo"
export RESEND_REPLY_TO=noreply@themerchantengine.com CONTACT_FORM_RECIPIENT=noreply@themerchantengine.com
# Visitors can register a customer account without an inbox.
export AUTH_SKIP_EMAIL_VERIFICATION=1
export TS_NODE_TRANSPILE_ONLY=true

DEMO_ADMIN_EMAIL="${DEMO_ADMIN_EMAIL:-demo@themerchantengine.com}"
DEMO_ADMIN_PASSWORD="${DEMO_ADMIN_PASSWORD:-demo-admin-2026}"

redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --save "" --appendonly no --dir /tmp

reseed() (
  # Lowest CPU priority, so the port keeper answers the Render health check in time.
  renice -n 19 -p $BASHPID >/dev/null
  # 512 MB RAM: one node process at a time (no npx chains), a capped heap, and a lean sharp.
  export NODE_OPTIONS=--max-old-space-size=256 MALLOC_ARENA_MAX=2 VIPS_CONCURRENCY=1 UV_THREADPOOL_SIZE=1
  ts() { node -r ts-node/register/transpile-only "$@"; }
  echo "[demo] reseed start $(date -u +%FT%TZ)"
  rm -rf uploads/* uploads-private/*
  redis-cli -p 6379 FLUSHALL >/dev/null
  node_modules/.bin/prisma db push --force-reset --accept-data-loss &&
  ts prisma/apply-fts-setup.ts &&
  ts prisma/apply-notification-indexes.ts &&
  ts prisma/apply-shipping-indexes.ts &&
  SEED_SCOPE=notifications-rbac STORE_CONFIG_FILE="$STORE_CONFIG" SEED_SHIPPING_FLAT_RATE=5 ts prisma/seed.ts &&
  SEED_DEV_OK=1 FIXTURE_CATALOGUE_SEED=1 STORE_CONFIG_FILE="$STORE_CONFIG" ts prisma/seed.ts &&
  node /usr/local/bin/scramble-seeded-logins.js &&
  ADMIN_EMAIL="$DEMO_ADMIN_EMAIL" ADMIN_PASSWORD="$DEMO_ADMIN_PASSWORD" \
    ADMIN_FIRST_NAME=Demo ADMIN_LAST_NAME=Admin ADMIN_LOCALE=en \
    ts apps/api/scripts/create-admin.ts --from-env
)

seconds_until_reset() {
  local now next
  now=$(date -u +%s)
  next=$(date -u -d 'today 03:00' +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d 'tomorrow 03:00' +%s)
  echo $((next - now))
}

# Render restarts the container, and so reseeds again, when the port is closed for a moment.
# The port keeper holds it from boot on, and the API listens on an internal port behind it.
export API_INTERNAL_PORT=$((PORT + 1))
(
  while true; do
    node --max-old-space-size=32 /usr/local/bin/port-keeper.js
    echo "[demo] port keeper exited $?, restart"
    sleep 1
  done
) &

while true; do
  until reseed; do
    echo "[demo] reseed failed, retry in 60s"
    sleep 60
  done
  # Restart a crashed API without wiping, until the nightly reset is due.
  while true; do
    PORT="$API_INTERNAL_PORT" timeout "$(seconds_until_reset)" node dist/apps/api/main.js
    code=$?
    [ "$code" -eq 124 ] && break
    echo "[demo] api exited $code, restart in 30s"
    sleep 30
  done
done
