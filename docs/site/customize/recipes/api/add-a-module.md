---
title: Add a module
description: "Create a NestJS module under apps/api/src/modules, register it, keep it isolated behind injected services, give it a permission module in both catalogue copies, and plant the permission rows with the seed, with the carriers and countries modules as the worked examples."
primaryQuery: add a module nestjs modular monolith ecommerce
updated: 2026-09-09
schema: HowTo
---

## When you need this

You have a domain that fits none of the modules under `apps/api/src/modules/`: a loyalty ledger, a marketplace feed, a booking calendar. A module owns its Prisma models, its routes, its DTOs and its permission keys, and other modules reach it only through the service it exports. This page uses the carriers module as the shape to copy and the countries module as the example of one module reading another. You end with a registered module, a permission module in both catalogue copies, seeded role rows and two green drift specs. For the routes themselves, see [Add an endpoint](add-an-endpoint.md).

## Files you touch

- `apps/api/src/modules/carriers/carriers.module.ts` and `apps/api/src/modules/carriers/index.ts`: the shape of a module and its barrel.
- `apps/api/src/app.module.ts`: the import list every module joins.
- `apps/api/src/modules/countries/countries.module.ts` and `apps/api/src/modules/countries/countries.service.ts`: how one module uses another.
- `libs/shared/permissions/src/index.ts`: the permission module list the decorators, the DTOs and the admin roles grid read.
- `prisma/permission-catalogue.ts`: the hand-maintained copy the seed reads.
- `apps/api/src/permission-key-drift.spec.ts` and `apps/api/src/permission-catalogue.parity.spec.ts`: the two specs that go red until both lists and one enforcing route exist.
- `prisma/seed.ts` and `prisma/seed-roles-only.ts`: the rows under `RolePermission`.
- `libs/shared/admin-routes/src/index.ts`: the route node, when the module has admin routes.

## The pattern

### 1. Create the directory

The carriers module is the smallest complete one: `carriers.controller.ts`, `carriers.service.ts`, `carriers.service.spec.ts`, `carriers.module.ts`, `index.ts` and a `dto/` directory. Directories and files are kebab-case, classes PascalCase.

`apps/api/src/modules/carriers/carriers.module.ts`:

```ts
@Module({
  imports: [PrismaModule],
  controllers: [CarriersController],
  providers: [CarriersService],
  exports: [CarriersService],
})
export class CarriersModule {}
```

`apps/api/src/modules/carriers/index.ts` exports the module, the service and its result type, and nothing else.

### 2. Register it

`apps/api/src/app.module.ts`:

```ts
import { CountriesModule } from './modules/countries';
import { CarriersModule } from './modules/carriers';
// ...
    CountriesModule,
    CarriersModule,
    CurrenciesModule,
    NotificationsModule,
    MailModule,
```

Order matters for two of them: the comment in the same file states that `MailModule` must precede `WebhooksModule` and the `AuthMailerProvider`. Put a new module after the modules it imports.

### 3. Keep it isolated

A module reads and writes its own Prisma models. Another module's data comes through that module's exported service, injected in the constructor. The countries module needs the store's configured market, which the settings module owns.

`apps/api/src/modules/countries/countries.module.ts`:

```ts
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [CountriesController],
  providers: [CountriesService],
  exports: [CountriesService],
})
```

`apps/api/src/modules/countries/countries.service.ts`:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async configuredMarket(): Promise<{ enabled: string[]; defaultCode: string | null }> {
    const [areaServed, country] = await Promise.all([
      this.settings.get<unknown>('areaServed'),
      this.settings.get<unknown>('addressCountry'),
    ]);
```

The checkout module is the same rule seen from the other side: `apps/api/src/modules/checkout/checkout.service.ts` never touches `prisma.paymentMethod`; it calls `PaymentMethodsService.listStorefront()`, so the column that carries provider secrets has exactly one read path.

### 4. Add the permission module, twice

A permission key is `module:action`, and the five actions are fixed, so a new module gets five keys at once. Add the module name, alphabetically, to both lists.

`libs/shared/permissions/src/index.ts`:

```ts
export const PERMISSION_MODULES = Object.freeze([
  'admin_users',
  'analytics',
  'assets',
  'audit_log',
  'campaigns',
  'carriers',
  // ...
] as const);

export const PERMISSION_ACTIONS = Object.freeze([
  'view',
  'create',
  'update',
  'delete',
  'manage',
] as const);
```

`prisma/permission-catalogue.ts` holds the same two arrays as plain `as const` literals. The copy exists because the production runtime image ships `prisma/` but not `libs/`, so the seed cannot import the library.

### 5. Let the drift specs tell you what is missing

`apps/api/src/permission-catalogue.parity.spec.ts` compares the two files:

```ts
  it('declares the same modules in the same order', () => {
    expect([...SEED_MODULES]).toEqual([...PERMISSION_MODULES]);
  });
```

`apps/api/src/permission-key-drift.spec.ts` scans every `*.controller.ts` for `@Permissions(...)` and checks both directions:

```ts
  it('requires only keys that exist in the catalogue', () => {
    const catalogue = new Set<string>(PERMISSION_STRINGS);
    const offenders = extracted
      .filter((e) => !catalogue.has(e.key))
      .map((e) => `${e.file}: ${e.key}`);
    expect(offenders).toEqual([]);
  });

  it('leaves no catalogue module without an enforcing endpoint', () => {
    const enforced = new Set(extracted.map((e) => e.key.split(':')[0]));
    const orphans = PERMISSION_MODULES.filter((mod) => !enforced.has(mod));
    expect([...orphans]).toEqual([]);
  });
```

A module in the catalogue with no route that carries one of its keys fails the second test. Ship the module and its first `@Permissions` route in the same change.

### 6. Plant the rows

`prisma/seed.ts` derives every grant from the catalogue copy. The Super Admin role gets all keys, Admin gets all but `admin_users:manage`, and Manager and Support are explicit lists:

```ts
const ALL_PERMISSIONS: Permission[] = [...PERMISSION_STRINGS];
const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== 'admin_users:manage');

