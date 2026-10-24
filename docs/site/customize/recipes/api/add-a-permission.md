---
title: Add a permission
description: "Add a module:action key to the RBAC catalogue: the shared permissions library, the seed's copy, the route that enforces it, the guard, the seeded role rows, the admin roles grid that reads the same constant, and the two drift specs."
primaryQuery: add an rbac permission key nestjs admin dashboard
updated: 2026-09-09
schema: HowTo
---

## When you need this

A route needs its own gate, or a new module needs keys at all. A permission is a `module:action` string; the five actions are fixed, so a key is added by adding its module, and every module carries all five. `PermissionsGuard` reads the keys from the session on every request, the seed plants them on the roles, and the admin roles grid draws its columns from the same constant the decorators use. You end with a key a route enforces, a Super Admin and Admin role that hold it, and a checkbox for it on the roles screen. A whole new module is the wider recipe: [Add a module](add-a-module.md).

## Files you touch

- `libs/shared/permissions/src/index.ts`: `PERMISSION_MODULES`, `PERMISSION_ACTIONS` and the derived `PERMISSION_STRINGS`.
- `prisma/permission-catalogue.ts`: the hand-maintained copy the seed imports.
- `apps/api/src/modules/carriers/carriers.controller.ts`: an enforcing route, the worked example.
- `libs/shared/common/src/decorators/permissions.decorator.ts` and `apps/api/src/modules/auth/guards/permissions.guard.ts`: the decorator and the guard.
- `prisma/seed.ts` and `prisma/seed-roles-only.ts`: the role grants.
- `libs/shared/permissions/src/index.spec.ts`: the pinned module count (26) and permission-string count (130), both bumped with a new module.
- `apps/api/src/permission-key-drift.spec.ts` and `apps/api/src/permission-catalogue.parity.spec.ts`: the drift guards.

Read-only references, no edit needed. Each derives from `PERMISSION_STRINGS` and picks up the new key on the next build:

- `apps/api/src/modules/users/dto/admin/create-role.dto.ts:30` and `apps/api/src/modules/users/dto/admin/update-role-permissions.dto.ts:13`: `@IsIn(PERMISSION_STRINGS, { each: true })`, membership validation on the roles endpoints.
- `libs/admin-services/src/users/users.schemas.ts:43`: `permissionRequestSchema = z.enum(PERMISSION_STRINGS)`, used by the create and update request schemas at lines 213 and 218.
- `apps/admin/src/app/features/users/roles.page.ts:14`: imports `PERMISSION_STRINGS` from `@permissions` and draws the grid columns from it.

## The pattern

### 1. The shape of a key

`libs/shared/permissions/src/index.ts`:

```ts
export const PERMISSION_ACTIONS = Object.freeze([
  'view',
  'create',
  'update',
  'delete',
  'manage',
] as const);

export type Permission = `${PermissionModule}:${PermissionAction}`;

export const PERMISSION_STRINGS = Object.freeze(
  PERMISSION_MODULES.flatMap((mod) =>
    PERMISSION_ACTIONS.map((action) => `${mod}:${action}` as Permission),
  ),
) as readonly [Permission, ...Permission[]];
```

`view` is the read tier, `create`, `update` and `delete` the mutation tiers, `manage` the full-access key with side effects. A key is a value in the cross product and nothing else; `manage` does not imply `view`.

### 2. Add the module to both lists

Add the module name, in alphabetical order, to `PERMISSION_MODULES` in `libs/shared/permissions/src/index.ts` and to the same array in `prisma/permission-catalogue.ts`. The copy exists because the production runtime image ships `prisma/` and not `libs/`, so `prisma/seed.ts` cannot import the library.

### 3. Enforce it on a route

`apps/api/src/modules/carriers/carriers.controller.ts`:

```ts
  @Post()
  @Permissions('carriers:create')
  @RateLimit.Admin()
  create(@Body() dto: CreateCarrierDto) {
    return this.service.create(dto);
  }
```

`apps/api/src/modules/auth/guards/permissions.guard.ts` is registered globally and decides the request:

```ts
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new AuthPermissionInsufficientException();
    if (user.role === 'SUPER_ADMIN') return true;

    const hasPermission = required.some((perm: string) => user.permissions?.includes(perm));
    if (!hasPermission) {
      throw new AuthPermissionInsufficientException();
    }
```

`@Permissions('a:b', 'c:d')` passes when the user holds any one of them. A missing decorator passes every authenticated user. A refusal is a 403 with code `AUTH_PERMISSION_INSUFFICIENT`. `req.user.permissions` is filled by the session guard that runs before this one, from the user's role rows.

### 4. Plant the rows

`prisma/seed.ts` builds every grant from the catalogue copy:

