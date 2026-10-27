---
title: Add a settings key
description: "Register a store setting: the StoreSetting row it lives in, the key registry and default, the PATCH field, the Redis cache and the event that drops it, the public store config it may join, the admin editor that writes it and the storefront read."
primaryQuery: add a store setting key nestjs prisma ecommerce
updated: 2026-09-09
schema: HowTo
---

## When you need this

You need an operator-editable value: a returns window, a checkout message, a brand colour. A setting is a `StoreSetting` row keyed by `(group, key)` with a JSON value, read through `SettingsService` with a code default behind it. This page shows where a key is registered, how the PATCH lets it in, how the runtime config on `GET /v1/store/config` is composed from the rows and cached, and how the admin and the storefront read it. You end with a key that survives a restart, shows up in the admin, and reaches the storefront within a minute or on the next read.

## Files you touch

- `apps/api/src/modules/settings/settings.constants.ts`: the group and key registry. A key absent here is never returned and never written.
- `apps/api/src/modules/settings/store.config.ts`: the neutral default per key.
- `apps/api/src/modules/settings/dto/update-settings.dto.ts`: the PATCH field with its class-validator bounds.
- `apps/api/src/modules/settings/settings.service.ts` and `apps/api/src/modules/settings/settings.events.ts`: reads, writes and the `store-config.updated` event.
- `apps/api/src/modules/storefront-config/store-config.composer.ts`: the Redis cache, its invalidation, and the composition of `GET /v1/store/config`.
- `libs/shared/common/src/store-config-fixtures/store-config-fixture.schema.ts`: the Zod wire shape of the public config.
- `libs/shared/common/src/store-config/store-config-rows.ts` and `libs/shared/common/src/store-config/store-config-from-rows.ts`: the mapping between the public config and the rows, in both directions.
- `libs/admin-services/src/settings/settings.schemas.ts` and `apps/admin/src/app/features/settings/settings-general.page.ts`: the admin editor.
- `apps/storefront/src/server/store-config.ts`: the storefront read.

## The pattern

### 1. How a key is stored and read

`apps/api/src/modules/settings/settings.service.ts`:

```ts
  async get<T = unknown>(key: string): Promise<T> {
    const group = KEY_TO_GROUP[key];
    if (!group) {
      this.logger.warn({ msg: 'Unknown setting key', key });
      return undefined as T;
    }
    const dbValue = await this.prisma.storeSetting.findUnique({
      where: { group_key: { group, key } },
      select: { value: true },
    });
    if (dbValue) {
      return dbValue.value as T;
    }
    const defaults = STORE_CONFIG[group as SettingsGroup] as Record<string, unknown>;
    return (defaults[key] as T) ?? (undefined as T);
  }
```

A row wins over the default. Editing a default in `store.config.ts` changes nothing on a database that already holds the row.

### 2. Register the key and its default

`apps/api/src/modules/settings/settings.constants.ts`:

```ts
export const SETTINGS_KEYS = {
  [SETTINGS_GROUPS.CHECKOUT]: ['guestCheckoutEnabled', 'minimumOrderAmount'],
  [SETTINGS_GROUPS.RETURNS]: ['windowDays', 'requirePhotos', 'autoApprove'],
```

Add the key to its group here and a neutral default under the same group in `apps/api/src/modules/settings/store.config.ts`. `getGroup` iterates this registry, so a key that has a default but no registry entry is invisible. `apps/api/src/modules/settings/store.config.spec.ts` flattens every default and fails on anything that names a client, a real domain, a country or a currency.

### 3. Open the PATCH

`PATCH /v1/admin/settings` takes a flat body. `apps/api/src/modules/settings/dto/update-settings.dto.ts`:

```ts
  @IsOptional()
  @Type(() => Boolean)
  guestCheckoutEnabled?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Type(() => Number)
  minimumOrderAmount?: number;
```

The service skips a key the registry does not know, with a warning, and never writes it. `apps/api/src/modules/settings/settings.service.ts`:

```ts
        const group = KEY_TO_GROUP[key];
        if (!group) {
          this.logger.warn({ msg: 'Skipping unknown setting key in update', key });
          continue;
        }
        validateSettingKey(key, group);
```

