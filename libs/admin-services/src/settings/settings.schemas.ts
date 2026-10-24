import * as z from 'zod';
import { moneySchema, translatableSchema } from '@admin-types';
import { LOCALE_CATALOGUE } from '@common/locale';
import {
  STORE_CONFIG_FONT_KITS,
  STORE_CONFIG_SYMBOL_POSITIONS,
  STORE_CONFIG_TAX_DISPLAYS,
} from '@common/store-config-fixtures/store-config-fixture.schema';

/**
 * Response shape of `GET /v1/admin/settings/locales`.
 *
 * Deliberately looser than the request schemas below: a stored locale the
 * engine no longer ships a catalogue for must still render on the screen that
 * exists to correct it, and a response schema that throws is the "Could not
 * load" bug class.
 */
export const settingsLocalesSchema = z.object({
  supportedLocales: z.array(z.string().min(2)),
  defaultLocale: z.string().min(2),
});
export type SettingsLocales = z.infer<typeof settingsLocalesSchema>;

/** A locale the engine ships strings for. Mirrors the DTO's `IsIn(LOCALE_CATALOGUE)`. */
const catalogueLocaleSchema = z.enum(LOCALE_CATALOGUE);

export const updateLocalesRequestSchema = z
  .object({
    supportedLocales: z.array(catalogueLocaleSchema),
    defaultLocale: catalogueLocaleSchema,
    rtlLocales: z.array(catalogueLocaleSchema).optional(),
  })
  .refine((v) => v.supportedLocales.includes(v.defaultLocale), {
    message: 'defaultLocale must be in supportedLocales',
    path: ['defaultLocale'],
  })
  .refine((v) => (v.rtlLocales ?? []).every((code) => v.supportedLocales.includes(code)), {
    message: 'rtlLocales must be a subset of supportedLocales',
    path: ['rtlLocales'],
  });
export type UpdateLocalesRequest = z.infer<typeof updateLocalesRequestSchema>;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
/** An `https://` origin with no path, or empty to fall back to the environment. */
const HTTPS_ORIGIN = /^$|^https:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/;
const COUNTRY_CODE = /^$|^[A-Z]{2}$/;
/** E.164 with no separators, or empty until set. */
const E164_OR_EMPTY = /^$|^\+[1-9][0-9]{6,14}$/;
const BRAND_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** An IANA zone or UTC, the same shape the wire contract accepts. */
const TIMEZONE = /^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$|^UTC$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Empty, an absolute `http(s)` URL, or a site-relative path. Mirrors the DTO's
 * `APPEARANCE_URL_PATTERN`, which exists to keep a `javascript:` value out of
 * markup that renders the logo.
 */
const APPEARANCE_URL = /^$|^https?:\/\/\S+$|^\/[^\s]*$/;

const appearanceUrlSchema = z
  .string()
  .max(2048)
  .regex(APPEARANCE_URL, 'must be empty, an absolute http(s) URL, or a site-relative path');

/**
 * A Translatable settings field, with the bounds `SettingsTranslatableDto`
 * carries: `default` is required, non-empty and at most 500 characters.
 *
 * The shared `translatableSchema` is deliberately unbounded, because it also
 * models catalogue text with its own limits. Reusing it here made the admin
 * accept a 600-character store name that the API then refused, which is the
 * looser-than-the-DTO half of the same defect this schema exists to close.
 */
const settingsTranslatableSchema = translatableSchema.extend({
  default: z.string().min(1).max(500),
});

const hexColorSchema = z.string().regex(HEX_COLOR, 'must be a six-digit hex colour');
const httpsOriginSchema = z
  .string()
  .regex(HTTPS_ORIGIN, 'must be an https:// origin with no path, or empty');
/** A UUID, or `null` to clear the reference. */
const assetIdSchema = z.union([z.string().regex(UUID_V4, 'must be a UUID'), z.null()]);

/**
 * The admin-side mirror of `UpdateSettingsDto`
 * (`apps/api/src/modules/settings/dto/update-settings.dto.ts`).
 *
 * It has to model every key the DTO accepts, and it has to model them with the
 * same bounds. Zod strips what it does not know, and `SettingsService.update`
 * throws only when the strip empties the body, so an unmodelled key is a field
 * that saves nothing and reports success. A bound that is looser here than on
 * the DTO is the same defect one layer down: the screen accepts the value and
 * the API answers 400.
 *
 * `settings.schemas.spec.ts` walks every key and every bound.
 */
