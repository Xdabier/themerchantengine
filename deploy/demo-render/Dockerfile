# Public demo API for themerchantengine, built as a Render Docker web service.
# The demo repo holds only this folder. The engine source comes from the public repo.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git openssl ca-certificates curl ffmpeg redis-server python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

ARG ENGINE_REPO=https://github.com/Xdabier/themerchantengine
ARG ENGINE_REF=main

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    NX_DAEMON=false \
    NX_NO_CLOUD=true \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

WORKDIR /app
# The repo's ref list. A new engine commit changes this file, so the clone below never comes from the cache.
ADD ${ENGINE_REPO}.git/info/refs?service=git-upload-pack /tmp/engine-refs
RUN git clone --depth 1 --branch "$ENGINE_REF" "$ENGINE_REPO" . && rm -rf .git

# Neon object storage answers 501 to object ACLs. The demo bucket is public, so drop them.
ARG ACL_FILES="apps/api/src/modules/assets/storage/s3-storage.driver.ts prisma/seeds/fixture-catalogue/lib/storage.ts"
RUN sed -i "/ACL: 'public-read',/d" $ACL_FILES && ! grep -n "ACL: 'public-read'," $ACL_FILES

RUN npm ci --include=dev
RUN npx prisma generate
RUN NODE_OPTIONS=--max-old-space-size=4096 npx nx build api \
  && rm -f dist/apps/api/openapi-export.js

COPY entrypoint.sh /usr/local/bin/demo-entrypoint.sh
COPY scramble-seeded-logins.js /usr/local/bin/scramble-seeded-logins.js
COPY port-keeper.js /usr/local/bin/port-keeper.js
RUN sed -i 's/\r$//' /usr/local/bin/demo-entrypoint.sh && chmod 755 /usr/local/bin/demo-entrypoint.sh

RUN mkdir -p /app/uploads /app/uploads-private && chown -R 1000:1000 /app
USER 1000
ENV HOME=/tmp NPM_CONFIG_CACHE=/tmp/.npm

EXPOSE 10000
CMD ["/usr/local/bin/demo-entrypoint.sh"]