const MANAGER_MODULES = [
  'products',
  'categories',
  'inventory',
  'orders',
  'promotions',
  'assets',
  'shipping',
];
```

The role upserts use `update: {}`, so an existing role keeps its rows. New keys reach Super Admin and Admin through `syncRolePermissions`, a `createMany` with `skipDuplicates`, which the seed runs on every path including `SEED_SCOPE=notifications-rbac`, the prod-safe branch. Manager and Support get a new module only if you add it to their lists. `prisma/seed-roles-only.ts` writes roles and grants and nothing else, for a database that must not receive the demo catalogue.

```bash
npm run db:seed
```

### 7. Give it a route node

When the module has admin routes, add its node to `ADMIN_API_ROUTES` in `libs/shared/admin-routes/src/index.ts`; the controller and the Angular service in `libs/admin-services/` both read it.

## Tests to run

```bash
npx nx test api
npx nx test permissions
npx nx lint api
npm run docs:generate
npm run test:scripts
npm run test:e2e
```

`npx nx test api` runs the parity spec, the drift spec and your unit specs. `npx nx test permissions` runs `libs/shared/permissions/src/index.spec.ts`, which pins the module count (`toHaveLength(26)`) and the permission-string count (`toHaveLength(130)`); bump both numbers with the new module or the spec goes red. `npx nx lint api` lints `apps/api` and `test/`; it does not check module isolation (see the gotchas). `npm run docs:generate` builds the API and regenerates the reference tree: a new module changes `docs/site/reference/permissions.md`, `docs/site/reference/_generated/permissions.json`, `docs/site/reference/_generated/openapi.admin.json`, `docs/site/reference/_sidebar.json` and adds `docs/site/reference/admin-api/<module>.md`. `npm run test:scripts` then runs `scripts/__tests__/docs-generate.spec.ts`, which compares the committed tree with a fresh run and fails until you regenerate. `npm run test:e2e` includes `test/e2e/role-permissions.e2e-spec.ts`, which asserts that no `RolePermission` row anywhere carries a key outside the catalogue and that the roles endpoints refuse one.

## Gotchas

- The drift spec refuses to pass on an empty scan: it expects more than twenty controllers and more than a hundred keys, so a broken glob shows up as a failure, not a green run.
- The parity spec's third test is titled with the current count of permission strings, but its assertion compares the arrays, so that title is a label. The number is pinned elsewhere: `libs/shared/permissions/src/index.spec.ts` asserts 26 modules and 130 strings, and `npx nx test permissions` fails until you update both.
- Nothing in lint flags `modules/a` importing from `modules/b`. Every API module is one Nx project (`apps/api/project.json`, name `api`), and `@nx/enforce-module-boundaries` in `.eslintrc.js:116-118` runs at `warn` and only constrains imports between projects by tag. The isolation rule (another module's data only through its exported service) is enforced by review, not by a tool.
- `prisma/reconcile-role-permissions.ts` deletes only eleven named historical key families and reports anything else. It never deletes "everything outside the catalogue", so a module you remove from the catalogue leaves its grants in place until you clean them.
- A role created before your module exists never gets the new keys from the upsert. Only `syncRolePermissions` adds them, and only for Super Admin and Admin.
- `npm run db:seed` without `SEED_SCOPE` runs the destructive demo seed. It refuses every database name but the test one unless `SEED_DEV_OK=1` is set.
- The permission catalogue is the whole cross product. There is no way to declare `loyalty:view` without also declaring `loyalty:manage`; the roles grid shows all five columns.
- `@Permissions` accepts any string at compile time; a typo is a 403 at runtime and a red drift spec, never a compile error.
