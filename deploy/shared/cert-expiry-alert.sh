#!/usr/bin/env bash
# Alert on TLS certificates close to expiry, or on a failed renewal run.
#
# Probes every public host of the store over TLS from outside the container
# network, so the engine box sees the storefront box's certificate exactly as a
# browser does. A storefront-only box has no mail transport of its own and is
# covered by this sweep.
#
# Runs three ways:
#   themerchantengine-cert-alert.timer   daily sweep, mails only when something is wrong
#   OnFailure= on the renewal unit       immediate mail, naming the failed unit
#   cert-expiry-alert.sh --hosts         print the hosts the sweep would probe, exit
#
# Let's Encrypt cannot do this for us. It ended expiration notification emails
# on 2025-06-04 and no longer stores an account contact address at all, so the
# ACME account is not a safety net. See docs/site/operate/tls-and-renewal.md.
#
# Reads from the engine env file the installer wrote:
#   STOREFRONT_PUBLIC_BASE_URL, ADMIN_PUBLIC_BASE_URL, API_PUBLIC_BASE_URL   the hosts
#   RESEND_API_KEY, RESEND_FROM_EMAIL                                         the transport
#   CERT_ALERT_TO, else CONTACT_FORM_RECIPIENT                                the recipient
# DRY_RUN=1 prints the mail and sends nothing.

set -uo pipefail

SHARED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ALERT_DAYS="${ALERT_DAYS:-21}"
ENV_FILE="${ENV_FILE:-$(cd "$SHARED_DIR/../.." && pwd)/.env.production}"
# Seconds a single TLS probe may take before it counts as "no certificate".
PROBE_TIMEOUT="${ALERT_HOSTS_TIMEOUT:-10}"

