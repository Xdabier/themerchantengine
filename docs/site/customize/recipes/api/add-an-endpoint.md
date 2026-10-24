---
title: Add an endpoint
description: "Add a route to an existing API module: the class-validator DTO, the controller method with its guard and OpenAPI summary, the service method, the shared admin route constant, and the unit and Supertest specs, with the carriers module as the worked example."
primaryQuery: add an endpoint nestjs ecommerce api
updated: 2026-09-09
schema: HowTo
---

## When you need this

You have a module under `apps/api/src/modules/` and need one more route on it: a new admin action, a new customer read, a new filter. This page walks the route the carriers module already ships, `POST /v1/admin/carriers`, from the DTO to the e2e spec, so you can copy its shape. You end with a route that validates its body, refuses the wrong caller, appears in the OpenAPI document with a summary, and has a unit spec and a Supertest spec behind it. A new module is a different recipe: [Add a module](add-a-module.md).

## Files you touch

- `libs/shared/admin-routes/src/index.ts`: the path of an admin route, read by the NestJS controller and the Angular admin service alike. A customer route keeps its path in the controller.
- `apps/api/src/modules/carriers/dto/create-carrier.dto.ts`: the request body, one class-validator decorator per property.
- `apps/api/src/modules/carriers/carriers.controller.ts`: the method, its `@Permissions` key, its rate limit and its `@ApiOperation` summary.
- `apps/api/src/modules/carriers/carriers.service.ts`: the Prisma work and the domain errors.
- `apps/api/src/modules/carriers/carriers.service.spec.ts`: the unit spec, Prisma mocked.
- `apps/api/test/currencies.e2e-spec.ts`: the shape of a Supertest spec. Yours goes next to it or under `test/e2e/`; both are roots of `test/jest.e2e.config.ts`.
- `libs/admin-services/src/carriers/carriers.service.ts`: the admin's HTTP client, when the route is an admin route.

## The pattern

### 1. Name the path once

Every `/v1/admin/*` path lives in one tree. `base` is the controller's `@Controller` argument; the other keys are method-relative.

`libs/shared/admin-routes/src/index.ts`:

```ts
  carriers: {
    base: 'v1/admin/carriers',
    byId: ':id',
  },
```

