import * as z from 'zod';
import { BRAND_TOKEN_KEYS } from '../brand/palette';
import {
  FONT_KITS,
  fontKitCoversLocale,
  isRegistryLocale,
  registryLocaleCodes,
  type FontKit,
  type RegistryLocale,
} from '../locale/locale-registry';

/**
 * The runtime store config (DR-31, plan E1.1) and the scenario fixture that
 * carries one (plan E0.4).
 *
 * Two schemas share one shape:
 *
 * - `storeRuntimeConfigSchema` is the WIRE contract of `GET /v1/store/config`.
 *   Every key is present, formats are checked when a value is set, and empty
 *   strings are allowed because a freshly installed store has not filled
 *   everything in yet.
 * - `storeConfigFixtureSchema` adds the `fixture` block and refuses empties:
 *   a fixture is a complete store, so every locale value, the contact pair,
 *   the address and the three https origins must be real.
 *
 * The E1.1 settings groups store this shape flat; `storeConfigSettingRows`
 * in `../store-config/store-config-rows.ts` is the one mapping between the two.
 */

/** The language registry's codes; the registry is the one list (DR-33). */
export const STORE_CONFIG_LOCALES: readonly RegistryLocale[] = registryLocaleCodes();
export type StoreConfigLocale = RegistryLocale;

export const STORE_CONFIG_FONT_KITS = FONT_KITS;
export type StoreConfigFontKit = FontKit;

/** Kits that ship an Arabic face, read from the registry's script data. */
export const ARABIC_CAPABLE_FONT_KITS: readonly StoreConfigFontKit[] = FONT_KITS.filter((kit) =>
  fontKitCoversLocale(kit, 'ar'),
);

export const STORE_CONFIG_SYMBOL_POSITIONS = ['before', 'after'] as const;
export const STORE_CONFIG_TAX_DISPLAYS = ['HT', 'TTC', 'none'] as const;
export const STORE_CONFIG_BUSINESS_TYPES = ['OnlineStore', 'LocalBusiness', 'Hybrid'] as const;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const E164_PHONE = /^\+[1-9][0-9]{6,14}$/;
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+$/;
/** Any origin the engine can be reached on, `http://localhost:53300` included. */
const ANY_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/;
const TIMEZONE = /^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$|^UTC$/;

const localeCode = z.string().refine((value): value is RegistryLocale => isRegistryLocale(value), {
  message: 'unknown locale',
});

/** A pattern that also accepts the empty string a fresh install carries. */
const emptyOr = (pattern: RegExp): z.ZodString =>
  z.string().regex(new RegExp(`^$|${pattern.source}`));

/** A Translatable object: `default` plus one key per configured locale. */
const translatable = z.strictObject({ default: z.string() }).catchall(z.string());

const runtimeShape = {
  identity: z.strictObject({
    storeName: translatable,
    brandName: z.string(),
    description: translatable,
    legalName: translatable,
    contact: z.strictObject({
      email: z.string(),
      phone: emptyOr(E164_PHONE),
    }),
    address: z.strictObject({
      street: translatable,
      locality: z.string(),
      region: z.string(),
      postalCode: z.string().nullable(),
      country: emptyOr(COUNTRY_CODE),
    }),
    areaServed: z.array(z.string().regex(COUNTRY_CODE)),
    businessType: z.enum(STORE_CONFIG_BUSINESS_TYPES),
  }),
  brand: z.strictObject({
    baseColors: z.strictObject({
      primary: z.string().regex(HEX_COLOR),
      secondary: z.string().regex(HEX_COLOR).nullable(),
      accent: z.string().regex(HEX_COLOR).nullable(),
    }),
    fontKit: z.enum(STORE_CONFIG_FONT_KITS),
    logoAssetId: z.string().uuid().nullable(),
    faviconAssetId: z.string().uuid().nullable(),
    /**
     * The expansion of `baseColors` into the full storefront token set, with
     * every contrast move the generator made recorded beside it (plan E2.1).
     *
     * Optional because it is derived, not stored: the endpoint composes it on
     * every read, so it can never go stale against the colours it came from,
     * and the scenario fixtures carry only the input they are fixtures of.
     */
    generatedPalette: z
      .strictObject({
        // Keyed to the declared token names, not to any string: the storefront
        // interpolates each key verbatim into an inline `:root` block, so an
        // unkeyed record would let a settings row put arbitrary text in a
        // stylesheet. It also rejects a partial palette, which would leave a
        // page resolving some tokens and not others.
        tokens: z.record(z.enum(BRAND_TOKEN_KEYS), z.string().regex(HEX_COLOR)),
        adjustments: z.array(
          z.strictObject({
            token: z.string(),
            reason: z.enum(['contrast', 'no-accent-given', 'accent-from-secondary']),
            from: z.string(),
            to: z.string(),
            against: z.string().optional(),
            ratio: z.number().optional(),
          }),
        ),
      })
      .optional(),
  }),
  localization: z.strictObject({
    supportedLocales: z.array(localeCode).min(1),
    defaultLocale: localeCode,
    rtlLocales: z.array(localeCode),
    timezone: z.string().regex(TIMEZONE),
  }),
  money: z.strictObject({
    currencyCode: z.string().regex(CURRENCY_CODE),
    symbol: z.string().min(1),
    symbolPosition: z.enum(STORE_CONFIG_SYMBOL_POSITIONS),
    decimalSeparator: z.string().length(1),
    thousandsSeparator: z.string().length(1),
    displayPrecision: z.number().int().min(0).max(3),
    taxDisplay: z.enum(STORE_CONFIG_TAX_DISPLAYS),
    vatRate: z.number().min(0).max(1),
  }),
  domains: z.strictObject({
    storefront: emptyOr(ANY_ORIGIN),
    admin: emptyOr(ANY_ORIGIN),
    api: emptyOr(ANY_ORIGIN),
  }),
};

