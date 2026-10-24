#!/usr/bin/env bash
# themerchantengine install (plan E4.1). Linux and macOS.
#
#   ./setup.sh                      interactive, asks the profile
#   ./setup.sh --profile engine     one of engine | storefront | both | local
#   ./setup.sh --local              the local profile
#   ./setup.sh --answers ci.json    non-interactive, for CI and automation
#   ./setup.sh --dry-run            print every file and command, run nothing
#
# Checks the prerequisites the plan names, one clear instruction per missing
# one, builds the stepper bundle when it is missing or stale, and runs it.
# Everything after the prerequisites lives in tools/setup; this file stays a
# thin wrapper so the checks are the same on every shell.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

fail() {
  printf '\n%s\n' "setup: $1" >&2
  printf '%s\n' "  $2" >&2
  exit 1
}

# ── prerequisites ─────────────────────────────────────────────────────────
[[ -f .nvmrc ]] || fail "This checkout has no .nvmrc, so the Node version it needs is unknown." "Run setup from a complete clone of the engine repository."
WANT_MAJOR="$(tr -d 'v[:space:]' < .nvmrc | cut -d. -f1)"

command -v git >/dev/null 2>&1 || fail "git is not installed." "Install git (apt install git / brew install git) and run ./setup.sh again."

command -v docker >/dev/null 2>&1 || fail "Docker is not installed." "Install Docker Engine (https://docs.docker.com/engine/install/) and run ./setup.sh again."
docker info >/dev/null 2>&1 || fail "Docker is installed but not reachable." "Start the Docker daemon, and make sure your user is in the docker group (log out and in after adding it)."

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not installed." "Install the docker-compose-plugin package (https://docs.docker.com/compose/install/linux/) and run ./setup.sh again."

command -v node >/dev/null 2>&1 || fail "Node.js is not installed." "Install Node $WANT_MAJOR (https://nodejs.org or nvm) and run ./setup.sh again."
HAVE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$HAVE_MAJOR" == "$WANT_MAJOR" ]] || fail "Node $HAVE_MAJOR is installed but the engine needs Node $WANT_MAJOR." "Install Node $WANT_MAJOR (nvm install $WANT_MAJOR) and run ./setup.sh again."

# ── free ports for the profile ────────────────────────────────────────────
# A re-run on an installed box finds this project's own edge on the ports;
# that is the expected state, not a conflict, so the check is skipped when a
# container of this project is already running.
PROFILE=""
for ((i = 1; i <= $#; i++)); do
  arg="${!i}"
  case "$arg" in
    --local) PROFILE="local" ;;
    --profile) j=$((i + 1)); PROFILE="${!j:-}" ;;
    --profile=*) PROFILE="${arg#--profile=}" ;;
  esac
done
own_stack_running() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^themerchantengine-'
}
port_free() {
  if command -v ss >/dev/null 2>&1; then ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  elif command -v lsof >/dev/null 2>&1; then ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else echo "setup: neither ss nor lsof is installed; port $1 was not checked"; return 0
  fi
}
check_ports() {
  if own_stack_running; then
    echo "setup: this project's containers are running; the port check is skipped for a re-run"
    return 0
  fi
  for port in "$@"; do
    port_free "$port" || fail "Port $port is in use." "Stop whatever listens on $port (ss -ltnp | grep $port) and run ./setup.sh again."
  done
}
case "$PROFILE" in
  local) check_ports 53000 53200 53300 ;;
  engine|storefront|both) check_ports 80 443 ;;
  "") ;;
  *) fail "Unknown profile $PROFILE." "Use one of engine, storefront, both, local." ;;
esac

# ── the stepper bundle ────────────────────────────────────────────────────
BUNDLE="tools/setup/dist/index.js"
stale() {
  [[ ! -f "$BUNDLE" ]] && return 0
  [[ -n "$(find tools/setup/src tools/setup/build.mjs libs/shared/common/src -newer "$BUNDLE" -type f -print -quit 2>/dev/null)" ]]
}
if stale; then
  echo "setup: building the stepper"
  if [[ ! -d node_modules/esbuild && ! -d tools/setup/node_modules/esbuild ]]; then
    # A fresh clone: the stepper's own small install from its own lockfile,
    # not the workspace one.
    (cd tools/setup && npm ci --no-audit --no-fund --loglevel=error) \
      || fail "The stepper's dependencies did not install." "Check the network, then run ./setup.sh again."
  fi
  node tools/setup/build.mjs || fail "The stepper did not build." "Read the error above and run ./setup.sh again."
fi

exec node "$BUNDLE" "$@"