The `v1` is part of the path string. `apps/api/src/main.ts` adds a global prefix only when `API_GLOBAL_PREFIX` is set (the admin's same-origin proxy uses `api`) and keeps `health` outside it.

### 2. Write the DTO

`apps/api/src/modules/carriers/dto/create-carrier.dto.ts`:

```ts
export const CARRIER_PROVIDERS = ['dhl', 'fedex', 'ups', 'aramex', 'manual'] as const;

export class CreateCarrierDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9_]+$/)
  code!: string;

  @ValidateNested()
  @Type(() => CarrierTranslatableDto)
  name!: CarrierTranslatableDto;

  @IsIn(CARRIER_PROVIDERS)
  provider!: CarrierProvider;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ... services, zones, sortOrder and config are cut here
}
```

The excerpt is abridged. The real class at `apps/api/src/modules/carriers/dto/create-carrier.dto.ts:37-63` also declares `services` (string array, max 50), `zones` (two-letter country codes, max 250), `sortOrder` (non-negative integer) and `config` (a plain object); step 4 reads `dto.config`. `CarrierTranslatableDto` is the module-local class in `apps/api/src/modules/carriers/dto/translatable.dto.ts`, which extends the common `TranslatableLocaleKeysDto` from `apps/api/src/common/dto/translatable-locale-keys.dto.ts` with a required `default` string.

The global pipe in `apps/api/src/main.ts` decides what an undecorated property does:

```ts
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
```

A property with no decorator is not stripped quietly; the request is a 400 `VALIDATION_ERROR`. Admin and customer bodies are separate classes, never one shared DTO.

### 3. Add the controller method

`apps/api/src/modules/carriers/carriers.controller.ts`:

```ts
@ApiTags('carriers')
@Controller(ADMIN_API_ROUTES.carriers.base)
export class CarriersController {
  constructor(private readonly service: CarriersService) {}

  @Post()
  @Permissions('carriers:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create carrier' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Code already in use' })
  create(@Body() dto: CreateCarrierDto) {
    return this.service.create(dto);
  }
}
```

No `@UseGuards` here. The guard chain is registered once in `apps/api/src/app.module.ts`, in this order: throttler, session, permissions, owner.

```ts
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: OwnerGuardGuard },
```

`@Permissions('carriers:create')` is what makes the route an admin route, and the key must exist in the catalogue ([Add a permission](add-a-permission.md)). The `summary` is the operation title in the OpenAPI document that `SwaggerModule` serves at `/docs`, and the public API reference is generated from that document, so write it as a title.

A customer route carries `@OwnerGuard()` instead, as the order list does in `apps/api/src/modules/orders/orders.controller.ts`:

```ts
  @Get()
  @OwnerGuard()
  @RateLimit.StorefrontRead()
```

`OwnerGuardGuard` lives in `libs/shared/common/src/guards/owner-guard.guard.ts` and only asserts that `req.user.id` is present. The service compares the row's owner to that id; that is where ownership is enforced. An anonymous route carries `@Public()`. A route that serves both signed-in and guest callers carries `@OptionalAuth()` and never `@OwnerGuard()`, because the owner guard throws on every anonymous request one guard later.

### 4. Write the service method

`apps/api/src/modules/carriers/carriers.service.ts`:

```ts
  async create(dto: CreateCarrierDto): Promise<CarrierResult> {
    const existing = await this.prisma.carrier.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`Carrier code "${dto.code}" already in use`);

    const row = await this.prisma.carrier.create({
      data: {
        code: dto.code,
        name: dto.name as never,
        provider: dto.provider,
        isActive: dto.isActive ?? false,
        config: (dto.config ?? {}) as never,
      },
    });
    return this.toResult(row);
  }
```

`dto.config` is one of the properties the abridged DTO excerpt in step 2 leaves out. Return the payload itself. `ApiResponseInterceptor`, registered in `apps/api/src/main.ts`, wraps it into `{ data }`, and a `{ data, meta }` object from a list method passes through as the paginated envelope. Reads filter `deletedAt: null`; a delete sets `deletedAt` and never removes the row.

### 5. Unit spec

`apps/api/src/modules/carriers/carriers.service.spec.ts`:

```ts
describe('CarriersService', () => {
  let service: CarriersService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CarriersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CarriersService);
  });

  it('create rejects duplicate code with 409', async () => {
    prisma.carrier.findUnique.mockResolvedValue({ id: 'x' });
    await expect(
      service.create({ code: 'dhl_express', name: { default: 'X' }, provider: 'dhl' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
```

`makePrismaMock` is not a shared helper. It is a function declared at the top of `apps/api/src/modules/carriers/carriers.service.spec.ts:24-35` that returns `{ carrier: { findUnique: jest.fn(), ... } }`; write your own in your spec with the delegates your service calls.

### 6. Supertest spec

The backend e2e suite runs out of process: `test/e2e-global-setup.ts` pushes the schema, reseeds the test database and boots a bundled API on port 53001, and the specs are HTTP clients. `apps/api/test/currencies.e2e-spec.ts` shows the shape:

```ts
import { api, createTestPrisma, loginAs, ADMIN } from '../../../test/e2e/helpers';

describe('Currencies (e2e)', () => {
  let adminCookie: string;

  beforeAll(async () => {
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  });

  it('returns the configured store currency plus the enabled set', async () => {
    const res = await api()
      .get('/v1/admin/currencies/store')
      .set('Cookie', adminCookie)
      .expect(200);
```

`loginAs` signs in through Better Auth and returns the session cookie; there is no bearer token. Cover the 401 with no cookie, the 403 with a role that lacks the key, the 400 on a bad body and the happy path. No mocks at this layer.

The 403 user comes from `createUserWithRole` in `test/e2e/helpers.ts:148-158`. It takes a `PrismaClient` first, so open one with `createTestPrisma()` from the same file, then pass `{ email, password, role, permissions? }`; `role` is one of `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `SUPPORT` or `CUSTOMER`, and a `permissions` array creates a custom `Role` with exactly those keys. The skeleton, in the shape `apps/api/test/currencies.e2e-spec.ts` uses:

```ts
import { api, createTestPrisma, createUserWithRole, loginAs, ADMIN } from '../../../test/e2e/helpers';

describe('Carriers (e2e)', () => {
  const prisma = createTestPrisma();
  let adminCookie: string;
  let limitedCookie: string;

  beforeAll(async () => {
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    const email = 'no-carriers@e2e-carriers.test';
    await createUserWithRole(prisma, {
      email,
      password: 'StrongPass1',
      role: 'SUPPORT',
      permissions: ['orders:view'],
    });
    limitedCookie = await loginAs(email, 'StrongPass1');
  });

  afterAll(() => prisma.$disconnect());

  it('401 without a session', () => api().post('/v1/admin/carriers').send({}).expect(401));

  it('403 without carriers:create', () =>
    api().post('/v1/admin/carriers').set('Cookie', limitedCookie).send({}).expect(403));

  it('400 on a body the DTO refuses', () =>
    api().post('/v1/admin/carriers').set('Cookie', adminCookie).send({ code: 'X' }).expect(400));

  it('201 on a valid body', () =>
    api()
      .post('/v1/admin/carriers')
      .set('Cookie', adminCookie)
      .send({ code: 'e2e_carrier', name: { default: 'E2E' }, provider: 'manual' })
      .expect(201));
});
```

Delete the rows you created in `afterAll`; the seed only resets the database at the start of the run.

### 7. The admin client, for an admin route

`libs/admin-services/src/carriers/carriers.service.ts` builds its URL from the same constant and parses the response through the Zod schema in `libs/admin-services/src/carriers/carriers.schemas.ts`:

```ts
const CARRIERS = ADMIN_API_ROUTES.carriers;

  create(input: CreateCarrierRequest): Observable<Carrier> {
    const body = createCarrierRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(CARRIERS.base)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => carrierSchema.parse(envelope(raw))));
  }
