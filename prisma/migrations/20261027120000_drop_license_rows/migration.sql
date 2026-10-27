-- Plan OR6.2 (DR-35): remove the rows the license module left behind.
--
-- WHAT
--   Deletes the `RolePermission` grants `license:view`, `license:create`,
--   `license:update`, `license:delete` and `license:manage`, the same exact
--   five keys the seed prunes, and every `StoreSetting` row in the `license`
--   group. A near miss such as `licensing:view` or a `licenses` group is kept.
--   No schema change.
--
-- WHY
--   DR-35 relicensed the project to MIT and removed license enforcement, the
--   license module, its `license` permission module and its settings group. A
--   database seeded before that still holds both kinds of row. A role with a
--   leftover `license:*` grant cannot be saved from the roles screen: reading
--   it and sending its own list back fails validation, because the key is no
--   longer in the permission catalogue. The settings rows are the old verdict
--   cache; nothing reads them and the settings API rejects the group.
--
-- BACKFILL
--   None. No grant is carried over: the license module has no successor, so
--   mapping its grants onto another module would widen access.
--
-- HOW THIS ACTUALLY REACHES A DATABASE
--   Not through `prisma migrate deploy`. This repository deploys with
--   `prisma db push`, which applies schema only and never runs this file. The
--   executable path is the seed: `prisma/reconcile-role-permissions.ts` lists
--   `license` among its bounded dead families, and
--   `prisma/purge-retired-setting-groups.ts` deletes the `license` group. Both
--   run on the dev seed, on the `SEED_SCOPE=notifications-rbac` prod deploy
--   step and in `prisma/seed-roles-only.ts`. Both log every removed row before
--   deleting and write an `AuditLogEntry` that keeps the removed rows. This
--   file is the written record of intent and the equivalent SQL for a manual
--   run. Do not reach for `migrate deploy` or `migrate status` here; the dev
--   database carries a failed row in `_prisma_migrations` that would abort
--   them with P3009.
--
-- MANUAL RUN
--   Run the block below in one session. It leaves the transaction open: check
--   the two SELECT results and the two DELETE counts, then type COMMIT by hand,
--   or ROLLBACK if they are not what you expect. A manual run writes no audit
--   entry, so save the SELECT output before COMMIT: it is the only restore
--   list, and the ROLLBACK statements below do not cover this path.
--
-- ROLLBACK
--   The removed rows are not needed by any code after DR-35, so there is
--   nothing to restore for the application to work. The deploy log is not
--   persisted, so restore from the audit entries the seed wrote:
--
--   * Grants: action 'role_permission.reconcile', in
--     changes->'before'->'grants' as {role, permission}. "RolePermission"
--     keys on "roleId", so join on "Role"."name"; a role renamed or deleted
--     since is skipped. One entry lists every dead family removed in that run,
--     so keep only the license keys. "id" has no database default:
--
--     INSERT INTO "RolePermission" ("id", "roleId", "permission")
--     SELECT gen_random_uuid()::text, r."id", g->>'permission'
--     FROM "AuditLogEntry" a
--     CROSS JOIN LATERAL jsonb_array_elements(a."changes"->'before'->'grants') g
--     JOIN "Role" r ON r."name" = g->>'role'
--     WHERE a."id" = '<audit entry id>'
--       AND g->>'permission' IN ('license:view', 'license:create', 'license:update', 'license:delete', 'license:manage')
--     ON CONFLICT DO NOTHING;
--
--   * Settings: action 'store_setting.purge_retired', in
--     changes->'before'->'settings' as {group, key, value}. Neither "id" nor
--     "updatedAt" has a database default, so supply both:
--
--     INSERT INTO "StoreSetting" ("id", "group", "key", "value", "updatedAt")
--     SELECT gen_random_uuid()::text, s->>'group', s->>'key', s->'value', now()
--     FROM "AuditLogEntry" a
--     CROSS JOIN LATERAL jsonb_array_elements(a."changes"->'before'->'settings') s
--     WHERE a."id" = '<audit entry id>'
--       AND s->>'group' = 'license'
--     ON CONFLICT DO NOTHING;

BEGIN;

SELECT "roleId", "permission" FROM "RolePermission"
WHERE "permission" IN ('license:view', 'license:create', 'license:update', 'license:delete', 'license:manage');
SELECT "group", "key", "value" FROM "StoreSetting" WHERE "group" = 'license';

DELETE FROM "RolePermission"
WHERE "permission" IN ('license:view', 'license:create', 'license:update', 'license:delete', 'license:manage');
DELETE FROM "StoreSetting" WHERE "group" = 'license';

-- COMMIT;  -- by hand, after the checks above
