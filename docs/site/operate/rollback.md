---
title: Rollback
description: Roll the application containers back to a previous release from a git ref, what the script leaves untouched, and what to do first when the release you are leaving changed the schema.
primaryQuery: rollback ecommerce deployment docker git ref
updated: 2026-11-24
schema: HowTo
---

A rollback is a rebuild of the application images from an older git ref and a restart of the application containers. Postgres, Redis, the edge, the certificates and the schema are untouched. Because the installer builds images on the box under one tag, there is no older image to point at; the git ref is the thing you know.

## Roll back

```bash
cd /srv/themerchantengine
bash deploy/scripts/rollback.sh <git-ref>
```

The ref is a commit SHA or a tag, for example `v1.0.0`. The script refuses a checkout with uncommitted changes to tracked files, resolves the ref before it moves anything, fetches tags, checks out the ref detached, rebuilds the API, admin and storefront images, and restarts only those application containers. Postgres, Redis and the edge keep running.

To see every command first, without running any of them, set `ROLLBACK_DRY_RUN=1`:

```bash
ROLLBACK_DRY_RUN=1 bash deploy/scripts/rollback.sh <git-ref>
```

## When the release you are leaving changed the schema

The older code may not read the newer tables. Restore the dump taken before the update first, as [Backups and restore](./backups-and-restore.md) describes, then roll the code back, and take the outage that implies. There is no automated schema rollback, which is why every update starts with a dump.

## After a rollback

The checkout is now at the older ref. A later `./setup.sh` on that checkout re-renders the stack from that release's templates and is a full re-run of the installer for it, which is fine and idempotent. When the fix for whatever made you roll back ships, update the normal way: [Update the store](./update.md).
