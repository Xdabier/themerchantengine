import * as z from 'zod';

import { apiResponseSchema } from '../shared/envelope';

/**
 * Public store configuration, from `GET /v1/storefront/config` (plan I phase I1).
 *
 * Everything the storefront has to know about the store before it renders a
 * page. Until this existed the storefront answered all of it from baked
 * constants, so renaming the store, changing its currency or configuring a
 * pixel in the admin changed nothing a customer could see (findings D2, D4,
 * D5, D6, D7).
 *
 * `storeName` is Translatable JSONB on the API side and arrives as a plain
 * string, resolved by the global interceptor against the request's
 * `X-Locale` / `Accept-Language`. Typed as `string` on purpose: an object here
 * means the locale header did not travel, and the caller should see a parse
 * failure and fall back rather than render `[object Object]` as a store name.
 *
 * Every field is optional or defaulted, and the whole schema is `.catch`-free
 * by design: the consumer treats a parse failure as "no config", keeps its
 * baked defaults and renders exactly as it did before. This endpoint must never
 * be able to take the storefront down.
 */

/** A configured social profile URL, keyed by platform. Blank platforms are
 * dropped server-side, so every entry here is meant to be rendered. */
export const storefrontSocialLinksSchema = z.record(z.string(), z.string().min(1));

export type StorefrontSocialLinks = z.infer<typeof storefrontSocialLinksSchema>;

export const storefrontIdentitySchema = z.object({
  storeName: z.string().min(1).nullable().default(null),
  contactEmail: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  socialLinks: storefrontSocialLinksSchema.default({}),
  logoUrl: z.string().nullable().default(null),
});

export type StorefrontIdentity = z.infer<typeof storefrontIdentitySchema>;

export const storefrontCurrencySchema = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
  symbol: z.string().default(''),
  /**
   * Carried because the API sends it, deliberately NOT used to format money.
   * Fraction digits come from ISO 4217 through `Intl` (`lib/money.ts`), so an
   * operator cannot set a precision that loses millimes on a three-decimal
   * currency.
   */
  decimalPlaces: z.number().int().min(0).max(4).default(2),
});

export type StorefrontCurrency = z.infer<typeof storefrontCurrencySchema>;

export const storefrontLocalesSchema = z.object({
  /** Advisory. The storefront intersects this with the locale catalogues it was
   * built with; a locale with no string catalogue can never be rendered. */
  supportedLocales: z.array(z.string().min(2)).default([]),
  defaultLocale: z.string().min(2).nullable().default(null),
});

export type StorefrontLocales = z.infer<typeof storefrontLocalesSchema>;

export const storefrontInventoryConfigSchema = z.object({
  /** Zero disables the low-stock grade entirely, which is a real operator
   * choice rather than a missing value. */
  lowStockThreshold: z.number().int().nonnegative(),
});

export type StorefrontInventoryConfig = z.infer<typeof storefrontInventoryConfigSchema>;

export const storefrontPixelsSchema = z.object({
  googleAnalyticsId: z.string().nullable().default(null),
  metaPixelId: z.string().nullable().default(null),
  tiktokPixelId: z.string().nullable().default(null),
  snapPixelId: z.string().nullable().default(null),
});

export type StorefrontPixels = z.infer<typeof storefrontPixelsSchema>;

export const storefrontConfigSchema = z.object({
  identity: storefrontIdentitySchema,
  currency: storefrontCurrencySchema,
  locales: storefrontLocalesSchema,
  inventory: storefrontInventoryConfigSchema,
  pixels: storefrontPixelsSchema,
});

export type StorefrontConfig = z.infer<typeof storefrontConfigSchema>;

export const storefrontConfigResponseSchema = apiResponseSchema(storefrontConfigSchema);
