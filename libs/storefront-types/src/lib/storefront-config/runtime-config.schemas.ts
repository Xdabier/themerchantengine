import { z } from 'zod';
import {
  refineStoreRuntimeConfig,
  STORE_RUNTIME_CONFIG_SHAPE,
  type StoreConfigLocale,
} from '@common/store-config-fixtures';
import { NEUTRAL_STORE_CONFIG } from '@common/store-config';
import { generatePalette } from '@common/brand';

import { apiResponseSchema } from '../shared/envelope';

/**
 * The runtime store config as the storefront receives it, from
 * `GET /v1/store/config` (DR-31, plan E1.2, consumed here in E2.2).
 *
 * The shared schema in `libs/shared/common` declares the stored form, where
 * every Translatable field is an object with a `default` key. The storefront
 * reads the endpoint **resolved**: it sends no `X-Resolve-Locale: false`, so
 * the interceptor collapses those objects to the string for the request
 * locale before they leave the API. That is the right read for a page, which
 * wants one language and never a map of them, and it is why this schema
 * exists instead of the storefront parsing the shared one: the four
 * Translatable fields arrive as strings here.
 *
 * An object in one of them means the locale headers did not travel, and the
 * parse must fail so the caller falls back rather than rendering
 * `[object Object]` as a store name.
 *
 * Everything else is the shared shape, taken from it rather than restated, so
 * a field added to the endpoint cannot silently go missing on this side.
 */
const resolvedIdentity = STORE_RUNTIME_CONFIG_SHAPE.identity
  .omit({ storeName: true, description: true, legalName: true, address: true })
  .extend({
    storeName: z.string(),
    description: z.string(),
    legalName: z.string(),
    address: STORE_RUNTIME_CONFIG_SHAPE.identity.shape.address
      .omit({ street: true })
      .extend({ street: z.string() }),
  });

export const storefrontRuntimeConfigSchema = z
  .strictObject({ ...STORE_RUNTIME_CONFIG_SHAPE, identity: resolvedIdentity })
  .superRefine(refineStoreRuntimeConfig);

export type StorefrontRuntimeConfig = z.infer<typeof storefrontRuntimeConfigSchema>;

export type { StoreConfigLocale };

export const storefrontRuntimeConfigResponseSchema = apiResponseSchema(
  storefrontRuntimeConfigSchema,
);

/**
 * What the storefront renders when the config endpoint has not answered: the
 * same neutral config a fresh engine boots on, resolved to the storefront's
 * shape and carrying the palette the generator makes of it.
 *
 * It exists so no surface has to invent a currency, a locale or a colour of
 * its own for the gap before the first read. It is the one committed default,
 * shared by the Angular service and the Nitro-side read, so the server and the
 * client never disagree about what "unconfigured" looks like.
 */
export const NEUTRAL_STOREFRONT_RUNTIME_CONFIG: StorefrontRuntimeConfig = Object.freeze({
  ...NEUTRAL_STORE_CONFIG,
  identity: {
    ...NEUTRAL_STORE_CONFIG.identity,
    storeName: NEUTRAL_STORE_CONFIG.identity.storeName.default,
    description: NEUTRAL_STORE_CONFIG.identity.description.default,
    legalName: NEUTRAL_STORE_CONFIG.identity.legalName.default,
    address: {
      ...NEUTRAL_STORE_CONFIG.identity.address,
      street: NEUTRAL_STORE_CONFIG.identity.address.street.default,
    },
  },
  brand: {
    ...NEUTRAL_STORE_CONFIG.brand,
    generatedPalette: generatePalette(NEUTRAL_STORE_CONFIG.brand.baseColors),
  },
});
