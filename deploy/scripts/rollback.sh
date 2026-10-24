#!/usr/bin/env bash
# Roll the application containers back to an earlier commit or tag.
#
#   bash deploy/scripts/rollback.sh <git-ref>
#   bash deploy/scripts/rollback.sh v1.0.0
#
# The installer builds the images on this box from the checkout, so rolling
# back means checking the older tree out and building again. Only the
# application services are rebuilt and restarted: Postgres, Redis and the edge
# keep running, and the schema is not touched. A release that changed the
# schema needs the operator manual's rollback section, not this script.
#
# ROLLBACK_DRY_RUN=1 prints every command and runs nothing.

set -euo pipefail

REF="${1:-}"
if [[ -z "$REF" ]]; then
  echo "usage: $0 <git-ref>" >&2
  echo "  <git-ref> is the commit or tag to return to, for example v1.0.0" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# The rendered stack of the profile installed on this box. An operator can name
# it; otherwise the first rendered compose file with a running edge wins.
COMPOSE_FILE="${ROLLBACK_COMPOSE_FILE:-}"
ENV_FILE="${ROLLBACK_ENV_FILE:-}"
if [[ -z "$COMPOSE_FILE" ]]; then
  for candidate in deploy/engine/docker-compose.yml deploy/storefront/docker-compose.yml deploy/local/docker-compose.yml; do
    if [[ -f "$candidate" ]] && docker compose -f "$candidate" ps --status running --quiet nginx 2>/dev/null | grep -q .; then
      COMPOSE_FILE="$candidate"
      break
    fi
  done
fi
[[ -n "$COMPOSE_FILE" ]] || { echo "No running rendered stack found under deploy/; nothing to roll back." >&2; exit 1; }
if [[ -z "$ENV_FILE" ]]; then
  case "$COMPOSE_FILE" in
    deploy/engine/*)     ENV_FILE=.env.production ;;
    deploy/storefront/*) ENV_FILE=apps/storefront/.env.production ;;
    deploy/local/*)      ENV_FILE=deploy/local/.env ;;
  esac
fi

# Which application services this stack runs: the keys of its `services:`
# block, intersected with the three application names. The block is read
# rather than the whole file so a volume or network of the same name cannot
# be mistaken for a service.
mapfile -t DECLARED < <(awk '/^services:/ {in_block=1; next} /^[^ ]/ {in_block=0} in_block && /^  [a-z-]+:/ {sub(/^  /, ""); sub(/:.*/, ""); print}' "$COMPOSE_FILE")
SERVICES=()
for service in api admin storefront; do
  for declared in "${DECLARED[@]}"; do
    [[ "$declared" == "$service" ]] && SERVICES+=("$service")
  done
done
[[ ${#SERVICES[@]} -gt 0 ]] || { echo "$COMPOSE_FILE declares no application service." >&2; exit 1; }

run() {
  echo "+ $*"
  [[ ${ROLLBACK_DRY_RUN:-0} == 1 ]] || "$@"
}

# The ref is resolved to a commit before anything moves, so a ref that does
# not exist fails here and a ref shaped like an option is never parsed as one.
if [[ ${ROLLBACK_DRY_RUN:-0} == 1 ]]; then
  SHA="$REF"
else
  SHA="$(git rev-parse --verify --end-of-options "${REF}^{commit}")" || { echo "$REF is not a commit or tag in this checkout; run git fetch --tags origin first." >&2; exit 1; }
fi

# A hand-edited tracked file would either stop the checkout half way or ride
# into the older tree; refuse before anything moves.
if [[ ${ROLLBACK_DRY_RUN:-0} != 1 && -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "The checkout has uncommitted changes to tracked files; commit or stash them before rolling back." >&2
  exit 1
fi

echo "Rolling ${SERVICES[*]} back to $REF using $COMPOSE_FILE"
run git fetch --tags origin
run git checkout --detach "$SHA"
run docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build "${SERVICES[@]}"
run docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps "${SERVICES[@]}"
run docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
echo "Done. Run ./setup.sh again if a later release changed the rendered stack or the schema."
