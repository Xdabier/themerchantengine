import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

import { DEFAULT_LOCALE, type Locale } from '../i18n/types';
import { getChromeStrings, NEUTRAL_CHROME_IDENTITY, type ChromeIdentity } from '../i18n';
import { localeFromPathname } from '../lib/locale';
import { LOCALE_COOKIE } from '../lib/routes';
import { StoreConfigService } from './services/store-config.service';

/** One year, in seconds. The language choice outlives a browsing session. */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Resolves the active locale from the URL path and reflects it onto the
 * document so screen readers + browser engines see the correct `lang`
 * attribute from first paint.
 *
 * Server-side: Analog SSR renders the document with the right attrs because
 * this service runs during the SSR Angular bootstrap.
 * Client-side: an `effect()` re-applies attrs whenever a NavigationEnd
 * crosses a locale boundary, and persists the resolved locale into the
 * `storefront_locale` cookie the Nitro root-redirect middleware reads.
 *
 * `dir` is per locale, from `localization.rtlLocales` in the runtime config
 * (DR-31). It used to be the constant `ltr`, which was true of one client's
 * locale pair and of no other. Logical CSS stays mandatory as house style per
 * constitution §3.10, so a direction flip needs no other change.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly storeConfig = inject(StoreConfigService);

  private readonly _locale = signal<Locale>(this.resolveInitial());
  private readonly _currentUrl = signal<string>(this.resolveInitialUrl());

  readonly locale = computed<Locale>(() => this._locale());

  /**
   * The store's identity as the chrome copy interpolates it (plan E2.5). Read
   * from the runtime config rather than spelled into the catalogues, which is
   * what lets one build serve any install. Before the config answers this is
   * the neutral store, never a raw placeholder.
   */
  readonly chromeIdentity = computed<ChromeIdentity>(() => {
    const identity = this.storeConfig.identity();
    return {
      // Never empty. The wire schema allows a blank `storeName` on a store
      // nobody has finished configuring, and `{store}` is the whole of the
      // header lockup's accessible name and of the document title: an empty
      // substitution leaves an unnamed link and a blank tab. The neutral
      // config's own name is what an unconfigured engine calls itself.
      storeName: identity.storeName.trim() || NEUTRAL_CHROME_IDENTITY.storeName,
      country: identity.address.country,
    };
  });

  readonly strings = computed(() => getChromeStrings(this._locale(), this.chromeIdentity()));
  /**
   * Active route URL (path + query + fragment), kept in lock-step with
   * `NavigationEnd`. Layout components consume this to render path-preserving
   * locale-switch hrefs without subscribing to router events themselves.
   */
  readonly currentUrl = computed(() => this._currentUrl());

  /**
   * Writing direction of the active locale, from the store's configured RTL
   * set. Components that mirror an asymmetric affordance (a chevron, a
   * progress arrow) read this; everything else is handled by logical CSS.
   */
  readonly direction = computed<'ltr' | 'rtl'>(() =>
    this.storeConfig.localization().rtlLocales.includes(this._locale()) ? 'rtl' : 'ltr',
  );

  constructor() {
    this.router.events
      .pipe(filter((evt): evt is NavigationEnd => evt instanceof NavigationEnd))
      .subscribe((evt) => {
        this._currentUrl.set(evt.urlAfterRedirects);
        const next = localeFromPathname(evt.urlAfterRedirects);
        if (next && next !== this._locale()) {
          this._locale.set(next);
        }
      });

    effect(() => {
      const lang = this._locale();
      const html = this.document.documentElement;
      html.setAttribute('lang', lang);
      html.setAttribute('dir', this.direction());
      this.persistLocale(lang);
    });
  }

  /**
   * Write the resolved locale to `storefront_locale` so a later visit to `/`
   * lands on the same language. The Nitro middleware at
   * `src/server/middleware/locale-redirect.ts` reads this cookie first and
   * only falls back to `Accept-Language`, so without this writer the cookie
   * branch of that redirect can never fire.
   *
   * Not `HttpOnly`: the client is the writer. Not `Secure`: the dev server is
   * plain HTTP, and the value is a two-letter language code, not a credential.
   */
  private persistLocale(locale: Locale): void {
    if (!this.isBrowser) return;
    this.document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
  }

  private resolveInitial(): Locale {
    if (typeof this.document?.location?.pathname === 'string') {
      const next = localeFromPathname(this.document.location.pathname);
      if (next) return next;
    }
    return DEFAULT_LOCALE;
  }

  private resolveInitialUrl(): string {
    const loc = this.document?.location;
    if (loc) {
      return `${loc.pathname || '/'}${loc.search || ''}${loc.hash || ''}`;
    }
    return '/';
  }
}
