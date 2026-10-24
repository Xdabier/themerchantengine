import {
  STORE_CONFIG_LOCALES,
  type StoreConfigLocale,
} from '../../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import {
  FONT_KITS,
  LOCALE_REGISTRY,
  fontKitCoversLocale,
} from '../../../../libs/shared/common/src/locale/locale-registry';
import { ui } from '../cli/ui';
import type { Step } from './types';

export function localeLabel(code: StoreConfigLocale): string {
  const def = LOCALE_REGISTRY[code];
  return `${def.label} (${def.code}, ${def.nativeName}${def.direction === 'rtl' ? ', right-to-left' : ''})`;
}

function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The language set (plan E4.3, LG11): which registry languages the store serves, which
 * is the default, and the timezone. Direction comes from the registry, and a
 * store that enables a right-to-left language needs an Arabic-capable font kit, which the brand
 * step has already asked; the mismatch is corrected here rather than refused.
 */
export const localizationStep: Step = {
  id: 'localization',
  title: 'Locales and timezone',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const current = ctx.answers.localization ?? {};
    const supportedLocales = await ctx.prompter.multiSelect<StoreConfigLocale>({
      path: 'localization.supportedLocales',
      label: 'Locales the store serves',
      initial: current.supportedLocales ?? [...STORE_CONFIG_LOCALES],
      choices: STORE_CONFIG_LOCALES.map((value) => ({ value, label: localeLabel(value) })),
      validate: (v) => (v.length > 0 ? null : 'pick at least one locale'),
    });
    const defaultLocale = await ctx.prompter.select<StoreConfigLocale>({
      path: 'localization.defaultLocale',
      label: 'Default locale',
      initial:
        current.defaultLocale && supportedLocales.includes(current.defaultLocale)
          ? current.defaultLocale
          : supportedLocales[0],
      choices: supportedLocales.map((value) => ({ value, label: localeLabel(value) })),
    });
    const timezone = await ctx.prompter.text({
      path: 'localization.timezone',
      label: 'Timezone (IANA, Europe/Paris)',
      initial: current.timezone ?? 'UTC',
      validate: (v) => (validTimezone(v) ? null : 'not a timezone Intl knows'),
    });
    const rtlLocales = supportedLocales.filter((l) => LOCALE_REGISTRY[l].direction === 'rtl');
    ctx.answers.localization = { supportedLocales, defaultLocale, rtlLocales, timezone };

    const kit = ctx.answers.brand?.fontKit;
    if (kit && !supportedLocales.every((l) => fontKitCoversLocale(kit, l))) {
      const covering = FONT_KITS.find((k) =>
        supportedLocales.every((l) => fontKitCoversLocale(k, l)),
      );
      if (covering) {
        ctx.answers.brand = { ...ctx.answers.brand, fontKit: covering };
        ui.warn(
          ctx.out,
          `The ${kit} font kit lacks a script this store serves; switched the brand to ${covering}`,
        );
      }
    }
  },
};