type RuntimeShape = z.infer<z.ZodObject<typeof runtimeShape>>;

/**
 * The unrefined field map, exported so a consumer can build a variant of the
 * contract without restating it. Zod 4 refuses `.omit()` on a schema that
 * carries refinements, and the storefront needs one field replaced (its read
 * resolves the Translatables to strings), so it composes from this and
 * re-applies {@link refineStoreRuntimeConfig}.
 */
export const STORE_RUNTIME_CONFIG_SHAPE = runtimeShape;

/**
 * Rules that hold for the wire contract and the fixture alike.
 *
 * Typed on the three groups it actually reads rather than the whole config, so
 * a variant of the contract that reshapes another group can still re-apply it.
 */
export function refineStoreRuntimeConfig(
  config: Pick<RuntimeShape, 'localization' | 'brand' | 'money'>,
  ctx: z.RefinementCtx,
): void {
  const { supportedLocales, defaultLocale, rtlLocales } = config.localization;
  if (!supportedLocales.includes(defaultLocale)) {
    ctx.addIssue({
      code: 'custom',
      path: ['localization', 'defaultLocale'],
      message: 'defaultLocale must be one of supportedLocales',
    });
  }
  for (const locale of rtlLocales) {
    if (!supportedLocales.includes(locale)) {
      ctx.addIssue({
        code: 'custom',
        path: ['localization', 'rtlLocales'],
        message: `rtl locale ${locale} is not in supportedLocales`,
      });
    }
  }
  for (const locale of supportedLocales) {
    if (!fontKitCoversLocale(config.brand.fontKit, locale)) {
      ctx.addIssue({
        code: 'custom',
        path: ['brand', 'fontKit'],
        message: `a config that enables ${locale} must select a font kit that covers its script`,
      });
    }
  }
  if (config.money.decimalSeparator === config.money.thousandsSeparator) {
    ctx.addIssue({
      code: 'custom',
      path: ['money', 'thousandsSeparator'],
      message: 'decimal and thousands separators must differ',
    });
  }
}

export const storeRuntimeConfigSchema = z
  .strictObject(runtimeShape)
  .superRefine(refineStoreRuntimeConfig);
export type StoreRuntimeConfig = z.infer<typeof storeRuntimeConfigSchema>;

export const storeConfigFixtureSchema = z
  .strictObject({
    fixture: z.strictObject({
      id: z.string().regex(/^[a-z0-9-]+$/),
      description: z.string().min(1),
    }),
    ...runtimeShape,
  })
  .superRefine((config, ctx) => {
    refineStoreRuntimeConfig(config, ctx);

    const { supportedLocales } = config.localization;
    const nonEmpty = (value: string, path: (string | number)[]): void => {
      if (!value) ctx.addIssue({ code: 'custom', path, message: 'must not be empty in a fixture' });
    };
    for (const [field, value] of Object.entries({
      storeName: config.identity.storeName,
      description: config.identity.description,
      legalName: config.identity.legalName,
      street: config.identity.address.street,
    })) {
      nonEmpty(value.default, ['identity', field, 'default']);
      for (const locale of supportedLocales) {
        if (!(locale in value)) {
          ctx.addIssue({
            code: 'custom',
            path: ['identity', field],
            message: `missing ${locale} value`,
          });
        } else {
          nonEmpty(value[locale], ['identity', field, locale]);
        }
      }
    }
    nonEmpty(config.identity.brandName, ['identity', 'brandName']);
    if (!z.string().email().safeParse(config.identity.contact.email).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['identity', 'contact', 'email'],
        message: 'invalid email',
      });
    }
    nonEmpty(config.identity.contact.phone, ['identity', 'contact', 'phone']);
    nonEmpty(config.identity.address.locality, ['identity', 'address', 'locality']);
    nonEmpty(config.identity.address.region, ['identity', 'address', 'region']);
    nonEmpty(config.identity.address.country, ['identity', 'address', 'country']);
    if (config.identity.address.postalCode === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['identity', 'address', 'postalCode'],
        message: 'use null, not an empty string, for a country without postal codes',
      });
    }
    if (config.identity.areaServed.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['identity', 'areaServed'],
        message: 'must list a country',
      });
    }
    for (const key of ['storefront', 'admin', 'api'] as const) {
      if (!HTTPS_ORIGIN.test(config.domains[key])) {
        ctx.addIssue({
          code: 'custom',
          path: ['domains', key],
          message: 'a fixture domain must be an https:// origin',
        });
      }
    }
  });

export type StoreConfigFixture = z.infer<typeof storeConfigFixtureSchema>;

/** The runtime config a fixture describes, without the `fixture` block. */
export function runtimeConfigOfFixture(fixture: StoreConfigFixture): StoreRuntimeConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the rest pattern omits the key
  const { fixture: _fixture, ...runtime } = fixture;
  return runtime;
}
