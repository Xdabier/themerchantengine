#!/usr/bin/env bash
# Install the Let's Encrypt renewal timer on an engine or storefront box.
#
#   sudo ENV_FILE=/path/to/.env.production deploy/shared/install-cert-renew-timer.sh
#   deploy/shared/install-cert-renew-timer.sh --render-only <dir>   # write the units, touch nothing
#
# The install stepper runs this at its timers step. Idempotent: safe to re-run
# on every install.
#
# A systemd timer rather than cron: no user column to omit, state visible in
# `systemctl list-timers`, output captured by journald, and Persistent=true
# replays a window missed while the box was down. The cron form this replaced
# never ran once in 97 days because its /etc/cron.d line had no user field.

set -euo pipefail

SHARED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SHARED_DIR/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.production}"
UNITS_DIR="${UNITS_DIR:-$SHARED_DIR/systemd}"

UNITS=(
  themerchantengine-cert-renew.service
  themerchantengine-cert-renew.timer
  themerchantengine-cert-alert.service
  themerchantengine-cert-alert.timer
  'themerchantengine-cert-alert@.service'
  themerchantengine-cert-renew.service.d/10-onfailure.conf
)

# The units carry {{REPO_ROOT}} and {{ENV_FILE}} placeholders so one file
# serves every checkout location. A placeholder nothing here fills is a
# template error, not a value to install.
render_unit() {
  local rendered
  rendered="$(sed -e "s#{{REPO_ROOT}}#${REPO_ROOT}#g" -e "s#{{ENV_FILE}}#${ENV_FILE}#g" "$UNITS_DIR/$1")"
  if grep -qE '\{\{[A-Z_]+\}\}' <<<"$rendered"; then
    echo "unit $1 carries a placeholder this installer does not fill: $(grep -oE '\{\{[A-Z_]+\}\}' <<<"$rendered" | sort -u | tr '\n' ' ')" >&2
    return 1
  fi
  printf '%s\n' "$rendered"
}

if [[ ${1:-} == --render-only ]]; then
  OUT="${2:?--render-only needs a directory}"
  for unit in "${UNITS[@]}"; do
    mkdir -p "$OUT/$(dirname "$unit")"
    render_unit "$unit" > "$OUT/$unit"
  done
  exit 0
fi

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }
# A wrong path must not read as "no key here": that silence is how the
# 2026-07 expiry went unnoticed. Only a file that exists may skip alerting.
[[ -f $ENV_FILE ]] || { echo "ENV_FILE $ENV_FILE does not exist; pass the engine or storefront env file the installer wrote." >&2; exit 1; }

# A checkout can reset the mode; systemd needs the scripts readable, bash runs them.
chmod 0755 "$SHARED_DIR/certbot-renew.sh" "$SHARED_DIR/cert-expiry-alert.sh"

install_unit() {
  render_unit "$1" | install -D -m 0644 /dev/stdin "/etc/systemd/system/$1"
}

install_unit themerchantengine-cert-renew.service
install_unit themerchantengine-cert-renew.timer

# Retire the units and the cron entry an older install may have left.
rm -f /etc/cron.d/merchants-cert-renew
for old in merchants-cert-renew.timer merchants-cert-alert.timer merchants-cert-renew.service merchants-cert-alert.service; do
  systemctl disable --now "$old" >/dev/null 2>&1 || true
done
rm -rf /etc/systemd/system/merchants-cert-*

# Expiry alerting needs a mail transport. Only a box that runs the engine
# carries the Resend key, so the alert units are installed there and a
# storefront-only box keeps renewal alone. The engine sweep probes every public
# host of the store over public TLS, so the storefront certificate is covered
# from the outside either way.
rm -f /etc/systemd/system/themerchantengine-cert-renew.service.d/10-onfailure.conf

# Read through the sweep's own parser, so a quoted empty value ("") reads as
# no key rather than as a key.
if [[ -n "$(ENV_FILE="$ENV_FILE" bash "$SHARED_DIR/cert-expiry-alert.sh" --get RESEND_API_KEY 2>/dev/null)" ]]; then
  install_unit themerchantengine-cert-alert.service
  install_unit themerchantengine-cert-alert.timer
  install_unit 'themerchantengine-cert-alert@.service'
  install_unit themerchantengine-cert-renew.service.d/10-onfailure.conf
  ALERTS=yes
else
  ALERTS=no
fi

systemctl daemon-reload
systemctl enable --now themerchantengine-cert-renew.timer

if [[ $ALERTS == yes ]]; then
  systemctl enable --now themerchantengine-cert-alert.timer
fi

echo
systemctl list-timers 'themerchantengine-cert-*' --all --no-pager
echo
echo "Run them now with:"
echo "  sudo systemctl start themerchantengine-cert-renew.service"
echo "  journalctl -u themerchantengine-cert-renew.service -n 50 --no-pager"

if [[ $ALERTS == yes ]]; then
  echo "  sudo systemctl start themerchantengine-cert-alert.service"
  echo
  echo "Renewal + expiry alerting installed."
else
  echo
  echo "Renewal installed. Alerting SKIPPED: no RESEND_API_KEY in $ENV_FILE."
  echo "This box's certificate is covered by the engine box's daily sweep."
fi

# Trailing guard: never let a false test become the script's exit status.
exit 0
