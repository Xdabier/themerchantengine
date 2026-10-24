---
title: Add a screen
description: "Add a list or detail screen to the Angular admin: the shared route constant, the Zod-parsed service, the page component, the guarded route, the nav entry, the component spec and the Playwright journey against the real API."
primaryQuery: add a screen angular admin dashboard nestjs api
updated: 2026-09-09
schema: HowTo
---

## When you need this

The API has an endpoint and the admin has no screen for it. You end up with a page under `apps/admin/src/app/features/`, a service in `libs/admin-services/` that parses the response through Zod, a route behind a permission guard, a link in the sidebar, a Jest spec and a Playwright journey that talks to the real API. The worked example is the carriers list at `/shipping/carriers`, which is small enough to read in one sitting.

## Files you touch

- `libs/shared/admin-routes/src/index.ts`: the route constant. The NestJS controller and the Angular service both read it.
- `libs/admin-services/src/carriers/carriers.schemas.ts`: the Zod schemas for the entity, the list query and the list response.
- `libs/admin-services/src/carriers/carriers.service.ts`: the HTTP calls. Every response goes through a schema before a component sees it.
- `libs/admin-services/src/carriers/index.ts` and `libs/admin-services/src/index.ts`: the barrel exports the screen imports from `@admin-services`.
- `apps/admin/src/app/features/shipping/carriers-list.page.ts`: the page. Standalone component, inline template, signals for state.
- `apps/admin/src/app/features/shipping/carriers-list.page.spec.ts`: the component spec, with a fake service and an axe run.
- `apps/admin/src/app/app.routes.ts`: the lazy route with its `permissionGuard`.
- `apps/admin/src/app/core/nav.config.ts` and `apps/admin/src/app/core/nav.config.spec.ts`: the sidebar entry and the spec that checks its permission is one the backend issues.
- `apps/admin-e2e/src/modules/shipping.spec.ts` and `apps/admin-e2e/src/modules/shipping.journey.spec.ts`: the Playwright coverage.

## The pattern

### 1. The route constant is shared with the API

`libs/shared/admin-routes/src/index.ts` is the single source of every `/v1/admin/*` path. A `base` is the exact `@Controller(...)` argument; each sub-key is the method-relative path with `:param` placeholders kept verbatim.

```ts
  carriers: {
    base: 'v1/admin/carriers',
    byId: ':id',
  },
```

The controller reads the same object, in `apps/api/src/modules/carriers/carriers.controller.ts`:

```ts
@Controller(ADMIN_API_ROUTES.carriers.base)
export class CarriersController {
  @Get()
  @Permissions('carriers:view')
  list(@Query() query: ListCarriersDto) {
    return this.service.list(query);
  }

  @Get(ADMIN_API_ROUTES.carriers.byId)
  @Permissions('carriers:view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
```

The spec files pin the literal URL on purpose: `libs/admin-services/src/carriers/carriers.service.spec.ts` expects `/api/v1/admin/carriers`, and that literal is the independent check that the constant resolves to the right path.

When the endpoint already exists, so does its node in `ADMIN_API_ROUTES`: reuse it from the service and add no constant. A new screen carries its module's `view` permission (`carriers:view` here), the same string the controller's `@Permissions` names and the route guard below checks.

### 2. The service parses every response

`libs/admin-services/src/carriers/carriers.schemas.ts` declares the entity and the list envelope. Paginated lists come back as `{ data, meta }`; a single entity comes back wrapped in `data`, which the shared `envelope()` helper unwraps. The entity schema is abridged here: the real one (`carriers.schemas.ts:7-19`) also declares `services`, `zones`, `config`, `createdAt` and `updatedAt`, and the page in step 3 reads `c.services` and `c.zones`.

```ts
export const carrierSchema = z.object({
  id: entityIdSchema,
  code: z.string(),
  name: translatableSchema,
  provider: carrierProviderSchema,
  // services, zones, config, createdAt, updatedAt: see the file
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
});

export const listCarriersResponseSchema = z.object({
  data: z.array(carrierSchema),
  meta: paginationMetaSchema,
});
```

`libs/admin-services/src/carriers/carriers.service.ts` builds the URL from the constant and parses on the way out:

