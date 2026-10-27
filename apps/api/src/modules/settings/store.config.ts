/**
 * Default store configuration.
 *
 * These values are used as fallbacks when a setting is not found in the database.
 * All settings are organized by group. Each value can be any JSON-serializable type.
 *
 * `settings.service.ts` merges DB over code: a `StoreSetting` row for the same
 * (group, key) always wins. Editing a default here therefore only takes effect
 * on a database that has no row for that key. On an already-seeded database the
 * edit is inert until the row itself is updated.
 *
 * Every default is a neutral value (DR-31). The engine ships brandless:
 * the CLI stepper, a scenario fixture (`test/fixtures/store-configs/`) or the
 * admin settings screens supply the real values at install time. Nothing here
 * may name a client, a real domain, a real currency choice or a country.
 * `store.config.spec.ts` is the gate over that rule.
 *
 * The runtime config the storefront and the admin read (`GET /v1/store/config`)
 * is COMPOSED from these groups by `StoreConfigComposer`; the groups are the
 * storage shape, the fixture schema is the wire shape.
 */

import { LOCALE_CATALOGUE, NEUTRAL_LOCALE_SET } from '@common/locale';

export { LOCALE_CATALOGUE };
export type { CatalogueLocale } from '@common/locale';

export const STORE_CONFIG = {
  // ── General ──────────────────────────────────────────────────────────────

  general: {
    /**
     * Store name as Translatable JSON: { default, ar, fr, en }.
     * The neutral value is replaced at install; it does not translate.
     */
    storeName: {
      default: 'My Store',
      ar: 'My Store',
      fr: 'My Store',
      en: 'My Store',
    },

    /** Public contact email. Empty until the operator supplies it. */
    contactEmail: '',

    /** Public phone number. Empty until the operator supplies it. */
    phone: '',

    /** Store physical address as Translatable JSON. Empty until supplied. */
    address: {
      default: '',
      ar: '',
      fr: '',
      en: '',
    },

    /**
     * Social media links as object: { facebook, instagram, twitter, linkedin, etc. }
     * Each platform is optional.
     */
    socialLinks: {
      facebook: '',
      instagram: '',
      twitter: '',
      linkedin: '',
      tiktok: '',
    },
  },

  // ── Identity ─────────────────────────────────────────────────────────────
  // The keys of the runtime `identity` block that have no home in `general`
  // or `business`. The composer joins the three groups.

  identity: {
    /** Short lowercase brand token used in slugs, asset paths and the CLI banner. */
    brandName: 'store',

    /** One-paragraph store description as Translatable JSON. Feeds llms.txt and SEO. */
    description: {
      default: '',
      ar: '',
      fr: '',
      en: '',
    },
  },

  // ── Brand ────────────────────────────────────────────────────────────────
  // Inputs of the palette generator (E2.1) and the font kit selector. The
  // generated palette is derived, never stored here.

  brand: {
    /** One to three base colours. The generator expands them to the token set. */
    baseColors: {
      primary: '#1F2937',
      secondary: null as string | null,
      accent: null as string | null,
    },

    /** Self-hosted font kit id. `arabic-latin` is required when `ar` is enabled. */
    fontKit: 'arabic-latin',

    /** Asset ids of the uploaded logo and favicon; null means the built-in mark. */
    logoAssetId: null as string | null,
    faviconAssetId: null as string | null,
  },

  // ── Localization ─────────────────────────────────────────────────────────

  localization: {
    /** Array of supported locale codes drawn from LOCALE_CATALOGUE. */
    supportedLocales: [...NEUTRAL_LOCALE_SET.supportedLocales],

    /** Default locale when Accept-Language is not present or unsupported. */
    defaultLocale: NEUTRAL_LOCALE_SET.defaultLocale,

    /** Locales rendered right-to-left. Must be a subset of supportedLocales. */
    rtlLocales: [...NEUTRAL_LOCALE_SET.rtlLocales],

    /** IANA timezone (e.g. "Europe/Paris"). */
    timezone: 'UTC',

    /**
     * Currency configuration: { code, symbol, decimalPlaces }.
     *
     * `decimalPlaces` is the DISPLAY precision; storage is always
     * `@db.Decimal(12, 3)` whatever the currency. The currencies module keeps
     * the enabled roster and the default code in its own rows and mirrors the
     * chosen code here on every write.
     */
    currencyConfig: {
      code: 'USD',
      symbol: '$',
      decimalPlaces: 2,
    },
  },

  // ── Money ────────────────────────────────────────────────────────────────
  // How an amount is written, apart from the currency itself.

  money: {
    /** Where the symbol goes relative to the number. */
    symbolPosition: 'before',

    /** Single characters; must differ from each other. */
    decimalSeparator: '.',
    thousandsSeparator: ',',

    /** Tax mention beside catalogue prices: 'HT', 'TTC' or 'none'. */
    taxDisplay: 'none',

    /** Standard VAT rate as a fraction (0.19 for 19 percent). Zero means no VAT zone. */
    vatRate: 0,
  },

  // ── Domains ──────────────────────────────────────────────────────────────
  // Public origins. Empty means "read the matching environment variable"
  // (`STOREFRONT_PUBLIC_BASE_URL`, `ADMIN_PUBLIC_BASE_URL`, `API_PUBLIC_BASE_URL`),
  // which is what every deploy already sets; the row exists so the stepper
  // and the admin can record them in one place.

  domains: {
    storefront: '',
    admin: '',
    api: '',
  },

  // ── Checkout ─────────────────────────────────────────────────────────────

  checkout: {
    /** Whether guest (unauthenticated) checkout is allowed. */
    guestCheckoutEnabled: true,

    /** Minimum order subtotal required to proceed to checkout. */
    minimumOrderAmount: 0,
  },

  // ── Inventory ────────────────────────────────────────────────────────────

  inventory: {
    /** Default low stock threshold: units below this trigger a "low stock" indicator. */
    defaultLowStockThreshold: 5,

    /** Reservation settings: { expirationMinutes, autoReleaseOnCancel } */
    reservationSettings: {
      expirationMinutes: 15,
      autoReleaseOnCancel: true,
    },
  },

  // ── Orders ───────────────────────────────────────────────────────────────

  orders: {
    /** Order number prefix (e.g. "ORD" gives "ORD-2026-00001"). */
    numberPrefix: 'ORD',

    /** Order number format string (e.g. "{prefix}-{year}-{sequence:5d}"). */
    numberFormat: '{prefix}-{year}-{sequence:5d}',

    /** Cancellation policy as Translatable JSON. */
    cancellationPolicy: {
      default: 'Une commande peut être annulée dans les 24 heures suivant sa validation.',
      ar: 'يمكن إلغاء الطلب خلال 24 ساعة من تأكيده.',
      fr: 'Une commande peut être annulée dans les 24 heures suivant sa validation.',
      en: 'Orders can be cancelled within 24 hours of placement.',
    },
  },

  // ── Returns ──────────────────────────────────────────────────────────────

  returns: {
    /** Return window in days since delivery/purchase. */
    windowDays: 30,

    /** Whether return requests must include photo evidence. */
    requirePhotos: false,

    /** Whether to auto-approve returns within the window (vs. manual review). */
    autoApprove: false,
  },

  // ── Shipping ─────────────────────────────────────────────────────────────

  shipping: {
    /** Default order processing time before shipment (e.g. "1-2 business days"). */
    defaultHandlingTime: '1-2 business days',

    /** Daily cutoff time for same-day dispatch (e.g. "14:00" in HH:mm format). */
    cutOffTime: '14:00',
  },

  // ── Business ─────────────────────────────────────────────────────────────
  // JSON-LD inputs (LocalBusiness / OnlineStore / Organization payloads) per
  // DR-09, plus the seller block of the invoice. Every value is neutral and empty:
  // settings.service merges DB over code silently, so a forgotten row and a
  // configured one look identical, and a plausible wrong value would never be
  // questioned. `store.config.spec.ts` holds every key to being empty.

  business: {
    /** Full legal entity name as Translatable JSON. */
    legalName: { default: '', ar: '', fr: '', en: '' },

    /** Short-form trading name (distinct from general.storeName). Translatable. */
    tradingName: { default: '', ar: '', fr: '', en: '' },

    /**
     * Composed single-line street address per locale. Translatable.
     * schema.org PostalAddress.streetAddress vocabulary, distinct from
     * general.address under bare-key KEY_TO_GROUP lookup.
     */
    streetAddress: { default: '', ar: '', fr: '', en: '' },

    /** City as plain string (non-Translatable). */
    addressLocality: '',

    /** Region or governorate as plain string. */
    addressRegion: '',

    /** Postal code as plain string, empty when the country has none. */
    postalCode: '',

    /** ISO 3166-1 alpha-2 country code. */
    addressCountry: '',

    /** Latitude in decimal degrees. Null until set via SettingsService DB row. */
    geoLat: null as number | null,

    /** Longitude in decimal degrees. Null until set via SettingsService DB row. */
    geoLng: null as number | null,

    /** Telephone in E.164 format. Empty string until set. */
    telephone: '',

    /** Schema.org priceRange shorthand: '$' | '$$' | '$$$'. */
    priceRange: '$$',

    /** Array of ISO 3166-1 alpha-2 codes the merchant ships to. */
    areaServed: [] as string[],

    /**
     * Schema.org businessType: 'OnlineStore' | 'LocalBusiness' | 'Hybrid'.
     * OnlineStore is the only value that is truthful without a counter a
     * customer can walk into, so it is the neutral default.
     */
    businessType: 'OnlineStore',

    /**
     * The seller's tax registration number, printed on the invoice.
     *
     * A plain string, NOT Translatable: an identifier does not translate.
     * Empty until the operator supplies the real value, never an invented value,
     * because a plausible-looking wrong number on a tax document is worse
     * than a visibly missing one.
     */
    taxRegistrationNumber: '',
  },

  // ── Notifications ──────────────────────────────────────────────────────────
  // The global "pause all email" kill-switch (NE6). Read by the NE1 enqueue
  // gate via the same StoreSetting row (group=notifications, key=pauseAll).
  // When true, every non-locked flow is skipped; auth/order (locked) flows are
  // exempt so operators can never lock themselves out.

  notifications: {
    pauseAll: false,
  },

  // ── Appearance ─────────────────────────────────────────────────────────────
  // URL overrides for the logo and favicon, both empty by default so the
  // built-in artwork stays the source until someone deliberately overrides
  // it. Stored as '' rather than null: `StoreSetting.value` is a non-nullable
  // Json column, so every other cleared string setting in this file is '' too.
  // `brand.logoAssetId` is the asset-backed alternative the stepper writes.

  appearance: {
    /** Absolute URL or site-relative path. Empty means the built-in logo. */
    logoUrl: '',

    /** Registered so the admin screen can save it. Not consumed yet. */
    faviconUrl: '',
  },
} as const;

/**
 * Type-safe settings object. Maps group to key to value.
 * Used for IDE autocomplete and type checking.
 */
export type StoreConfig = typeof STORE_CONFIG;
