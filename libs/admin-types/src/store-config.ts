import { z } from 'zod';
import {
  STORE_CONFIG_BUSINESS_TYPES,
  STORE_CONFIG_FONT_KITS,
  STORE_CONFIG_LOCALES,
  STORE_CONFIG_SYMBOL_POSITIONS,
  STORE_CONFIG_TAX_DISPLAYS,
  storeRuntimeConfigSchema,
  type StoreConfigLocale,
  type StoreRuntimeConfig,
} from '@common/store-config-fixtures/store-config-fixture.schema';
import { apiResponseSchema } from './envelope';

/**
 * Wire contract of `GET /v1/store/config` (plan E1.2, DR-31).
 *
 * Re-exported from the shared schema rather than redeclared, so the admin, the
 * storefront and the API parse one definition and the fixtures under
 * `test/fixtures/store-configs/` cannot drift from what the endpoint serves.
 * The schema validates the unresolved form: Translatable fields as objects with
 * a `default` key. Read the endpoint with `X-Resolve-Locale: false` to parse
 * through it; a resolved read (the storefront's default) carries strings in
 * those fields and is not parsed against this schema (plan E2.2 decides how
 * the storefront consumes it).
 */
export const storeConfigSchema = storeRuntimeConfigSchema;
export type StoreConfig = StoreRuntimeConfig;

export const storeConfigResponseSchema = apiResponseSchema(storeConfigSchema);

export {
  STORE_CONFIG_BUSINESS_TYPES,
  STORE_CONFIG_FONT_KITS,
  STORE_CONFIG_LOCALES,
  STORE_CONFIG_SYMBOL_POSITIONS,
  STORE_CONFIG_TAX_DISPLAYS,
};

export type { StoreConfigLocale };

/** True when the locale renders right-to-left under this config. */
export function isRtlLocale(config: Pick<StoreConfig, 'localization'>, locale: string): boolean {
  return config.localization.rtlLocales.includes(locale as StoreConfigLocale);
}

/** Runtime-only guard for a payload of unknown provenance. */
export function parseStoreConfig(value: unknown): StoreConfig {
  return storeConfigSchema.parse(value);
}

export type StoreConfigResponse = z.infer<typeof storeConfigResponseSchema>;