```

`adminRoute(base, sub = '')` in `libs/shared/admin-routes/src/index.ts:30` joins the controller base and a method-relative segment; with no second argument it returns the base alone. A route with a `:param` placeholder goes through `fillRoute(template, params)` from the same file first, which URL-encodes each value and throws on a missing one. The same service's `get(id)` shows both together:

```ts
        `${this.apiBase}/${adminRoute(CARRIERS.base, fillRoute(CARRIERS.byId, { id }))}`,
```

## Tests to run

```bash
npx nx test api
npx nx lint api
npm run docs:generate
npm run test:scripts
npm run docker:up
npm run test:e2e
```

`npm run docs:generate` rewrites the public reference under `docs/site/reference/` from the code: the new route lands on its module page, and an admin route with `@Permissions` also lands on the permissions page. Commit the regenerated files with the endpoint; `npm run test:scripts` and the `docs-generate-check` CI job refuse a tree where they are stale.

`npx nx test api` runs the unit specs and the four top-level guard specs under `apps/api/src/`: `permission-key-drift.spec.ts` (fails on a `@Permissions` key outside the catalogue), `permission-catalogue.parity.spec.ts`, `permission-reconcile.spec.ts` and `spec-key.parity.spec.ts`. `npx nx lint api` lints `apps/api` and `test/`. `npm run docker:up` starts the dev and test Postgres and Redis. `npm run test:e2e` builds the API and runs every `*.e2e-spec.ts` against the test database on port 55433.

## Gotchas

- `forbidNonWhitelisted: true` means a Translatable body needs a decorated property per locale. `apps/api/src/common/dto/translatable-locale-keys.dto.ts` declares one property per registry locale and refuses a value for a locale the store has not enabled. A new registry entry is enough; never rely on an index signature.
- `PermissionsGuard` opens a route with no `@Permissions` to any authenticated user, and a storefront customer is an authenticated user. An admin route without the decorator is reachable from a customer account.
- The e2e harness reuses whatever already listens on port 53001. A stale server started with `API_GLOBAL_PREFIX=api` answers `/health` but 404s every route, so `test/e2e-global-setup.ts` probes a real route before reusing it. Stop the old process tree, not just the port listener.
- Spec files pin the literal URL on purpose. Do not migrate a spec onto `ADMIN_API_ROUTES`; the literal is what proves the constant resolves to the right path.
- A sort field comes from an allowlist constant per endpoint, never from the query string. `apps/api/src/modules/carriers/carriers.service.ts` orders by a fixed `sortOrder, createdAt`.
- Every response is `Cache-Control: no-store` and Express ETag is disabled. A cacheable public read says so with `@PublicCacheable`, as `apps/api/src/modules/storefront-config/store-config.controller.ts` does.
- The seed the e2e run replays is destructive outside the test database and refuses any other database name without `SEED_DEV_OK=1`.