```ts
const ALL_PERMISSIONS: Permission[] = [...PERMISSION_STRINGS];
const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== 'admin_users:manage');

const SUPPORT_PERMISSIONS: Permission[] = [
  'orders:view',
  'orders:update',
  'returns:view',
  'customers:view',
  'reviews:view',
  'products:view',
  // ... 6 more keys cut here
];
```

The `SUPPORT_PERMISSIONS` excerpt is abridged: the real list at `prisma/seed.ts:99-112` holds 12 keys.

A role that already exists keeps its rows (`update: {}`). New keys reach Super Admin and Admin through `syncRolePermissions`, a `createMany` with `skipDuplicates` that runs on every seed path, including `SEED_SCOPE=notifications-rbac`. Manager and Support are explicit lists; add the key there if those roles should hold it. `prisma/reconcile-role-permissions.ts` then removes ten named legacy key families and nothing else.

```bash
npm run db:seed
```

### 5. The roles endpoints validate membership

`apps/api/src/modules/users/dto/admin/create-role.dto.ts`:

```ts
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(PERMISSION_STRINGS, {
    each: true,
    message: 'Each permission must be a known module:action pair',
  })
  permissions: string[];
```

A well-formed but unknown key is a 400, not a stored grant nothing checks. `PATCH /v1/admin/roles/:id` replaces the whole set; both routes need `admin_users:manage`.

### 6. The roles grid

`apps/admin/src/app/features/users/roles.page.ts`:

```ts
import { PERMISSION_STRINGS, type Permission } from '@permissions';

  readonly canManage = computed(() => this.authStore.hasPermission('admin_users:manage'));

  /** Full flat catalogue: the shared constant, not what the database holds. */
  readonly catalogue: readonly string[] = [...PERMISSION_STRINGS].sort();

  readonly grouped = groupPermissionsByModule(this.catalogue);
```

The columns are the catalogue, so a checkbox can only exist for a key some endpoint enforces. `libs/admin-services/src/users/users.schemas.ts` keeps the read schema permissive (a legacy key in the database must still render) and the write schema strict (`z.enum(PERMISSION_STRINGS)`). A role that carries a legacy key heals on its next save, because the PATCH replaces the set.

### 7. The drift specs

`apps/api/src/permission-catalogue.parity.spec.ts` asserts the two arrays are equal in the same order. `apps/api/src/permission-key-drift.spec.ts` scans every controller for `@Permissions(...)` and fails on a key outside the catalogue or a catalogue module with no enforcing route:

```ts
  it('leaves no catalogue module without an enforcing endpoint', () => {
    const enforced = new Set(extracted.map((e) => e.key.split(':')[0]));
    const orphans = PERMISSION_MODULES.filter((mod) => !enforced.has(mod));
    expect([...orphans]).toEqual([]);
  });
```

## Tests to run

```bash
npx nx test api
npx nx test permissions
npx nx test admin
npm run docs:generate
npm run test:scripts
npm run test:e2e
```

`npx nx test api` runs both drift specs. `npx nx test permissions` runs `libs/shared/permissions/src/index.spec.ts`, which asserts `PERMISSION_MODULES` has 26 entries and `PERMISSION_STRINGS` has 130; a new module means bumping both. `npm run docs:generate` builds the API and regenerates the reference tree (`docs/site/reference/permissions.md`, `docs/site/reference/_generated/permissions.json`, `docs/site/reference/_generated/openapi.admin.json`, `docs/site/reference/_sidebar.json` and the `docs/site/reference/admin-api/` page of the module); `npm run test:scripts` then runs `scripts/__tests__/docs-generate.spec.ts`, which fails while the committed tree differs from a fresh run. `npx nx test admin` runs the roles page spec, which builds its columns from the same constant. `npm run test:e2e` runs `test/e2e/role-permissions.e2e-spec.ts` (out-of-catalogue keys are 400, the seeded Super Admin round-trips the full catalogue, no stray grant survives) and `apps/api/test/rbac.e2e-spec.ts` (the Super Admin bypass, a customer's 403, a limited role's 403).

## Gotchas

- A route with no `@Permissions` is open to every signed-in user, customers included. Add the decorator with the route, not after.
- Several keys on one decorator are OR, not AND. To require two keys, split the route or check the second one in the service.
- `SUPER_ADMIN` bypasses the guard entirely and cannot be restricted from the grid.
- The decorator's argument type is `string`, so a typo compiles. It surfaces as a 403 at runtime and as a red `permission-key-drift.spec.ts`.
- The reconcile step is bounded to ten known dead key families. If you rename a module, its old grants stay until you remove them yourself.
- Only Super Admin and Admin receive new keys automatically. A Manager or Support role, and any custom role, needs a save from the roles grid or a line in the seed's explicit list.
- There is no `webhooks` module in the catalogue: the webhook routes enforce `settings:view` and `settings:manage`. Reusing an existing module's key is allowed; the drift spec only requires that every catalogue module be enforced somewhere.
