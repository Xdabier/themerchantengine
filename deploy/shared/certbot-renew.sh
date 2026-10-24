#!/usr/bin/env bash
# Renew Let's Encrypt certificates for the local stack and reload edge nginx.
#
# Installed as a systemd timer by deploy/shared/install-cert-renew-timer.sh.
#   run now:   sudo systemctl start themerchantengine-cert-renew.service
#   logs:      journalctl -u themerchantengine-cert-renew.service
#   schedule:  systemctl list-timers themerchantengine-cert-renew.timer
#
# Detects which rendered stack runs here (engine, both or storefront profile)
# by which one currently has a running edge nginx. ENV_FILE, set by the unit,
# names the env file compose interpolates; the profile default is used when it
# is not set.
#
# The last step re-reads the certificate nginx actually serves over TLS and
# fails the unit if anything sits inside MIN_DAYS of expiry. certbot exits 0
# when it decides nothing is due yet, so without this check a renewal that
# quietly stopped working still looks green right up until the cert expires.

set -euo pipefail

MIN_DAYS="${MIN_DAYS:-20}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

stack_running() {
  [[ -f $1 ]] && docker compose -f "$1" ps --status running --quiet nginx 2>/dev/null | grep -q .
}

if   stack_running deploy/engine/docker-compose.yml; then
  COMPOSE_FILE=deploy/engine/docker-compose.yml
  ENV_FILE_ARG=(--env-file "${ENV_FILE:-.env.production}")
elif stack_running deploy/storefront/docker-compose.yml; then
  COMPOSE_FILE=deploy/storefront/docker-compose.yml
  ENV_FILE_ARG=(--env-file "${ENV_FILE:-apps/storefront/.env.production}")
else
  echo "No running edge nginx stack found under deploy/" >&2
  exit 1
fi

# The rendered files interpolate ${DB_PASSWORD} and ${REDIS_PASSWORD} from the
# env file the stepper wrote; without it Compose warns on every renewal.
COMPOSE=(docker compose -f "$COMPOSE_FILE" "${ENV_FILE_ARG[@]}")

# Verification list, derived from the certificates this box actually holds
# rather than a hardcoded array.
#
# `certbot renew` walks every lineage in the store, so a fixed array could
# renew a certificate and then never verify it: the unit would report green
# right up until that certificate expires, which is the failure mode this
# check exists to prevent.
#
# Fail closed: an empty list means the store could not be read, not that there
# is nothing to check.
# Match both spellings: certbot renamed this field from `Domains:` to
# `Identifiers:`. Accepting only one would make an image bump silently empty
# the list, and an empty list is the failure this whole block exists to avoid.
mapfile -t HOSTS < <(
  "${COMPOSE[@]}" --profile tools run --rm -T certbot certificates 2>/dev/null \
    | awk -F': *' '/^ *(Domains|Identifiers):/ { n = split($2, a, " "); for (i = 1; i <= n; i++) print a[i] }' \
    | sort -u
)

if (( ${#HOSTS[@]} == 0 )); then
  echo "Could not enumerate any certificate lineage from the certbot store" >&2
  exit 1
fi

echo "[$(date -Is)] Renewing certs via $COMPOSE_FILE"

# The --webroot flags are belt-and-braces. Both renewal configs already record
# `authenticator = webroot`, but passing them keeps this run working even if a
# certificate is ever re-issued under a different authenticator. Standalone
# renewal cannot work here at all: edge nginx owns port 80.
"${COMPOSE[@]}" --profile tools run --rm certbot renew \
  --webroot --webroot-path=/var/www/certbot \
  --no-random-sleep-on-renew

# Reload edge nginx so the new chain is served.
"${COMPOSE[@]}" exec -T nginx nginx -s reload || "${COMPOSE[@]}" restart nginx

echo "[$(date -Is)] Verifying served certificates (floor ${MIN_DAYS}d)"
rc=0
for host in "${HOSTS[@]}"; do
  pem=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$host" 2>/dev/null \
        | openssl x509 2>/dev/null) || true

  if [[ -z $pem ]]; then
    echo "  FAIL $host: no certificate served" >&2
    rc=1
    continue
  fi

  end=$(printf '%s' "$pem" | openssl x509 -noout -enddate | cut -d= -f2)
  if printf '%s' "$pem" | openssl x509 -noout -checkend $(( MIN_DAYS * 86400 )) >/dev/null; then
    echo "  OK   $host expires $end"
  else
    echo "  FAIL $host expires $end, inside ${MIN_DAYS}d floor" >&2
    rc=1
  fi
done

if [[ $rc -ne 0 ]]; then
  echo "[$(date -Is)] Certificate check FAILED" >&2
  exit 1
fi

echo "[$(date -Is)] Renewal check complete"
