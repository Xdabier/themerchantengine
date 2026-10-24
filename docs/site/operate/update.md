---
title: Update the store
description: An update is a re-run of the installer on a newer checkout. What it rebuilds, what it keeps, the order for two boxes, and the two things to do by hand only when you must, editing nginx and pushing the schema.
primaryQuery: update self hosted ecommerce platform docker
updated: 2026-09-08
schema: HowTo
---

There is no upgrade command. An update is the installer run again on a newer checkout: it rebuilds the images from the new tree, pushes the schema, re-applies the search index, runs the seeds (which never overwrite an operator's edits), keeps every secret and certificate, and restarts what changed. The prompts default to the previous answers, so a re-run is a series of Enter presses; `--answers <file>` skips them.

## Update

Take a backup first. [Backups and restore](./backups-and-restore.md) shows the one command.

```bash
cd /srv/themerchantengine
git fetch --tags origin
git checkout v1.1.0            # the release you are moving to, or the branch you deploy from
./setup.sh --profile engine    # the profile this box was installed with
```

On two boxes, run the engine box first and the storefront box after, because the storefront's SSR smoke at the end of its run talks to the live API. A `both` box does both in one run.

A demo catalogue answered yes on a re-run is ignored on a store that already has users; the seed is a first-install step.

The run ends with the same closing lines as the install. If a step fails, the installer prints the cause and `fix the cause and run setup again; completed steps are kept`; [Troubleshooting](../getting-started/troubleshooting.md) has the lines. If the release turns out wrong, [Rollback](./rollback.md).

## What an update keeps and what it changes

- **Kept:** every generated secret, every third-party key, the issued certificates, the owner account and every user, the database, the uploaded assets, the store settings edited in the admin. The seeds add rows a new release needs (a new permission, a new notification template) and never overwrite a row an operator changed.
- **Changed:** the three images, the rendered compose file and vhosts (from the new templates), the schema (additive pushes; a release that drops a column says so in its changelog), the search index, and the systemd units.

## When the changelog says a release changes the schema

The push is additive in the common case and runs inside the installer. When a release notes a destructive schema change, the dump you took before the update is what a rollback restores; there is no automated schema rollback. Read the release's changelog entry before the update, not after.

## By hand, only when you must

The two things below are steps the installer performs in order. Prefer a re-run of setup. These are for the day the installer cannot run and the store must.

### Edit an nginx vhost

The rendered vhosts under `deploy/<profile>/nginx/` are a directory mount: a change to a file there is visible to the container at once, and a reload applies it.

```bash
docker exec themerchantengine-edge nginx -s reload
```

`deploy/shared/nginx-base.conf` is different: it is a single-file mount, and Docker binds the file's inode, not its path. Anything that replaces the file rather than rewriting it in place (`git checkout`, `sed -i`, `scp`) leaves the container on the old file while the host shows the new one, and `nginx -t` inside the container reports success against the stale copy. After changing that file, recreate the edge:

```bash
$COMPOSE up -d --force-recreate --no-deps nginx
```

Validate a hand edit in a throwaway container before recreating, because a syntax error takes the edge down:

```bash
docker run --rm \
  -v "$PWD/deploy/engine/nginx:/etc/nginx/conf.d:ro" \
  -v "$PWD/deploy/shared/nginx-base.conf:/etc/nginx/conf.d/00-base.conf:ro" \
  -v themerchantengine_certbot-certs:/etc/letsencrypt:ro \
  -v themerchantengine_certbot-webroot:/var/www/certbot:ro \
  nginx:1.27-alpine nginx -t
```

A re-run of setup rewrites the vhosts from the templates, so a hand edit is a stopgap. Put a change that has to survive in `deploy/templates/nginx/` in your fork.

### Push the schema

Keep the order. The push drops the full-text search index column, which lives outside the schema, so the index SQL has to follow every push or storefront search returns nothing; the two index scripts after it add the notification-log and shipping indexes the schema cannot express.

```bash
$COMPOSE run --rm api npx prisma db push --accept-data-loss
docker exec -i themerchantengine-postgres psql -U postgres -d merchants_engine -v ON_ERROR_STOP=1 -f - < prisma/search_fts_setup.sql
$COMPOSE run --rm api npx ts-node --transpile-only prisma/apply-notification-indexes.ts
$COMPOSE run --rm api npx ts-node --transpile-only prisma/apply-shipping-indexes.ts
$COMPOSE run --rm -e SEED_SCOPE=notifications-rbac -e STORE_CONFIG_FILE=/app/config/client.config.json api npx prisma db seed
$COMPOSE up -d api
```

The search index SQL runs as the `postgres` superuser through the database container, not through the API, because the application role cannot create extensions or replace a function it does not own. The two index scripts run through the API container as the application role, which owns those tables.
