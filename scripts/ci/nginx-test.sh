#!/bin/sh
# Runs `nginx -t` over one rendered edge, inside the pinned nginx image.
#
#   docker run --rm -v "$PWD:/repo:ro" -v "<rendered>:/rendered:ro" nginx:1.27-alpine \
#     sh /repo/scripts/ci/nginx-test.sh /rendered/server
#
# Stub certificates are generated for every ssl_certificate path the vhosts
# name and every `root` directory is created, so the parse sees the same
# files an installed box has. The base conf is mounted the way the rendered
# compose files mount it. Catches the class of defect that once crashed an
# edge: a duplicate http-context directive between the base conf and a vhost.
set -eu

EDGE="${1:?usage: nginx-test.sh <rendered-edge-dir>}"
BASE="${BASE_CONF:-/repo/deploy/shared/nginx-base.conf}"

apk add --no-cache openssl >/dev/null

rm -f /etc/nginx/conf.d/default.conf
cp "$BASE" /etc/nginx/conf.d/00-base.conf
cp "$EDGE"/*.conf /etc/nginx/conf.d/

mkdir -p /var/www/certbot /etc/nginx/indexnow
grep -rhoE '^[[:space:]]*root[[:space:]]+[^;$]+;' /etc/nginx/conf.d/ \
  | awk '{print $2}' | tr -d ';' | xargs -r mkdir -p

grep -rhoE '^[[:space:]]*ssl_certificate(_key)?[[:space:]]+[^;]+;' /etc/nginx/conf.d/ \
  | awk '{print $2}' | tr -d ';' | xargs -r -n1 dirname | sort -u \
  | while read -r dir; do
      echo "stub cert: $dir"
      mkdir -p "$dir"
      openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
        -keyout "$dir/privkey.pem" -out "$dir/fullchain.pem" \
        -subj "/CN=$(basename "$dir")" 2>/dev/null
    done

nginx -t
