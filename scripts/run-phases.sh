#!/usr/bin/env bash
# run-phases.sh: the headless phase loop. Runs every open phase of a feature
# in its own `claude -p "/phase <id>"` session, one after the other, and
# stops on the first phase that reports BLOCKED, exits non-zero, ends with a
# non-success result, leaves its tasks open, or pushes the spent total past
# the cap. `scripts/run-phases.ps1` is the same loop for a PowerShell terminal.
#
# Run it from a plain terminal, not from inside a Claude Code session.
#
# Usage: scripts/run-phases.sh [--feature=<slug>] [--dry-run] [--budget=<usd>]
#                              [--max-turns=<n>] [--total=<usd>] [--model=<name>]
#   --feature=<slug>  the feature under specs/features/<slug>/; default: the
#                     active feature (last /phase or /feature prompt, else the
#                     newest tracked tasks.md with an open task)
#   --dry-run         list the open phases and the command for each, run nothing
#   --budget=<usd>    per-phase cap passed as --max-budget-usd, default 20
#   --max-turns=<n>   per-phase cap passed as --max-turns, default 250
#   --total=<usd>     stop once the spent total leaves no room for one more
#                     phase, or a result carries no cost; default 0, no cap
#   --model=<name>    passed through as --model to every phase session
#
# Env: RUN_PHASES_LOG_DIR, where each result JSON lands, default
# dist/.claude/run-phases. CLAUDE_PROJECT_DIR and ACTIVE_PHASE_STATE_DIR are
# honoured the way the hooks honour them.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../.claude/hooks/lib/active-phase.sh
. "$SCRIPT_DIR/../.claude/hooks/lib/active-phase.sh"

FEATURE=""
DRY_RUN=0
BUDGET=20
MAX_TURNS=250
TOTAL=0
MODEL=""
for arg in "$@"; do
  case "$arg" in
    --feature=*) FEATURE="${arg#--feature=}" ;;
    --dry-run) DRY_RUN=1 ;;
    --budget=*) BUDGET="${arg#--budget=}" ;;
    --max-turns=*) MAX_TURNS="${arg#--max-turns=}" ;;
    --total=*) TOTAL="${arg#--total=}" ;;
    --model=*) MODEL="${arg#--model=}" ;;
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "run-phases: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# The three amounts reach the claude command line and an awk compare, so each
# is a non-negative integer or decimal or the run stops here.
for pair in "--budget=$BUDGET" "--max-turns=$MAX_TURNS" "--total=$TOTAL"; do
  case "${pair#*=}" in
    ''|*[!0-9.]*|*.*.*|.)
      echo "run-phases: ${pair%%=*} must be a non-negative number, got '${pair#*=}'" >&2
      exit 2
      ;;
  esac
done

# The open phase ids are word-split from one string below. Globbing is off so
# a stray `*` or `?` never expands against the cwd; the id validation also
# rejects those characters, this is the second fence.
set -f

REPO_ROOT="$AP_REPO_ROOT"
LOG_DIR="${RUN_PHASES_LOG_DIR:-$REPO_ROOT/dist/.claude/run-phases}"

# 1. Which feature.
if [ -n "$FEATURE" ]; then
  # The slug becomes a path, so it is validated before it is joined, and the
  # tasks file must be tracked so a scratch copy never drives a paid loop.
  if ! ap_is_slug "$FEATURE"; then
    echo "run-phases: invalid feature slug '$FEATURE'" >&2
    exit 2
  fi
  TASKS_FILE="specs/features/$FEATURE/tasks.md"
  if [ ! -f "$REPO_ROOT/$TASKS_FILE" ]; then
    echo "run-phases: no tasks file at $TASKS_FILE" >&2
    exit 2
  fi
  if ! ap_is_tracked "$TASKS_FILE"; then
    echo "run-phases: $TASKS_FILE is not tracked" >&2
    exit 2
  fi
elif active_phase_resolve; then
  FEATURE="$ACTIVE_FEATURE"
  TASKS_FILE="$ACTIVE_TASKS_FILE"
else
  echo "run-phases: no active feature; pass --feature=<slug>" >&2
  exit 2
fi
echo "run-phases: feature $FEATURE ($TASKS_FILE)"

# 2. Open phases, in file order. A phase is open while its section holds an
#    unticked task line.
open_phases() {
  awk '
    /^## / {
      if (id != "" && open) print id
      id = ""; open = 0
      if ($2 == "Phase") { id = $3; sub(/:$/, "", id) }
      next
    }
    id != "" && index($0, "- [ ] ") == 1 { open = 1 }
    END { if (id != "" && open) print id }
  ' "$REPO_ROOT/$TASKS_FILE"
}