```ts
const CARRIERS = ADMIN_API_ROUTES.carriers;

@Injectable({ providedIn: 'root' })
export class CarriersService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  list(query: ListCarriersQuery = {}): Observable<ListCarriersResponse> {
    const parsed = listCarriersQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(CARRIERS.base)}`, { params, withCredentials: true })
      .pipe(map((raw) => listCarriersResponseSchema.parse(raw)));
  }

  get(id: string): Observable<Carrier> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(CARRIERS.base, fillRoute(CARRIERS.byId, { id }))}`, { withCredentials: true })
      .pipe(map((raw) => carrierSchema.parse(envelope(raw))));
  }
```

`ADMIN_API_BASE_URL` defaults to `/api` (`libs/admin-services/src/shared/api-base-url.ts`); the dev server proxies it to the API. `envelope` and `toParams` come from `libs/admin-services/src/shared/index.ts`, which re-exports them from `libs/admin-services/src/shared/http-options.ts`; the service imports all three from `'../shared'`. `ADMIN_API_ROUTES`, `adminRoute` and `fillRoute` come from `@admin-routes`.

### 3. The page holds its state in signals

The admin does not use TanStack Query on any screen: the package is in `package.json` but no file under `apps/admin/src` or `libs/` imports it. A list page subscribes to the service and writes into signals. From `apps/admin/src/app/features/shipping/carriers-list.page.ts`:

```ts
export class CarriersListPage implements OnInit, OnDestroy {
  private readonly service = inject(CarriersService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStore);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Carrier[]>([]);
  readonly total = signal(0);
  readonly canCreate = computed(() => this.auth.hasPermission('carriers:create'));

  readonly queryParams = toSignal(this.route.queryParams, { initialValue: {} as Record<string, string | undefined> });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  private fetch(): void {
    this.loading.set(true);
    this.service.list({ page: this.page(), pageSize: this.pageSize() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.rows.set(res.data); this.total.set(res.meta.total); this.loading.set(false); },
        error: (err: unknown) => { this.loading.set(false); this.error.set(this.formatError(err)); },
      });
  }
```

Filters and the page number live in the URL query, so a reload and the back button keep them. The root element carries a `data-testid` (`carriers-list-page`) that the e2e suite waits on.

### 4. The route and its guard

`apps/admin/src/app/app.routes.ts` lazy-loads the page and guards it. `data.permission` and the guard argument are the same string; the topbar title comes from `data.title`.

```ts
      {
        path: 'carriers',
        canActivate: [permissionGuard('carriers:view')],
        data: { title: 'Carriers', permission: 'carriers:view' },
        children: [
          { path: '', pathMatch: 'full', loadComponent: () => import('./features/shipping/carriers-list.page').then((m) => m.CarriersListPage) },
          { path: 'new', canActivate: [permissionGuard('carriers:create')], data: { title: 'New carrier', permission: 'carriers:create' }, loadComponent: () => import('./features/shipping/carrier-new.page').then((m) => m.CarrierNewPage) },
          { path: ':id', loadComponent: () => import('./features/shipping/carrier-detail.page').then((m) => m.CarrierDetailPage) },
        ],
      },
```

`apps/admin/src/app/core/guards/permission.guard.ts` sends an anonymous visitor to `/auth/login?returnTo=...` and an authenticated one without the permission to `/403`.

The snippet starts at the child. Its parent, the `shipping` route at `apps/admin/src/app/app.routes.ts:436-438`, carries its own `canActivate: [permissionGuard('settings:view')]`, and Angular runs both guards. An operator with `carriers:view` and not `settings:view` still lands on `/403`. The rule for a new screen: read every guard on the path from the root, not only the one you write, and give the nav entry a permission that implies all of them, or guard the parent with the weakest permission its children need.

### 5. The nav entry

`apps/admin/src/app/core/nav.config.ts` is a static list of groups. One line per screen:

```ts
      { label: 'Shipping', to: '/shipping/carriers', permission: 'carriers:view' },
```

`filterNav` drops items whose permission the operator lacks, so the entry's permission must equal the route guard's, or the sidebar offers a link that lands on `/403`.

### 6. The component spec

`apps/admin/src/app/features/shipping/carriers-list.page.spec.ts` swaps the service for a `jest.fn`, seeds `AuthStore`, and runs axe on the rendered element. `BOOTSTRAP_LOCALE` is the injection token in `apps/admin/src/app/core/tokens.ts`, imported from `'../../core/tokens'`; `AuthStore` injects it (`apps/admin/src/app/core/stores/auth.store.ts:21`) and the page reads `this.auth.locale()` to pick the translation to render, so a spec that seeds `AuthStore` provides the token too.

