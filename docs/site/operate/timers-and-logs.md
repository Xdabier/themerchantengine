---
title: Timers, logs and disk
description: The three systemd timers an installed store runs, how to read the logs of each container and follow one request by its id, how to reclaim disk without deleting a volume, and the one-liners that answer the usual questions.
primaryQuery: docker compose logs disk cleanup self hosted ecommerce
updated: 2026-09-08
schema: TechArticle
---

An installed store has three timers, seven containers and one disk. This page is how to look at each.

## Timers

```bash
systemctl list-timers 'themerchantengine-*' --all
```

- **`themerchantengine-cert-renew.timer`**, 03:17 and 15:17 daily: certificate renewal and a check of what the edge serves. [TLS and renewal](./tls-and-renewal.md).
- **`themerchantengine-cert-alert.timer`**, 08:00 daily on a box with the Resend key: the expiry sweep that mails you. Same page.
- **`themerchantengine-pg-backup.timer`**, 02:00 nightly on a box that runs the engine: the database dump. [Backups and restore](./backups-and-restore.md).

A timer's last run is in its journal: `journalctl -u themerchantengine-pg-backup.service -n 30 --no-pager`. A renewal or backup you want now is `sudo systemctl start <unit>.service`.

## Logs

`$COMPOSE` is the compose command from [Topology](./topology.md).

```bash
$COMPOSE logs -f --tail 100                            # every container
docker logs themerchantengine-api --tail 100           # the API
docker logs themerchantengine-edge --tail 100          # the edge: JSON access log, one line per request with its request id
docker logs themerchantengine-storefront --tail 100    # the storefront
docker logs themerchantengine-admin --tail 100         # the admin's nginx
docker logs themerchantengine-postgres --tail 100
```

The edge forwards a client's `X-Request-Id` when one was sent and mints one otherwise; the API logs the same id on every line. To follow one request, take the id from the edge's access line and grep the API:

```bash
docker logs themerchantengine-api 2>&1 | grep '<request-id>'
```

The API never logs a token, a password or a raw authentication body. On a local install, the API log is also where every email lands, addressed to the redirect address you gave the installer.

Container logs live in Docker's default JSON files and are rotated by Docker's own settings. If a box fills its disk with logs, set `log-opts` `max-size` and `max-file` in `/etc/docker/daemon.json` and restart Docker; the engine does not override the daemon's defaults.

## Disk

The installer tags one image per service and rebuilds it in place, so images do not accumulate the way registry pulls do. The build cache does. When `df -h /` gets tight:

```bash
docker builder prune -af                     # the build cache only
bash deploy/scripts/prune-images.sh          # list stale tagged images
KEEP=2 bash deploy/scripts/prune-images.sh --apply
```

Never run `docker system prune --volumes`: `pg-data` and `certbot-certs` are volumes, and that command deletes the database and the certificates of a stopped stack.

Three image builds on a box with little free disk fail partway with an "no space left on device" error from the builder; prune the cache and run the installer again.

## One-liners

```bash
curl -fsS https://api.<apex>/health
docker exec themerchantengine-postgres psql -U postgres -d merchants_engine -c 'SELECT count(*) FROM pg_stat_activity;'
docker exec themerchantengine-redis redis-cli -a "$(grep -m1 ^REDIS_PASSWORD= .env.production | cut -d= -f2- | tr -d '\"')" INFO memory | grep used_memory_human
df -h / && docker system df
ls -lh /var/backups/themerchantengine/ | tail -3
$COMPOSE ps
```

`docker ps` shows `(healthy)` next to the API and Postgres when their health checks pass. A fresh API waits on Postgres and Redis health before it starts, which is why a 502 from the edge right after a restart clears itself within a few seconds.
