// ── Settings groups ──────────────────────────────────────────────────────────

export const SETTINGS_GROUPS = {
  GENERAL: 'general',
  IDENTITY: 'identity',
  BRAND: 'brand',
  LOCALIZATION: 'localization',
  MONEY: 'money',
  DOMAINS: 'domains',
  CHECKOUT: 'checkout',
  INVENTORY: 'inventory',
  ORDERS: 'orders',
  RETURNS: 'returns',
  SHIPPING: 'shipping',
  BUSINESS: 'business',
  NOTIFICATIONS: 'notifications',
  APPEARANCE: 'appearance',
} as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[keyof typeof SETTINGS_GROUPS];

// ── Settings keys by group ────────────────────────────────────────────────────

export const SETTINGS_KEYS = {
  // General
  [SETTINGS_GROUPS.GENERAL]: ['storeName', 'contactEmail', 'phone', 'address', 'socialLinks'],

  // Identity: the runtime `identity` keys with no home in general or business.
  [SETTINGS_GROUPS.IDENTITY]: ['brandName', 'description'],

  // Brand: palette generator inputs, font kit, uploaded marks.
  [SETTINGS_GROUPS.BRAND]: ['baseColors', 'fontKit', 'logoAssetId', 'faviconAssetId'],

  // Localization
  [SETTINGS_GROUPS.LOCALIZATION]: [
    'supportedLocales',
    'defaultLocale',
    'rtlLocales',
    'timezone',
    'currencyConfig',
  ],

  // Money: how an amount is written. The currency itself is `currencyConfig`
  // plus the currencies module's roster; the display precision is
  // `currencyConfig.decimalPlaces`, so it is not repeated here.
  [SETTINGS_GROUPS.MONEY]: [
    'symbolPosition',
    'decimalSeparator',
    'thousandsSeparator',
    'taxDisplay',
    'vatRate',
  ],

  // Domains: public origins, empty means the environment variable.
  [SETTINGS_GROUPS.DOMAINS]: ['storefront', 'admin', 'api'],

  // Checkout
  [SETTINGS_GROUPS.CHECKOUT]: ['guestCheckoutEnabled', 'minimumOrderAmount'],

  // Inventory
  [SETTINGS_GROUPS.INVENTORY]: ['defaultLowStockThreshold', 'reservationSettings'],

  // Orders
  [SETTINGS_GROUPS.ORDERS]: ['numberPrefix', 'numberFormat', 'cancellationPolicy'],

  // Returns
  [SETTINGS_GROUPS.RETURNS]: ['windowDays', 'requirePhotos', 'autoApprove'],

  // Shipping
  [SETTINGS_GROUPS.SHIPPING]: ['defaultHandlingTime', 'cutOffTime'],

  // Business — surfaces tenant-specific JSON-LD inputs (LocalBusiness / OnlineStore /
  // Organization payloads) per DR-09. streetAddress is renamed from DR-09's illustrative
  // 'address' to avoid collision with general.address under bare-key KEY_TO_GROUP lookup;
  // the new name aligns with schema.org PostalAddress.streetAddress vocabulary.
  [SETTINGS_GROUPS.BUSINESS]: [
    'legalName',
    'tradingName',
    'streetAddress',
    'addressLocality',
    'addressRegion',
    'postalCode',
    'addressCountry',
    'geoLat',
    'geoLng',
    'telephone',
    'priceRange',
    'areaServed',
    'businessType',
    // Link 1 of four. `getGroup` iterates this registry, so a key defined in
    // store.config.ts but absent here is never returned and never writable.
    'taxRegistrationNumber',
  ],

  // Notifications — the global "pause all email" kill-switch (NE6). The same
  // StoreSetting row (group=notifications, key=pauseAll) is read by the NE1
  // enqueue gate (`NOTIFICATIONS_PAUSE_SETTING` in mail.constants.ts), so
  // registering it here is what wires the generic GET/PATCH /v1/admin/settings
  // surface to the live mail gate.
  [SETTINGS_GROUPS.NOTIFICATIONS]: ['pauseAll'],

  // Appearance: the operator's own logo and favicon. The admin appearance
  // page has written these two keys since it shipped, and neither this
  // registry nor `UpdateSettingsDto` had them, so the request schema stripped
  // the body and the page reported "saved" for a value that was never stored.
  // Registering them here is what makes the existing screen real.
  [SETTINGS_GROUPS.APPEARANCE]: ['logoUrl', 'faviconUrl'],
} as const;

// ── Validation ────────────────────────────────────────────────────────────────

/** All valid setting keys across all groups. */
export const ALL_SETTING_KEYS = Object.values(SETTINGS_KEYS).flat();

/** Map key → group for quick lookup. */
export const KEY_TO_GROUP = Object.entries(SETTINGS_KEYS).reduce(
  (map, [group, keys]) => {
    for (const key of keys) {
      map[key] = group as SettingsGroup;
    }
    return map;
  },
  {} as Record<string, SettingsGroup>,
);

/**
 * Validate that a key belongs to a group.
 * Throws if the key-group pair is invalid.
 */
export function validateSettingKey(key: string, group: string): asserts group is SettingsGroup {
  if (!(group in SETTINGS_KEYS)) {
    throw new Error(`Invalid settings group: ${group}`);
  }
  const keys = SETTINGS_KEYS[group as SettingsGroup];
  if (!keys.includes(key as never)) {
    throw new Error(`Invalid key "${key}" for group "${group}"`);
  }
}
