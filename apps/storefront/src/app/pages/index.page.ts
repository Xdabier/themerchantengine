import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

import { type Locale } from '../../i18n/types';
import { resolveLocaleFromHeaders } from '../../lib/locale';
import { LOCALE_COOKIE } from '../../lib/routes';
import { StoreConfigService } from '../services/store-config.service';

/**
 * Root path `/` — Angular-level redirect to `/<locale>/`.
 *
 * Two-layer redirect contract (agent_docs/storefront/architecture.md +
 * storefront-ssr-data-hydration clarifications §1.14):
 *   1. Nitro middleware (`apps/storefront/src/server/middleware/locale-redirect.ts`)
 *      — first responder in production AND in dev. The Analog `vite-plugin-nitro`
 *      auto-registers every middleware file under `src/server/middleware/`
 *      with the Vite dev server's middleware chain (see
 *      `node_modules/@analogjs/vite-plugin-nitro/src/lib/utils/register-dev-middleware.js`
 *      lines 43-66), so the same `locale-redirect` 302 fires on Vite dev
 *      `GET /` and on production Nitro `GET /` traffic.
 *   2. THIS file (Angular-side, browser-only) — last-resort belt-and-suspenders
 *      for any pipeline that bypasses the Nitro middleware (e.g. some
 *      prerendered-static-host configurations).
 *
 * Locale resolution order on the browser-only fallback path, the same as the
 * Nitro middleware:
 *   1. `storefront_locale` cookie (set by the locale toggle).
 *   2. Browser `navigator.languages` (proxy for the original
 *      `Accept-Language` header on the client).
 *   3. The store's default locale from the runtime config.
 * A locale the store does not serve is skipped at every step.
 */
@Component({
  selector: 'app-root-redirect',
  standalone: true,
  template: '',
})
export default class RootRedirectPage implements OnInit {
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly storeConfig = inject(StoreConfigService);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const target = this.resolveLocale();
    // The trailing slash is the URL contract. `TrailingSlashUrlSerializer`
    // normalises it away at parse time so this does not land on the 404 route
    // (finding A1); see app/trailing-slash-url-serializer.ts.
    this.router.navigateByUrl(`/${target}/`, { replaceUrl: true });
  }

  private resolveLocale(): Locale {
    const win = this.document?.defaultView;
    const nav = win?.navigator;
    const navLanguages = nav?.languages?.join(',') ?? nav?.language ?? null;
    const { supportedLocales, defaultLocale } = this.storeConfig.localization();
    return resolveLocaleFromHeaders({
      acceptLanguage: navLanguages,
      cookie: this.document?.cookie ?? null,
      cookieName: LOCALE_COOKIE,
      supported: supportedLocales,
      defaultLocale,
    });
  }
}
