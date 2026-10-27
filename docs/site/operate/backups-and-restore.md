---
title: Backups and restore
description: The nightly database dump the installer scheduled, how to take one by hand before an update, how to restore into the running Postgres, what the dump does and does not contain, and why a copy has to leave the box.
primaryQuery: self hosted ecommerce backups
updated: 2026-09-08
schema: HowTo
---

The installer scheduled a nightly dump of the database on every box that runs the engine. This page is how to take one by hand, how to restore one, and what is not in it.

## What the timer does

`themerchantengine-pg-backup.timer` runs at 02:00 every night. It takes a plain `pg_dump` of the `merchants_engine` database as the `postgres` superuser, gzips it to `/var/backups/themerchantengine/pg-<date>.sql.gz`, one file per calendar day, and deletes dumps older than fourteen days.

```bash
systemctl list-timers themerchantengine-pg-backup.timer --all
ls -lh /var/backups/themerchantengine/
```

## Take a backup by hand

Before any update, and before anything else you would rather undo:

```bash
sudo cp /var/backups/themerchantengine/pg-$(date +%F).sql.gz /var/backups/themerchantengine/pre-update-$(date +%F).sql.gz
sudo systemctl start themerchantengine-pg-backup.service
ls -lh /var/backups/themerchantengine/ | tail -2
```

The file is named by the day, so a manual run on the same day replaces that day's nightly dump; the first line keeps a copy of it under a name the cleanup's `pg-*.sql.gz` pattern does not match, so remove it yourself once the update is behind you. The directory is root-owned, hence `sudo`. Skip the first line when no dump exists yet today.

## Restore

Restore into the running Postgres container, with the API stopped so nothing writes during the load:

```bash
$COMPOSE stop api
docker exec -i themerchantengine-postgres psql -U postgres -c 'DROP DATABASE merchants_engine;' -c 'CREATE DATABASE merchants_engine OWNER merchants_app;'
docker exec -i themerchantengine-postgres psql -U postgres -d merchants_engine -c 'ALTER SCHEMA public OWNER TO merchants_app; GRANT ALL ON SCHEMA public TO merchants_app;'
gunzip -c /var/backups/themerchantengine/pg-2026-09-01.sql.gz | docker exec -i themerchantengine-postgres psql -U postgres -d merchants_engine
$COMPOSE start api
```

`$COMPOSE` is the compose command from [Topology](./topology.md). The database is created with the same owner the installer gives it, `merchants_app`, so the next schema push is not refused on the public schema. The dump carries the search index column, its trigger and the grants for the application role, so nothing needs re-applying after a restore. Sessions in Redis survive, and a customer who was signed in stays signed in.

## What the dump does not contain

- **Uploaded assets.** Product images, the logo and every other file live in your S3 bucket (or under `deploy/local/uploads` on the local profile). Turn on the bucket's own versioning; that is the backup there.
- **The environment files and `config/`.** `.env.production`, `apps/storefront/.env.production` and the rendered stack's `config/` directory are what a fresh box needs to run this database again. Copy them off the box too, encrypted, because the environment files hold every secret.
- **Redis.** Sessions and caches, rebuilt on their own.

## Copy the dumps off the box

A backup that lives on the disk it protects is not a backup. Copy `/var/backups/themerchantengine/` somewhere else every night: an `rclone` or `aws s3 sync` line in a cron entry to a second bucket is enough, and a restore test once a quarter on a scratch box is what tells you the copy works. The engine does not do this for you, because where the copy goes is your decision.

## Rebuild a box from a backup

Prepare a new box per [Requirements](../getting-started/requirements.md), point the DNS records at it, copy the environment files and the `config/` directory into a fresh checkout at the same release, run `./setup.sh` with the same profile (it keeps the secrets it finds in the environment file and issues new certificates), then stop the API and restore the dump as above. The store is back with every order, customer and setting it had at the dump.