All updates in one PATCH land in one transaction, after `assertConsistent` checks the cross-key rules: `rtlLocales` inside `supportedLocales`, `defaultLocale` inside `supportedLocales`, and the two money separators different.

### 4. The cache and the event that drops it

Every settings write ends with `emitStoreConfigUpdated`. `apps/api/src/modules/settings/settings.events.ts`:

```ts
export const STORE_CONFIG_UPDATED_EVENT = 'store-config.updated';

export interface StoreConfigUpdatedPayload {
  groups: string[];
}
```

The settings module owns no cache and imports none of the modules that do; the event is the only coupling. The composer listens. `apps/api/src/modules/storefront-config/store-config.composer.ts`:

```ts
  @OnEvent(STORE_CONFIG_UPDATED_EVENT, { async: true })
  async onStoreConfigUpdated(payload?: StoreConfigUpdatedPayload): Promise<void> {
    await this.invalidate(touchesMoney(payload?.groups));
  }

  private async invalidate(flushMoney = true): Promise<void> {
    await this.redis.del(STORE_CONFIG_CACHE_KEY, STOREFRONT_PUBLIC_CONFIG_CACHE_KEY);
    if (!flushMoney) return;
    for (const pattern of MONEY_CACHE_KEY_PATTERNS) {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 250);
        cursor = next;
        if (keys.length > 0) await this.redis.del(...keys);
      } while (cursor !== '0');
    }
  }
```

The two keys are `store:config` and `storefront:config`, each with a 60 second TTL, both declared in `apps/api/src/modules/storefront-config/storefront-config.constants.ts`. The TTL only covers a write that bypassed the services, such as a raw seed.

### 5. Put the key on the public config, if the storefront needs it

`GET /v1/store/config` is `@Public()` and serves five groups: identity, brand, localization, money, domains. `apps/api/src/modules/storefront-config/store-config.controller.ts`:

```ts
  @Get('config')
  @Public()
  @RateLimit.StorefrontRead()
  @PublicCacheable(
    STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS,
    'X-Locale, Accept-Language, X-Resolve-Locale',
  )
  getConfig(): Promise<StoreRuntimeConfig> {
    return this.composer.getStoreConfig();
  }
```

A key that must reach the storefront changes three more files, and all three parse or map the same shape:

- `libs/shared/common/src/store-config-fixtures/store-config-fixture.schema.ts`: add the field to the right `z.strictObject`. The composer runs `storeRuntimeConfigSchema.safeParse` on its own output and logs a contract failure.
- `apps/api/src/modules/storefront-config/store-config.composer.ts`: read the group value with the tolerant readers (`str`, `num`, `oneOf`) and fall back to `STORE_CONFIG`.
- `libs/shared/common/src/store-config/store-config-rows.ts` and `libs/shared/common/src/store-config/store-config-from-rows.ts`: the row a config value writes to, and the value a row reads back as. The seed, the installer and `applyStoreConfig` all go through these, so a key can only ever live in one row.

The admin parses the endpoint through the same schema (`libs/admin-types/src/store-config.ts` re-exports it). Read it with `X-Resolve-Locale: false` to get Translatable objects; without that header the interceptor resolves them to strings.

### 6. The admin editor

`libs/admin-services/src/settings/settings.schemas.ts` mirrors the DTO as Zod request schemas. `libs/admin-services/src/settings/settings.service.ts` refuses to send a body the schema emptied:

```ts
    if (Object.keys(body).length === 0) {
      const dropped = Object.keys(input as Record<string, unknown>);
      return throwError(
        () =>
          new Error(
            `SettingsService.update: no recognised settings in the request body. ` +
              `Dropped by updateSettingsRequestSchema: ${dropped.length ? dropped.join(', ') : '(nothing sent)'}.`,
          ),
      );
    }
```

Add the key to the request schema, then to the screen that owns its group. The pages under `apps/admin/src/app/features/settings/` do not map one to one onto the groups:

