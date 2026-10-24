/**
 * The language registry (DR-33, plan LG1): the one place that says what the
 * engine knows about each language it can run a store in. Every list of
 * locales elsewhere (config schema, DTO checks, mail, invoices, search, fonts)
 * reads this file instead of restating `fr`, `en`, `ar`.
 *
 * Adding a language is one entry here plus its string catalogues. A store
 * then enables it through its runtime config (`localization.supportedLocales`).
 */

export const SCRIPTS = ['latin', 'arabic'] as const;
export type Script = (typeof SCRIPTS)[number];

export const FONT_KITS = ['latin-rounded', 'arabic-latin'] as const;
export type FontKit = (typeof FONT_KITS)[number];

/** Scripts each font kit ships a face for. */
export const FONT_KIT_SCRIPTS: Readonly<Record<FontKit, readonly Script[]>> = {
  'latin-rounded': ['latin'],
  'arabic-latin': ['latin', 'arabic'],
};

export interface LocaleTypography {
  /** A space before `; : ! ?` (French). Mail and invoice copy checks read it. */
  spaceBeforeHighPunctuation: boolean;
}

export interface LocaleDefinition {
  code: string;
  /** English name, for admin screens in any UI language. */
  label: string;
  /** The language's own name, for the storefront switcher. */
  nativeName: string;
  direction: 'ltr' | 'rtl';
  script: Script;
  /** BCP-47 tag handed to `Intl` formatters. */
  intlTag: string;
  /** Default Open Graph region when the store sets no country. */
  ogRegion: string;
  /** Postgres text-search configuration for the product search vector. */
  textSearchConfig: string;
  typography: LocaleTypography;
}

export const LOCALE_REGISTRY_FIELDS = [
  'code',
  'label',
  'nativeName',
  'direction',
  'script',
  'intlTag',
  'ogRegion',
  'textSearchConfig',
  'typography',
] as const satisfies readonly (keyof LocaleDefinition)[];

export const LOCALE_REGISTRY = {
  fr: {
    code: 'fr',
    label: 'French',
    nativeName: 'Français',
    direction: 'ltr',
    script: 'latin',
    intlTag: 'fr-FR',
    ogRegion: 'FR',
    textSearchConfig: 'french',
    typography: { spaceBeforeHighPunctuation: true },
  },
  en: {
    code: 'en',
    label: 'English',
    nativeName: 'English',
    direction: 'ltr',
    script: 'latin',
    intlTag: 'en-GB',
    ogRegion: 'GB',
    textSearchConfig: 'english',
    typography: { spaceBeforeHighPunctuation: false },
  },
  ar: {
    code: 'ar',
    label: 'Arabic',
    nativeName: 'العربية',
    direction: 'rtl',
    script: 'arabic',
    intlTag: 'ar',
    ogRegion: 'SA',
    textSearchConfig: 'arabic',
    typography: { spaceBeforeHighPunctuation: false },
  },
} as const satisfies Record<string, LocaleDefinition>;

export type RegistryLocale = keyof typeof LOCALE_REGISTRY;

export function registryLocaleCodes(): RegistryLocale[] {
  return Object.keys(LOCALE_REGISTRY) as RegistryLocale[];
}

export function isRegistryLocale(value: string): value is RegistryLocale {
  return Object.prototype.hasOwnProperty.call(LOCALE_REGISTRY, value);
}

export function getLocaleDefinition(code: string): LocaleDefinition | undefined {
  return isRegistryLocale(code) ? LOCALE_REGISTRY[code] : undefined;
}

/** The fields a definition lacks or leaves empty; the parity canary asserts none. */
export function missingRegistryFields(definition: Partial<LocaleDefinition>): string[] {
  return LOCALE_REGISTRY_FIELDS.filter((field) => {
    const value = definition[field];
    return value === undefined || value === null || value === '';
  });
}

/** Whether a font kit ships a face for the locale's script. */
export function fontKitCoversLocale(kit: FontKit, code: string): boolean {
  const definition = getLocaleDefinition(code);
  return definition !== undefined && FONT_KIT_SCRIPTS[kit].includes(definition.script);
}