PHASES=$(open_phases | tr '\n' ' ' | sed 's/ $//')
# An id lands in a grep pattern, a log file name and the claude prompt, so it
# is a plain token, never dots only or with a `..` in it, or the run stops
# before any session starts.
for id in $PHASES; do
  case "$id" in
    *[!A-Za-z0-9._-]*|.|*..*)
      echo "run-phases: invalid phase id '$id' in $TASKS_FILE" >&2
      exit 1
      ;;
  esac
done
if [ -z "$PHASES" ]; then
  echo "run-phases: no open phase in $TASKS_FILE"
  exit 0
fi
echo "run-phases: open phases: $PHASES"

# An array, so a value with a space (a model name, a budget) stays one
# argument instead of splitting on whitespace.
PHASE_FLAGS=(--max-turns "$MAX_TURNS" --max-budget-usd "$BUDGET" --output-format json --permission-mode bypassPermissions)
[ -n "$MODEL" ] && PHASE_FLAGS+=(--model "$MODEL")

if [ "$DRY_RUN" = 1 ]; then
  for id in $PHASES; do
    echo "claude -p \"/phase $id\" ${PHASE_FLAGS[*]}"
  done
  exit 0
fi

# json_field <file> <key>: one top-level string or number field of the result
# object, or nothing.
json_field() {
  node -e '
    const fs = require("fs");
    let v;
    try { v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]]; } catch { process.exit(0); }
    if (v === undefined || v === null) process.exit(0);
    process.stdout.write(String(v));
  ' "$1" "$2"
}

stop() {
  echo "run-phases: stopped at $1: $2"
  exit 1
}

mkdir -p "$LOG_DIR"

# 3. Smoke check: the CLI answers and the key is valid. --bare skips the
#    project instructions and hooks, so this costs almost nothing.
SMOKE="$LOG_DIR/smoke.json"
if ! claude -p "Reply with the single word READY." --bare --output-format json --max-turns 1 > "$SMOKE" 2> "$LOG_DIR/smoke.stderr" < /dev/null; then
  cat "$LOG_DIR/smoke.stderr" >&2
  echo "run-phases: stopped before the first phase: the smoke check failed (see $SMOKE)"
  exit 1
fi
if [ "$(json_field "$SMOKE" subtype)" != "success" ]; then
  echo "run-phases: stopped before the first phase: the smoke check ended with subtype $(json_field "$SMOKE" subtype) (see $SMOKE)"
  exit 1
fi

# 4. The loop.
SPENT=0
COUNT=0
for id in $PHASES; do
  OUT="$LOG_DIR/$id.json"
  ERR="$LOG_DIR/$id.stderr"
  echo "run-phases: phase $id started $(date '+%Y-%m-%d %H:%M:%S')"
  claude -p "/phase $id" "${PHASE_FLAGS[@]}" > "$OUT" 2> "$ERR" < /dev/null
  rc=$?
  [ -s "$ERR" ] && cat "$ERR" >&2
  if [ "$rc" -ne 0 ]; then
    stop "$id" "the session exited with code $rc (see $OUT and $ERR)"
  fi

  subtype=$(json_field "$OUT" subtype)
  result=$(json_field "$OUT" result)
  cost=$(json_field "$OUT" total_cost_usd)
  # A result without a cost cannot be added to the total. Under a cap that is
  # a stop, not a free phase; without a cap it counts as zero.
  if [ -z "$cost" ] && [ "$TOTAL" != 0 ]; then
    stop "$id" "the result carries no total_cost_usd, so the --total cap cannot be checked (see $OUT)"
  fi
  [ -n "$cost" ] || cost=0
  SPENT=$(a="$SPENT" b="$cost" awk 'BEGIN { print ENVIRON["a"] + ENVIRON["b"] }')
  COUNT=$((COUNT + 1))
  echo "run-phases: phase $id finished $(date '+%Y-%m-%d %H:%M:%S'), subtype $subtype, cost $cost, spent $SPENT"

  if [ "$subtype" != "success" ] || [ "$(json_field "$OUT" is_error)" = "true" ]; then
    stop "$id" "the session ended with subtype $subtype (see $OUT)"
  fi
  if printf '%s' "$result" | grep -qF -- "Phase $id - BLOCKED"; then
    stop "$id" "the phase reported BLOCKED (see $OUT)"
  fi
  if [ -n "$(ap_heading_for_id "$REPO_ROOT/$TASKS_FILE" "$id")" ]; then
    stop "$id" "the phase ended but left tasks open in $TASKS_FILE"
  fi
  if [ "$TOTAL" != 0 ] && s="$SPENT" c="$cost" t="$TOTAL" awk 'BEGIN { exit !(ENVIRON["s"] >= ENVIRON["t"] || ENVIRON["s"] + ENVIRON["c"] > ENVIRON["t"]) }'; then
    stop "$id" "spent $SPENT of the total $TOTAL, no room for another phase"
  fi
done

echo "run-phases: done, $COUNT phases"