- `settings-general.page.ts`: `general` (store name, contact email, phone, social links), `identity` (`brandName`, `description`), `business` (legal name, trading name, the address fields, `taxRegistrationNumber`) and the `timezone` key of `localization`.
- `settings-locales.page.ts`: the rest of `localization` (`supportedLocales`, `defaultLocale`, `rtlLocales`).
- `settings-money.page.ts`: `money`, plus `currencyConfig.decimalPlaces`, which lives in `localization`.
- `settings-brand.page.ts`: `brand`.
- `settings-domains.page.ts`: `domains`.
- `settings-appearance.page.ts`: `appearance`.
- `settings-integrations.page.ts` is a signpost that edits nothing, and `settings-home.page.ts` is the navigation grid.

Two groups are edited from outside that directory. `apps/admin/src/app/features/payments/checkout-settings.page.ts` writes the `checkout` group through `PATCH /v1/admin/checkout/settings`, which the checkout module serves from its own upsert on the `checkout` rows in `apps/api/src/modules/checkout/checkout.service.ts`. `apps/admin/src/app/features/notifications/templates-list.page.ts` writes `notifications.pauseAll` through the settings service, so through `PATCH /v1/admin/settings`.

A key in `returns`, `inventory`, `orders` or `shipping` has no admin screen. It is reachable only through `PATCH /v1/admin/settings` (the request schema in `libs/admin-services/src/settings/settings.schemas.ts` already models those keys) until you build a page for it. `settings-general.page.ts` reads from the grouped response and writes flat, and its form is dirty-aware so a PATCH carries only changed keys; copy that shape. The operator-facing view of these screens is in [Store settings](../../../operate/store-settings.md).

### 7. The storefront read

The Nitro layer reads the config before Angular runs, caches it per process for a minute and never throws. `apps/storefront/src/server/store-config.ts`:

```ts
    const res = await fetchImpl(endpoint(), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return NEUTRAL_STOREFRONT_RUNTIME_CONFIG;
    const body = (await res.json()) as { data?: unknown };
    const parsed = storefrontRuntimeConfigSchema.safeParse(body?.data);
    return parsed.success ? parsed.data : NEUTRAL_STOREFRONT_RUNTIME_CONFIG;
```

A failed read falls back to the committed neutral config for five seconds, then retries. `apps/storefront/src/app/services/brand-tokens.service.ts` turns the `brand` group into an inline `<style>` block during SSR.

## Tests to run

```bash
npx nx test api
npx nx test admin
npm run docs:generate
npm run test:scripts
npm run test:e2e
```

`npm run docs:generate` rewrites `docs/site/reference/store-config.md` and `_generated/store-config.schema.json` from the runtime Zod schema this recipe edits, and the settings module page from the DTO. Commit the regenerated files with the key; `npm run test:scripts` and the `docs-generate-check` CI job refuse a stale tree.

`npx nx test api` runs `store.config.spec.ts` (the neutrality gate), `settings.service.spec.ts` and `store-config.composer.spec.ts`. `npx nx test admin` runs the admin settings page specs. `npm run test:e2e` runs `test/settings.e2e-spec.ts` and `test/e2e/store-config.e2e-spec.ts`, which proves a PATCH shows on the next read of `GET /v1/store/config` without waiting for the TTL.

## Gotchas

- A key in `store.config.ts` that is missing from `SETTINGS_KEYS` is never returned and never writable. The registry, not the default, is what exists.
- The admin request schema strips what it does not model. Before the guard above existed, a page saved six keys the schema did not know, the API answered 200, and the screen reported "saved" for values never stored.
- An upsert replaces the whole JSON value. A `{ code }`-only `currencyConfig` used to wipe the symbol and decimal places; `completeCurrencyConfig` now fills the missing halves before the write. Do the same for any object-valued key.
- A write with Prisma directly emits no event. `test/e2e/store-config.e2e-spec.ts` restores its rows and then PATCHes the same values through the settings endpoints so the running API's locale snapshot refreshes.
- The public config is browser-cacheable for the same minute Redis holds it, keyed on the three locale headers. A shared cache that ignores them serves one reader's resolved copy to everyone.
- The storefront's `storefrontRuntimeConfigSchema` is defined in `libs/storefront-types/src/lib/storefront-config/runtime-config.schemas.ts` (`libs/storefront-types/src/index.ts` only re-exports it) and is a variant of the shared shape with Translatables resolved to strings. A new field goes into both, or the storefront falls back to neutral on every read.
