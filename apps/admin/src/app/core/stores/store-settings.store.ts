import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SettingsService } from '@admin-services';
import { pickTranslation, type Translatable } from '@admin-types';
import { NEUTRAL_LOCALE_SET } from '@common/locale';
import {
  buildLocaleTabs,
  type TranslatableLocaleTab,
} from '@admin-ui/atoms/translatable-locales.token';
import { adminIntlTag } from '../../shared/format/intl-tag';
import { AuthStore } from './auth.store';

const FALLBACK_TIMEZONE = 'UTC';

/** Which side of the number the currency symbol goes on. */
export type MoneySymbolPosition = 'before' | 'after';

/** The engine's own default, so an unhydrated admin agrees with the API. */
const FALLBACK_SYMBOL_POSITION: MoneySymbolPosition = 'before';

/** Locale set used until the settings answer: the neutral set every layer shares. */
const FALLBACK_LOCALES = NEUTRAL_LOCALE_SET.supportedLocales;

/**
 * Signal-based singleton holding ambient store settings the whole admin reads.
 *
 * Today that is the store timezone (`settings.localization.timezone`, an IANA
 * string) and the store locale set (`supportedLocales` + `defaultLocale`).
 * Every timestamp in the admin used to render in the browser's zone, so an
 * operator in one country read an order's placed-at hour in their own time
 * while the store ran on another. Every Translatable editor used to offer a
 * locale pair hardcoded into the component, so adding a locale in settings
 * changed nothing on screen.
 *
 * Mirrors `CurrencyStore`: one small authenticated request on the
 * unauthenticated -> authenticated transition, no retry timer, `refresh()` as
 * the deliberate lever. On failure the timezone stays at the `UTC` fallback,
 * which is unambiguous rather than wrong-but-plausible, and the locale list
 * stays at the neutral locale set.
 */
@Injectable({ providedIn: 'root' })
export class StoreSettingsStore {
  private readonly auth = inject(AuthStore);
  private readonly settings = inject(SettingsService);

  private readonly _timezone = signal<string | null>(null);
  private readonly _storeName = signal<Translatable | string | null>(null);
  private readonly _logoUrl = signal<string | null>(null);
  private readonly _logoAssetId = signal<string | null>(null);
  private readonly _supportedLocales = signal<readonly string[] | null>(null);
  private readonly _defaultLocale = signal<string | null>(null);
  private readonly _rtlLocales = signal<readonly string[] | null>(null);
  private readonly _symbolPosition = signal<MoneySymbolPosition | null>(null);

  /**
   * Plain fields, not signals, on purpose: the hydration effect must depend on
   * `isAuthenticated` alone, or a failed fetch retries forever.
   */
  private attempted = false;
  private inFlight = false;

  /** IANA store timezone. Falls back to UTC until the settings answer. */
  readonly timezone = computed(() => this._timezone() ?? FALLBACK_TIMEZONE);

  /** Locale codes the store supports, in the order settings lists them. */
  readonly supportedLocales = computed<readonly string[]>(
    () => this._supportedLocales() ?? FALLBACK_LOCALES,
  );

  /**
   * Locales the store writes right to left.
   *
   * Until the settings answer this follows the neutral set, so the fallback
   * tabs agree on direction with the fallback locale list. A hydrated answer
   * without `rtlLocales` means the store writes none right to left.
   */
  readonly rtlLocales = computed<readonly string[]>(
    () =>
      this._rtlLocales() ??
      (this._supportedLocales() === null ? NEUTRAL_LOCALE_SET.rtlLocales : []),
  );

  /**
   * Which side of the number the currency symbol is written on.
   *
   * Mirrors the `money.symbolPosition` default in
   * `apps/api/src/modules/settings/store.config.ts`, so an admin that has not
   * loaded settings yet renders the same way the engine's own default does.
   */
  readonly symbolPosition = computed<MoneySymbolPosition>(
    () => this._symbolPosition() ?? FALLBACK_SYMBOL_POSITION,
  );

  /** The store's default locale. */
  readonly defaultLocale = computed(
    () => this._defaultLocale() ?? this.supportedLocales()[0] ?? NEUTRAL_LOCALE_SET.defaultLocale,
  );

