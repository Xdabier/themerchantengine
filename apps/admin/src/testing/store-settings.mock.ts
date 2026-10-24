import { computed, signal, type Provider } from '@angular/core';
import { getLocaleDefinition } from '@common/locale';
import {
  buildLocaleTabs,
  type TranslatableLocaleTab,
} from '@admin-ui/atoms/translatable-locales.token';
import {
  StoreSettingsStore,
  type MoneySymbolPosition,
} from '../app/core/stores/store-settings.store';

/** The demo store timezone; every date assertion is written against it. */
export const DEMO_TIMEZONE = 'Europe/Paris';

/** The demo locale pair, default first. Mirrors the demo scenario fixture. */
export const DEMO_LOCALES: readonly string[] = ['fr', 'en'];

/**
 * A hydrated `StoreSettingsStore` for component specs.
 *
 * Any spec whose component renders a timestamp reaches this store through the
 * `adminDate` pipe, and the real store injects `AuthStore` and
 * `SettingsService`. Rather than teach every spec to stub both, provide this:
 * the component sees a store that already knows the store timezone, so
 * assertions read the real output (`24 May 2026, 12:15`).
 *
 * Pass a zone (or `'UTC'`) to exercise a different one, and a locale list to
 * exercise a different locale set.
 */
export function provideStoreSettingsStub(
  timezone: string = DEMO_TIMEZONE,
  locales: readonly string[] = DEMO_LOCALES,
  /** Defaults to the first entry. Pass one that is NOT first to exercise ordering. */
  defaultLocale?: string,
  /** Defaults to the registry direction of each locale. Pass a list to override. */
  rtlLocales: readonly string[] = locales.filter(
    (code) => getLocaleDefinition(code)?.direction === 'rtl',
  ),
  /** Which side of the number the currency symbol goes on. */
  symbolPosition: MoneySymbolPosition = 'before',
): Provider {
  const value = signal<string>(timezone);
  const localeValue = signal<readonly string[]>(locales);
  const defaultValue = signal<string | undefined>(defaultLocale);
  const rtlValue = signal<readonly string[]>(rtlLocales);
  const symbolPositionValue = signal<MoneySymbolPosition>(symbolPosition);
  return {
    provide: StoreSettingsStore,
    useValue: {
      timezone: value.asReadonly(),
      supportedLocales: localeValue.asReadonly(),
      rtlLocales: rtlValue.asReadonly(),
      symbolPosition: symbolPositionValue.asReadonly(),
      defaultLocale: computed(() => defaultValue() ?? localeValue()[0] ?? 'fr'),
      // Calls the same builder production does, rather than re-implementing
      // it, so the rule cannot drift out from under the specs.
      localeTabs: computed<readonly TranslatableLocaleTab[]>(() =>
        buildLocaleTabs(localeValue(), defaultValue() ?? localeValue()[0] ?? 'fr', rtlValue()),
      ),
      hydrated: computed(() => true),
      refresh: (): void => undefined,
      /** Test-only lever: change the zone mid-spec. */
      set: (next: string): void => value.set(next),
    },
  };
}
