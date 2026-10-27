#!/usr/bin/env bash
# stack-check.sh: the phase preflight as code. Checks the docker containers,
# the API health endpoint and the admin dev server, starts whatever is down,
# waits for it, and exits non-zero when a service never answers.
#
# Usage: scripts/stack-check.sh [--check-only]
#   --check-only   report what is up and down, start nothing, exit 1 on any down
#
# Env knobs (defaults are the ports in CLAUDE.md):
#   STACK_CHECK_API_URL    default http://localhost:53000/health
#   STACK_CHECK_ADMIN_URL  default http://localhost:53200
#   STACK_CHECK_LOG_DIR    where the serve logs go, default dist/.claude/stack;
#                          local only, under the gitignored dist/, never committed
#   STACK_CHECK_TIMEOUT    seconds to wait for a started service, default 180
#   STACK_CHECK_INTERVAL   poll interval in seconds, default 3

set -uo pipefail

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "stack-check: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="${STACK_CHECK_API_URL:-http://localhost:53000/health}"
ADMIN_URL="${STACK_CHECK_ADMIN_URL:-http://localhost:53200}"
LOG_DIR="${STACK_CHECK_LOG_DIR:-$REPO_ROOT/dist/.claude/stack}"
TIMEOUT="${STACK_CHECK_TIMEOUT:-180}"
INTERVAL="${STACK_CHECK_INTERVAL:-3}"
# Both feed shell arithmetic, which evaluates whatever it is handed.
case "$TIMEOUT$INTERVAL" in
  *[!0-9]*)
    echo "stack-check: STACK_CHECK_TIMEOUT and STACK_CHECK_INTERVAL must be whole seconds" >&2
    exit 2
    ;;
esac
# Every service in docker-compose.yml carries a healthcheck, so "up" means
# healthy, not merely running. Names come from container_name in the compose.
CONTAINERS="merchants-engine-postgres-dev merchants-engine-postgres-test merchants-engine-redis-dev merchants-engine-redis-test"

FAILED=0
DOWN=0

docker_healthy() {
  local healthy c
  healthy=$(docker ps --filter health=healthy --format '{{.Names}}' 2>/dev/null) || return 1
  for c in $CONTAINERS; do
    echo "$healthy" | grep -qx "$c" || return 1
  done
}

api_up() { curl -fsS -o /dev/null --max-time 5 "$API_URL"; }
admin_up() { curl -fsS -o /dev/null --max-time 5 "$ADMIN_URL"; }

# wait_for <name> <probe> <hint>: poll the probe until it passes or the
# timeout runs out. Prints the verdict and records a failure.
wait_for() {
  local name="$1" probe="$2" hint="$3" waited=0
  while true; do
    if "$probe"; then
      echo "$name: up after ${waited}s"
      return 0
    fi
    if [ "$waited" -ge "$TIMEOUT" ]; then
      echo "FAILED: $name did not answer within ${TIMEOUT}s. $hint"
      FAILED=1
      return 1
    fi
    sleep "$INTERVAL"
    waited=$((waited + INTERVAL))
  done
}

# start_serve <name>: run `nx serve <name>` detached, logging to LOG_DIR.
start_serve() {
  local name="$1"
  mkdir -p "$LOG_DIR"
  echo "$name: down, starting (npx nx serve $name, log $LOG_DIR/$name-serve.log)"
  (cd "$REPO_ROOT" && nohup npx nx serve "$name" > "$LOG_DIR/$name-serve.log" 2>&1 &)
}

# 1. Docker. A daemon that does not answer stops everything: the API cannot
#    boot without Postgres and Redis, so starting it would only add noise.
if ! docker ps -q > /dev/null 2>&1; then
  echo "FAILED: docker daemon not reachable. Start Docker Desktop, then rerun."
  exit 1
fi

if docker_healthy; then
  echo "docker: ok (postgres + redis healthy)"
elif [ "$CHECK_ONLY" = 1 ]; then
  echo "docker: down (a compose container is missing or unhealthy)"
  DOWN=1
else
  echo "docker: down, starting (npm run docker:up)"
  (cd "$REPO_ROOT" && npm run docker:up > /dev/null)
  wait_for docker docker_healthy "Run: docker ps; docker compose logs" || true
fi

# 2. API and admin. Both are checked first so a single pass starts every
#    missing service in parallel, then waits for each in turn.
NEED_API=0
NEED_ADMIN=0
if api_up; then echo "api: ok ($API_URL)"; else NEED_API=1; fi
if admin_up; then echo "admin: ok ($ADMIN_URL)"; else NEED_ADMIN=1; fi

if [ "$CHECK_ONLY" = 1 ]; then
  [ "$NEED_API" = 1 ] && { echo "api: down ($API_URL)"; DOWN=1; }
  [ "$NEED_ADMIN" = 1 ] && { echo "admin: down ($ADMIN_URL)"; DOWN=1; }
  exit "$DOWN"
fi

if [ "$FAILED" = 0 ]; then
  [ "$NEED_API" = 1 ] && start_serve api
  [ "$NEED_ADMIN" = 1 ] && start_serve admin
  [ "$NEED_API" = 1 ] && { wait_for api api_up "See $LOG_DIR/api-serve.log" || true; }
  [ "$NEED_ADMIN" = 1 ] && { wait_for admin admin_up "See $LOG_DIR/admin-serve.log" || true; }
fi

if [ "$FAILED" = 1 ]; then
  echo "stack-check: FAILED"
  exit 1
fi
echo "stack-check: all up"