  /**
   * The locale list every Translatable editor renders as tabs, default first.
   *
   * The atoms treat the first entry as the locale whose value mirrors into the
   * Translatable's `default` key, so the order is load-bearing rather than
   * cosmetic: leading with anything but the store default writes the wrong
   * language into the field the storefront falls back to.
   */
  readonly localeTabs = computed<readonly TranslatableLocaleTab[]>(() =>
    buildLocaleTabs(this.supportedLocales(), this.defaultLocale(), this.rtlLocales()),
  );

  /**
   * The store's own name, resolved against the store's default locale.
   *
   * Deliberately not `TranslatablePipe`: that pipe reads `AuthStore.locale()`,
   * the operator's UI language, and takes no locale argument. An operator
   * working in English is still working on a store that calls itself whatever
   * it calls itself, so the store default is what wins here. Empty when the
   * store has no name, rather than a placeholder that would ship to the
   * browser tab of every unnamed install.
   */
  readonly storeName = computed(() =>
    pickTranslation(this._storeName(), this.defaultLocale(), '', this.defaultLocale()),
  );

  /**
   * The store's mark as something the shell can actually put in an `img`.
   *
   * This is `appearance.logoUrl`, the plain URL the appearance screen has
   * written since it shipped, and it is deliberately NOT `brand.logoAssetId`
   * even though the plan puts the asset first. An asset id has no public
   * serving route: the only admin route for one, `GET /v1/admin/assets/:id/
   * original-url`, hands back a five-minute signed URL to the private
   * original, so preferring the asset would render a logo that disappears
   * part-way through a session. The brand settings screen is what gives the
   * asset a URL worth preferring, and it can flip the order then.
   */
  readonly logoUrl = this._logoUrl.asReadonly();

  /**
   * The configured brand asset, surfaced but not yet rendered.
   *
   * Exposed so the brand settings screen has the current value to show, and
   * so the gap above is visible in the store rather than hidden in a shell
   * that quietly renders nothing.
   */
  readonly logoAssetId = this._logoAssetId.asReadonly();

  /** True once a timezone has been committed from the API. */
  readonly hydrated = computed(() => this._timezone() !== null);

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        if (!this.attempted) {
          this.attempted = true;
          this.fetch();
        }
        return;
      }
      this.attempted = false;
    });
  }

  /** Re-read store settings. Call after the settings screen saves. */
  refresh(): void {
    this.attempted = true;
    this.fetch();
  }

  private fetch(): void {
    if (this.inFlight) return;
    this.inFlight = true;
    this.settings.getAll().subscribe({
      next: (groups) => {
        this.inFlight = false;
        const localization = groups['localization'];
        const raw = localization?.['timezone'];
        if (typeof raw === 'string' && raw.trim() && isValidTimeZone(raw)) {
          this._timezone.set(raw);
        }
        const supported = localization?.['supportedLocales'];
        if (Array.isArray(supported)) {
          const codes = supported.filter(
            (code): code is string => typeof code === 'string' && code.trim().length > 0,
          );
          if (codes.length > 0) this._supportedLocales.set(codes);
        }
        const rtl = localization?.['rtlLocales'];
        if (Array.isArray(rtl)) {
          this._rtlLocales.set(
            rtl.filter(
              (code): code is string => typeof code === 'string' && code.trim().length > 0,
            ),
          );
        }
        const fallback = localization?.['defaultLocale'];
        if (typeof fallback === 'string' && fallback.trim()) {
          this._defaultLocale.set(fallback);
        }
        const position = groups['money']?.['symbolPosition'];
        if (position === 'before' || position === 'after') this._symbolPosition.set(position);
        this._storeName.set(readStoreName(groups));
        this._logoUrl.set(readString(groups['appearance']?.['logoUrl']));
        this._logoAssetId.set(readString(groups['brand']?.['logoAssetId']));
      },
      error: (err: unknown) => {
        // Non-blocking: timestamps fall back to UTC rather than failing a screen
        // on a display-config fetch.
        this.inFlight = false;
        console.warn(
          '[StoreSettingsStore] store settings unavailable; timestamps use UTC and locale tabs use the neutral locale set',
          err,
        );
      },
    });
  }
}

function readStoreName(
  groups: Record<string, Record<string, unknown>>,
): Translatable | string | null {
  const value = groups['general']?.['storeName'];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value as Translatable;
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Guard against a malformed setting poisoning every timestamp with a throw. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(adminIntlTag(), { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