# Parse, never source: an env value with an unquoted space would split into a
# stray command under `source`. The installer writes every value double-quoted
# with backslash escapes for a quote and a backslash (tools/setup/src/output/
# env-file.ts), so the double-quoted branch undoes exactly those two.
env_get() {
  local v
  v=$(grep -m1 -E "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
  if [[ $v == \"*\" ]]; then
    v="${v#\"}"; v="${v%\"}"
    v="${v//\\\"/\"}"; v="${v//\\\\/\\}"
  elif [[ $v == \'*\' ]]; then
    v="${v#\'}"; v="${v%\'}"
  fi
  printf '%s' "$v"
}

# The host of a public base url: scheme and trailing path stripped.
host_of() {
  local u="$1"
  u="${u#*://}"
  u="${u%%/*}"
  u="${u%%:*}"
  printf '%s' "$u"
}

# --get KEY prints one parsed value, so the parser can be proven against the
# writer's escaping without touching the network, and so the timer installer
# can read a key before the host derivation below has any say.
if [[ ${1:-} == --get ]]; then
  env_get "${2:?--get needs a key}"
  echo
  exit 0
fi

# Every public host of the store, derived from the three base urls rather
# than a hand-maintained list, so a host cannot be missing from the sweep
# without also being missing from the install. Fail closed: a url the env
# file does not carry is an error, not an empty slot.
HOSTS=()
for key in STOREFRONT_PUBLIC_BASE_URL ADMIN_PUBLIC_BASE_URL API_PUBLIC_BASE_URL; do
  url="$(env_get "$key")"
  if [[ -z $url ]]; then
    echo "$key is missing from $ENV_FILE; cannot tell which hosts to sweep" >&2
    exit 1
  fi
  HOSTS+=("$(host_of "$url")")
done

if [[ ${1:-} == --hosts ]]; then
  printf '%s\n' "${HOSTS[@]}"
  exit 0
fi

REASON=""
[[ ${1:-} == --reason ]] && REASON="${2:-unspecified}"

CONTACT="$(env_get CONTACT_FORM_RECIPIENT)"
ALERT_TO="${CERT_ALERT_TO:-$(env_get CERT_ALERT_TO)}"
ALERT_TO="${ALERT_TO:-$CONTACT}"
FROM="$(env_get RESEND_FROM_EMAIL)"

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g'
}

report=""
problems=0

for host in "${HOSTS[@]}"; do
  pem=$(echo | timeout "$PROBE_TIMEOUT" openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null \
        | openssl x509 2>/dev/null)

  if [[ -z $pem ]]; then
    report+="FAIL  $host  no certificate served"$'\n'
    problems=$(( problems + 1 ))
    continue
  fi

  end=$(printf '%s' "$pem" | openssl x509 -noout -enddate | cut -d= -f2)
  if printf '%s' "$pem" | openssl x509 -noout -checkend $(( ALERT_DAYS * 86400 )) >/dev/null; then
    report+="ok    $host  expires $end"$'\n'
  else
    report+="FAIL  $host  expires $end, under ${ALERT_DAYS}d"$'\n'
    problems=$(( problems + 1 ))
  fi
done

printf '%s' "$report"

if [[ $problems -eq 0 && -z $REASON ]]; then
  echo "All certificates above the ${ALERT_DAYS}d floor. No alert sent."
  exit 0
fi

if [[ -n $REASON ]]; then
  subject="[themerchantengine] certificate renewal FAILED on $(hostname -s)"
  body="Renewal unit reported a failure: ${REASON}"$'\n'

  # Carry the failing unit's own log into the mail. Without this the alert
  # names the unit but not the cause, which turns a 30-second triage into an
  # SSH session. %i always arrives as a real unit name; a hand-passed --reason
  # that is not one is left alone rather than queried.
  if [[ $REASON == *.service ]]; then
    # Drop compose warnings, systemd's resource summary, and certbot's
    # dashed separator lines, which would otherwise eat the useful slots.
    journal=$(journalctl -u "$REASON" -n 60 --no-pager -o short-iso 2>/dev/null \
      | grep -vE 'level=warning|Consumed [0-9]|: [- ]+$' | tail -20)
    if [[ -n $journal ]]; then
      body+=$'\n'"Last log lines from ${REASON}:"$'\n'"${journal}"$'\n'
    else
      body+=$'\n'"(no journal lines available for ${REASON}; run as root to read them)"$'\n'
    fi
  fi

  body+=$'\n'"Served certificates:"$'\n'"${report}"
else
  subject="[themerchantengine] TLS certificate under ${ALERT_DAYS} days"
  body="Certificates below the ${ALERT_DAYS}-day floor:"$'\n\n'"${report}"
fi

body+=$'\n'"Box: $(hostname -f)"$'\n'"Runbook: docs/site/operate/tls-and-renewal.md (themerchantengine.com/docs/operate/tls-and-renewal/)"$'\n'
body+="  systemctl list-timers themerchantengine-cert-renew.timer"$'\n'
body+="  journalctl -u themerchantengine-cert-renew.service -n 60"$'\n'
body+="  sudo systemctl start themerchantengine-cert-renew.service"

if [[ ${DRY_RUN:-0} == 1 ]]; then
  echo "--- DRY_RUN: not sending ---"
  echo "To:      ${ALERT_TO}"
  echo "From:    ${FROM}"
  echo "Subject: ${subject}"
  echo
  printf '%s\n' "$body"
  exit 0
fi

KEY=$(env_get RESEND_API_KEY)
if [[ -z $KEY || -z $FROM ]]; then
  echo "Alert needed but RESEND_API_KEY or RESEND_FROM_EMAIL is empty in $ENV_FILE" >&2
  exit 1
fi
if [[ -z $ALERT_TO ]]; then
  echo "Alert needed but neither CERT_ALERT_TO nor CONTACT_FORM_RECIPIENT is set in $ENV_FILE" >&2
  exit 1
fi

payload=$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' \
  "$(json_escape "$FROM")" "$(json_escape "$ALERT_TO")" \
  "$(json_escape "$subject")" "$(json_escape "$body")")

resp_file=$(mktemp)
code=$(curl -sS -o "$resp_file" -w '%{http_code}' \
  -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -d "$payload" 2>/dev/null)

if [[ $code == 2* ]]; then
  echo "Alert sent to ${ALERT_TO} (HTTP ${code})"
  rm -f "$resp_file"
  exit 0
fi

# Never echo the request, it carries the bearer token.
echo "Alert send FAILED (HTTP ${code}): $(head -c 300 "$resp_file")" >&2
rm -f "$resp_file"
exit 1
