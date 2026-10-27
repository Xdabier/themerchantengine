#!/usr/bin/env bash
# Reclaim disk by removing stale tagged images, keeping the N most recent per
# repository plus everything a running container references.
#
# The installer rebuilds one tag per service in place, so tagged images no
# longer accumulate on their own; this is for a box that carries older images
# from a manual build or a previous deployment, where a full disk once broke a
# deploy. `docker image prune -f` removes dangling images only, never a tag.
#
# Dry-run by default. Pass --apply to actually delete.
#
#   bash deploy/scripts/prune-images.sh                # list what would go
#   KEEP=5 bash deploy/scripts/prune-images.sh --apply
#
# Never touches volumes. `docker builder prune` clears the build cache only.

set -euo pipefail

KEEP="${KEEP:-3}"
APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

run() {
  if $APPLY; then echo "+ $*"; "$@"; else echo "  [DRY-RUN] $*"; fi
}

echo "── Disk before ──"
df -h / | tail -1

# Every image id a running or stopped container still references. Removing one
# of these would orphan the container's rootfs, so they are always kept.
mapfile -t IN_USE < <(docker ps -a --format '{{.Image}}' | sort -u)
in_use() {
  local ref="$1"
  for u in "${IN_USE[@]}"; do [[ "$u" == "$ref" ]] && return 0; done
  return 1
}

# Group by repository, newest first. CreatedAt sorts lexicographically because
# docker emits "2026-08-25 10:44:00 +0000 UTC".
mapfile -t REPOS < <(docker images --format '{{.Repository}}' \
  | grep -v '^<none>$' | sort -u)

for repo in "${REPOS[@]}"; do
  mapfile -t TAGS < <(docker images --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' \
    | grep "|${repo}:" | sort -r | cut -d'|' -f2)

  (( ${#TAGS[@]} <= KEEP )) && continue

  printf '\n── %s (%d tags, keeping %d) ──\n' "$repo" "${#TAGS[@]}" "$KEEP"
  for ref in "${TAGS[@]:$KEEP}"; do
    # ':latest' is a mutable alias the compose files fall back to. Deleting it
    # would make a bare `docker compose up -d` fail to resolve an image.
    if [[ "$ref" == *:latest ]]; then
      echo "  keep $ref (mutable alias)"
    elif in_use "$ref"; then
      echo "  keep $ref (in use by a container)"
    else
      run docker rmi "$ref"
    fi
  done
done

printf '\n── Build cache ──\n'
run docker builder prune -f

printf '\n── Disk after ──\n'
df -h / | tail -1

$APPLY || printf '\nDry run. Re-run with --apply to delete.\n'