export const updateSettingsRequestSchema = z.object({
  // General
  storeName: settingsTranslatableSchema.optional(),
  contactEmail: z.string().email().optional(),
  phone: z.string().regex(E164_OR_EMPTY, 'must be E.164 with no separators, or empty').optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  socialLinks: z.record(z.string(), z.unknown()).optional(),
  // Localization
  supportedLocales: z.array(catalogueLocaleSchema).optional(),
  defaultLocale: catalogueLocaleSchema.optional(),
  timezone: z
    .string()
    .regex(TIMEZONE, 'must be an IANA zone such as Europe/Paris, or UTC')
    .optional(),
  rtlLocales: z.array(catalogueLocaleSchema).optional(),
  // Identity
  brandName: z
    .string()
    .regex(BRAND_SLUG, 'must be a lowercase slug of at most 40 characters')
    .optional(),
  description: settingsTranslatableSchema.optional(),
  // Brand
  baseColors: z
    .object({
      primary: hexColorSchema,
      secondary: hexColorSchema.nullable(),
      accent: hexColorSchema.nullable(),
    })
    .optional(),
  fontKit: z.enum(STORE_CONFIG_FONT_KITS).optional(),
  logoAssetId: assetIdSchema.optional(),
  faviconAssetId: assetIdSchema.optional(),
  // Money
  symbolPosition: z.enum(STORE_CONFIG_SYMBOL_POSITIONS).optional(),
  decimalSeparator: z.string().length(1).optional(),
  thousandsSeparator: z.string().length(1).optional(),
  taxDisplay: z.enum(STORE_CONFIG_TAX_DISPLAYS).optional(),
  vatRate: z
    .number()
    .min(0)
    .max(1)
    .refine((n) => Math.round(n * 1e4) === n * 1e4, 'at most four decimal places')
    .optional(),
  currencyConfig: z
    .object({
      code: z.string().regex(/^[A-Z]{3}$/),
      symbol: z.string().max(8).optional(),
      // Three, not four: storage is Decimal(12, 3) and the DTO caps there.
      decimalPlaces: z.number().int().min(0).max(3).optional(),
    })
    .optional(),
  // Domains. Empty means "read the environment variable", which is why the
  // pattern admits it rather than requiring a URL.
  storefront: httpsOriginSchema.optional(),
  admin: httpsOriginSchema.optional(),
  api: httpsOriginSchema.optional(),
  guestCheckoutEnabled: z.boolean().optional(),
  minimumOrderAmount: moneySchema.optional(),
  /**
   * Link 4 of four: the only admin-side mirror of the settings contract.
   *
   * The seller's tax registration number, which a French *facture* legally
   * requires. Plain string, not Translatable — a matricule is an identifier.
   */
  taxRegistrationNumber: z.string().max(64).optional(),
  legalName: settingsTranslatableSchema.optional(),
  tradingName: settingsTranslatableSchema.optional(),
  streetAddress: settingsTranslatableSchema.optional(),
  addressLocality: z.string().max(120).optional(),
  addressRegion: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
  addressCountry: z
    .string()
    .regex(COUNTRY_CODE, 'must be an ISO 3166-1 alpha-2 code, or empty')
    .optional(),
  defaultLowStockThreshold: z.number().int().nonnegative().optional(),
  reservationSettings: z.record(z.string(), z.unknown()).optional(),
  numberPrefix: z.string().optional(),
  numberFormat: z.string().optional(),
  cancellationPolicy: z.record(z.string(), z.unknown()).optional(),
  windowDays: z.number().int().nonnegative().optional(),
  requirePhotos: z.boolean().optional(),
  autoApprove: z.boolean().optional(),
  defaultHandlingTime: z.string().optional(),
  cutOffTime: z.string().optional(),
  // Notifications (NE6) — global "pause all email" kill-switch. Backed by the
  // StoreSetting(group=notifications,key=pauseAll) row the mail gate reads.
  pauseAll: z.boolean().optional(),
  /**
   * Appearance. Present here because Zod strips unknown keys before the PATCH
   * is sent: the appearance page has written these two since it shipped, and
   * without them the request body arrived empty and the API answered 200 with
   * nothing changed, which the page rendered as "saved".
   */
  logoUrl: appearanceUrlSchema.optional(),
  faviconUrl: appearanceUrlSchema.optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

/**
 * Grouped response shape: the backend returns
 * `{ general: {...}, localization: {...}, checkout: {...}, inventory: {...},
 *   orders: {...}, returns: {...}, shipping: {...} }` (see
 * `apps/api/src/modules/settings/settings.service.ts:108` + `SETTINGS_GROUPS`).
 * We validate the outer group-key → group-value-map shape so a wholesale
 * response regression is caught at parse time; inner keys stay `unknown`
 * because the key set is dynamic (registered via `SETTINGS_KEYS`) and
 * consumers narrow per-screen when they read a specific key.
 */
export const settingsResponseSchema = z.record(z.string(), z.record(z.string(), z.unknown()));
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
