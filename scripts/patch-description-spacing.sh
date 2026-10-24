#!/usr/bin/env bash
# Plan H (H4) — restore the space after a full stop in already-seeded copy.
#
# Dry-run by default; pass --apply to write. Every flag is forwarded, so
# `--catalogues` repairs the catalogue JSON on disk instead of the database.
#
# This is the one plan H script that may legitimately run against production:
# `createMany` with `skipDuplicates` means re-seeding a fixed catalogue never
# repairs a row that already exists, so the live rows need their own pass. It
# only ever inserts a space into an `en` or `default` string, and it never
# deletes or inserts a row. Review the printed dry run first, every time.
#
# On the prod box it runs through the one-shot container in
# `seed-prod-via-docker.md`, reached by the tar-over-ssh sync. Do NOT push to a
# client branch to move it there: that triggers a full CI rebuild and redeploy.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

load_env() { [[ -f "$1" ]] || return 0; set -a; source "$1"; set +a; }
load_env "$REPO_ROOT/.env"
load_env "$REPO_ROOT/.env.local"

# WSL host translation (mirrors scripts/patch-blank-product-names.sh).
if [[ -n "${WSL_DISTRO_NAME:-}" || -f /proc/sys/fs/binfmt_misc/WSLInterop ]]; then
  host="${WSL_HOST_OVERRIDE:-$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)}"
  if [[ -n "$host" && -n "${DATABASE_URL:-}" ]]; then
    DATABASE_URL="${DATABASE_URL//@localhost:/@$host:}"
    DATABASE_URL="${DATABASE_URL//@127.0.0.1:/@$host:}"
    export DATABASE_URL
    echo "WSL detected — DATABASE_URL host = $host"
  fi
fi

exec npx ts-node -r tsconfig-paths/register prisma/seeds/patch-description-spacing.ts "$@"