```ts
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CarriersService, useValue: { list: listSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: ['carriers:view'], roles: [], status: 'active' },
    });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() => throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })));
    configure();
    expect(page.error()).toContain('permission');
  });
```

### 7. The Playwright journey calls the real API

The suite under `apps/admin-e2e/src/modules/` runs against a NestJS API that `apps/admin-e2e/global-setup.ts` starts on port 53001 over the dockerized test database. No `page.route()`, no MSW, no fixtures: every spec header says so and nothing in the suite intercepts a request. The auth fixture (`apps/admin-e2e/src/modules/_auth-fixture.ts`) seeds the session cookie global setup captured.

`apps/admin-e2e/src/modules/shipping.spec.ts` proves the route mounts:

```ts
test('carriers list renders', async ({ page }) => {
  await expectRoute(page, '/shipping/carriers', 'carriers-list-page');
});
```

`apps/admin-e2e/src/modules/shipping.journey.spec.ts` reads an id from the API, edits through the UI and proves it persisted across a reload:

```ts
test('carrier-detail: edit sort order → persist across reload', async ({ page, baseURL }) => {
  const id = await firstIdFromApi(baseURL!, '/api/v1/admin/carriers?pageSize=1');
  await page.goto(`/shipping/carriers/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="carrier-detail-page"]')).toBeVisible();

  const sortInput = page.locator('input#car-sort');
  const newSort = `${Math.floor(Math.random() * 89) + 10}`;
  await sortInput.fill(newSort);
  await page.locator('[data-testid="car-save"]').click();
  await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 10_000 });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input#car-sort')).toHaveValue(newSort);
});
```

## Tests to run

```bash
npx nx test admin-services
npx nx test admin --testFile=carriers-list.page.spec.ts
npx nx test admin
npx prettier --write <file>
npx nx lint admin
npx nx build admin --configuration=production
npx nx e2e admin-e2e --grep carrier
```

- `npx nx test admin-services` runs the service spec, which pins the literal URL and proves the Zod parse accepts the backend shape.
- `npx nx test admin --testFile=<spec file name>` runs one spec while you iterate. `testFile` is the Nx Jest executor's option (`node_modules/@nx/jest/src/executors/jest/schema.json`); a `--testPathPattern` flag is not an option of that executor and selects nothing.
- `npx nx test admin` in full runs every admin suite, about seven minutes, and includes `nav.config.spec.ts`, which fails on a permission the backend does not issue.
- `npx prettier --write <file>` on each file you touched, before lint. The root `.eslintrc.js` extends `plugin:prettier/recommended` with `prettier/prettier` set to `error`, so on a fresh file the first thing lint reports is formatting, not code.
- `npx nx lint admin` then reports what is left: an unused import, a physical CSS property, a module-boundary breach.
- `npx nx build admin --configuration=production` is the strict-template check: a binding to a field the schema does not declare passes Jest and fails here.
- `npx nx e2e admin-e2e --grep carrier` runs the two shipping specs against the real API. It needs Docker running; global setup brings up the test Postgres and Redis and seeds them.

## Gotchas

- `nav.config.spec.ts` keeps a hand-written set of backend permissions. A screen behind a new permission fails that spec until the string is added to the set, which is the point: the sidebar must never link to a `/403`.
- A `Translatable` field (`name` on a carrier) is an object, never a string. Render it through `pickTranslation` with the operator's locale; the e2e helper `assertNoObjectObjectLeak` in `apps/admin-e2e/src/modules/_helpers.ts` fails a page that prints `[object Object]`.
- Every admin request carries `X-Resolve-Locale: false` by default (`libs/admin-services/src/shared/http-options.ts`), so the API returns the raw `Translatable` object. Parse it with `translatableSchema`, not `z.string()`.
- The route's `data.permission` and the `permissionGuard(...)` argument are typed separately. They must match by hand.
- The e2e auth fixture throws when `apps/admin-e2e/.playwright-state/storage-state.json` is missing. Run the suite once in full so global setup captures the session before running a single spec with `--grep`.
- A test that edits seeded data must put it back. The journey specs wrap the edit in `try/finally` and restore through the API, because the test database is shared by every spec in the run.
- `npx nx e2e admin-e2e` reuses any listener already on port 53001. A stale API from another shell answers every request with a 404 and the whole suite goes red for no reason in the code.
