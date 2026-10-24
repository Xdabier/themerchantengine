---
title: Topology
description: What an installed store looks like on the box. The containers per profile, the volumes, the rendered stack directory, the environment files, the timers, and the compose command every operation on this track starts from.
primaryQuery: ecommerce docker compose production
updated: 2026-09-08
schema: TechArticle
---

This track is the day-two manual for a store installed with `./setup.sh`. Everything on it assumes the installer printed its closing line; the install itself is [Install on a server](../getting-started/install-on-a-server.md). This page is the map: what runs where, what the installer wrote, and the one shell variable the other pages use.

Everything under `deploy/` that is tracked in git is a template or a shared script. Everything the installer writes lands under `deploy/engine/`, `deploy/storefront/` or `deploy/local/` and is ignored by git; a re-run of setup rewrites it, so do not hand-edit a rendered file expecting the edit to last.

## One store, one to two boxes, one compose project

The compose project is named `themerchantengine` on every profile.

- **Engine box** (`--profile engine`): Postgres, Redis, the API, the admin, an edge nginx that terminates TLS for `api.<apex>` and `admin.<apex>`, and a certbot container used on demand. Rendered under `deploy/engine/`, environment file `.env.production` at the repository root.
- **Storefront box** (`--profile storefront`): the Nitro storefront, its own Redis, an edge nginx for the apex and `www`, certbot. Rendered under `deploy/storefront/`, environment file `apps/storefront/.env.production`.
- **One box for both** (`--profile both`): the union of the two behind one edge. Rendered under `deploy/engine/`, both environment files.
- **Local** (`--profile local`, or `setup.ps1` on Windows): the whole engine on `localhost` without TLS on ports 53000 (API), 53200 (admin) and 53300 (storefront). Rendered under `deploy/local/` with its own `.env` and `.env.storefront`.

Container names are `themerchantengine-postgres`, `-redis`, `-api`, `-admin`, `-storefront`, `-edge` and `-certbot`. Images are built on the box from the checkout and tagged `themerchantengine/<service>:installed`; there is no registry. Named volumes are `themerchantengine_pg-data`, `_redis-data`, `_certbot-webroot` and `_certbot-certs`. Every container runs with `restart: unless-stopped`, so a reboot brings the stack back without you.

## The rendered stack directory

`deploy/engine/` (or `deploy/storefront/`, `deploy/local/`) holds:

- `docker-compose.yml`, the rendered compose file.
- `nginx/`, the rendered vhosts, mounted into the edge as `/etc/nginx/conf.d`. The shared `deploy/shared/nginx-base.conf` is mounted beside them as `00-base.conf`.
- `config/`, the license file, the invoice logo and the optional Search Console key, mounted read-only into the API at `/app/config`.
- `indexnow/`, the IndexNow key file the edge serves at `https://<apex>/<key>.txt`.
- `systemd/`, the rendered backup timer units, installed to `/etc/systemd/system/`.

## The environment files

Secrets live in the environment files the installer wrote, mode `0600`: `.env.production` on an engine box, `apps/storefront/.env.production` on a storefront box, both on a `both` box. Nothing else on the box holds them; `.setup-state.json` never does. The files carry the generated secrets (database and Redis passwords, the session secret, the signed-URL secret, the unsubscribe secret, the revalidate secret the storefront shares), the third-party keys you entered, and the three public origins. [Store settings](./store-settings.md) says how each one changes.

## The compose command

Every compose command on this track takes the profile's compose file and environment file. Set the variable once per shell. On an engine or both box:

```bash
cd /srv/themerchantengine
COMPOSE="docker compose -f deploy/engine/docker-compose.yml --env-file .env.production"
```

On a storefront box:

```bash
cd /srv/themerchantengine
COMPOSE="docker compose -f deploy/storefront/docker-compose.yml --env-file apps/storefront/.env.production"
```

Then `$COMPOSE ps`, `$COMPOSE logs -f`, `$COMPOSE up -d api`, and so on. Running `docker compose` without the two flags from another directory finds no project.

## What the installer left running besides the stack

- `themerchantengine-cert-renew.timer`, twice a day at 03:17 and 15:17, renewing the certificates and checking the ones the edge serves. [TLS and renewal](./tls-and-renewal.md).
- `themerchantengine-cert-alert.timer`, daily at 08:00 on a box that carries the Resend key, mailing you when a certificate is close to expiry or a host serves none. Same page.
- `themerchantengine-pg-backup.timer`, nightly at 02:00 on a box that runs the engine, dumping the database to `/var/backups/themerchantengine/` and keeping fourteen. [Backups and restore](./backups-and-restore.md).

```bash
systemctl list-timers 'themerchantengine-*' --all
```

## Request flow

A browser request to `https://<apex>/` reaches the edge, which proxies to the storefront container. The storefront renders on the server against the API (`https://api.<apex>/api/v1/...`) and the browser's own calls to `/v1/...` on the storefront origin are proxied by the edge to the same API, so the customer never talks to a second origin. The admin at `https://admin.<apex>/` is a static bundle served by its container, with `/api` on that host proxied to the API. The edge forwards a client's `X-Request-Id` when one was sent and mints one otherwise; the API logs the same id on every line, so one id follows a request from the edge into the API and back out in the edge's JSON access log.
