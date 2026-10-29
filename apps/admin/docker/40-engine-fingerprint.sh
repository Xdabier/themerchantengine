#!/bin/sh
# Removes the engine markers (DR-36) when the operator sets TME_FINGERPRINT
# to off, false, 0 or no. The admin is a static build, so this is the only
# runtime switch it has; TME_FINGERPRINT_VERSION is not supported here.
set -eu

case "$(printf '%s' "${TME_FINGERPRINT:-}" | tr '[:upper:]' '[:lower:]')" in
  off | false | 0 | no) ;;
  *) exit 0 ;;
esac

HTML="${TME_ADMIN_HTML:-/usr/share/nginx/html/index.html}"
HEADERS="${TME_ADMIN_HEADERS:-/etc/nginx/security-headers.conf}"

sed -i -e 's#<meta name="generator" content="themerchantengine"[^>]*>##' \
  -e 's# data-tme-app="admin"##' "$HTML"
sed -i -e '/add_header X-Powered-By/d' "$HEADERS"
echo "engine-fingerprint: markers removed"
