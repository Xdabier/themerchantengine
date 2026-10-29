import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import {
  RedirectCommand,
  Router,
  TitleStrategy,
  UrlSerializer,
  withNavigationErrorHandler,
} from '@angular/router';
import { provideFileRouter, requestContextInterceptor } from '@analogjs/router';

import { STOREFRONT_API_CLIENT, createBrowserApiClient } from '@storefront-services';
import { LocaleAwareTitleStrategy } from './title-strategy';
import { TrailingSlashUrlSerializer } from './trailing-slash-url-serializer';
import { AuthStateService } from './services/auth-state.service';
import { BrandTokensService } from './services/brand-tokens.service';
import { EngineFingerprintService } from './services/engine-fingerprint.service';
import { StoreConfigService } from './services/store-config.service';
import { LocaleService } from './locale.service';
import { StorefrontErrorHandler } from './error-handler';
import { provideAppStableMarker } from './app-stable-marker';
import { analogLoaderQueryInterceptor } from './analog-loader-query.interceptor';
import { APP_ROUTES } from '../lib/routes';
import { isLoaderNotFound, notFoundUrlFor } from '../lib/loader-navigation-error';

/**
 * The 401s that are a field being wrong, not a session being gone.
 *
 * `PATCH /v1/users/me` answers 401 for a wrong or missing current password
 * because the password IS the credential being checked, and that is the right
 * status. It is not session loss: the caller's session is valid, and the next
 * request on it succeeds. Clearing it would sign the customer out for a typo.
 *
 * One entry, deliberately. `PROFILE_CURRENT_PASSWORD_REQUIRED` is the sibling
 * case and is NOT here, because it is a 400 and never reaches this handler;
 * listing it would suggest the set is "the password codes" rather than "the
 * 401s that are not session loss". An unlisted 401 keeps the default
 * treatment, so nothing is exempted by omission.
 *
 * Code from `apps/api/src/modules/users/profile-current-password-incorrect.exception.ts`.
 */
const FORM_VALIDATION_401_CODES = new Set(['PROFILE_CURRENT_PASSWORD_INCORRECT']);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // The store config has to be resolved before the first render, so the SSR
    // HTML carries the configured identity, currency and pixel ids rather than
    // repainting them in after hydration. The service swallows every failure
    // and keeps its baked defaults, so awaiting it here can delay a render but
    // can never fail one.
    provideAppInitializer(() => {
      // Both injected before the await: an injection context does not survive
      // one, and `inject()` after it throws NG0203.
      const storeConfig = inject(StoreConfigService);
      const brandTokens = inject(BrandTokensService);
      inject(EngineFingerprintService).apply();
      // The token block is rendered from the config, so never before it lands.
      return storeConfig.load().then(() => brandTokens.apply());
    }),
    // A loader that throws 404 rejects Analog's route resolver, which cancels
    // the navigation before activation: no route component mounts, the
    // wildcard is never reached because matching already succeeded, and the
    // shell renders around an empty <main> under a 200. Catching it here maps
    // every unknown policy, category and product slug onto the locale
    // not-found surface, on the server and in the browser through the same
    // config. `skipLocationChange` keeps the requested URL, which is what both
    // a reader and a crawler want on a 404. See lib/loader-navigation-error.ts
    // for why the predicate is narrow.
    provideFileRouter(
      withNavigationErrorHandler((event) => {
        if (!isLoaderNotFound(event.error)) return;
        const router = inject(Router);
        return new RedirectCommand(router.parseUrl(notFoundUrlFor(event.url)), {
          skipLocationChange: true,
        });
      }),
    ),
    // Event replay, because the catalog and search grids are server-rendered
    // and their controls are wired by Angular listeners. Without it, a sort
    // change, an add-to-cart or a search submitted between paint and hydration
    // is silently dropped: the control looks interactive and does nothing.
    // Every mutation on this storefront is idempotency-keyed per the
    // constitution 3.6, so a replayed event cannot double-apply.
    provideClientHydration(withEventReplay()),
    provideAppStableMarker(),
    // Order matters. `analogLoaderQueryInterceptor` must run FIRST: on a
    // production Nitro build `requestContextInterceptor` answers page-endpoint
    // resolves itself, without the query string and without calling `next`, so
    // the search has to be on the request before it gets there. See
    // `lib/loader-query.ts` for the mechanism.
    provideHttpClient(
      withFetch(),
      withInterceptors([analogLoaderQueryInterceptor, requestContextInterceptor]),
    ),
    { provide: TitleStrategy, useClass: LocaleAwareTitleStrategy },
    { provide: ErrorHandler, useClass: StorefrontErrorHandler },
    // Preserve trailing slashes on locale-root paths (/fr/, /en/) so the
    // header's buildLocaleSwitchHref helper produces /fr/ and /en/ not /fr
    // and /en. See TrailingSlashUrlSerializer JSDoc for full rationale.
    { provide: UrlSerializer, useClass: TrailingSlashUrlSerializer },
    // Browser-side STOREFRONT_API_CLIENT binding. The SSR injector overrides
    // this token via the request-scoped provider in app.config.server.ts.
    {
      provide: STOREFRONT_API_CLIENT,
      useFactory: () => {
        const authState = inject(AuthStateService);
        const router = inject(Router);
        const locale = inject(LocaleService);
        // A 401 from a protected API call usually means the Better Auth session
        // cookie is missing or expired. Under the cookie-session model there is
        // no refresh to attempt (DR-24) — wipe the local AuthState and bounce to
        // the login page, threading the current path through `?from=` so the
        // customer returns where they were after signing back in.
        //
        // Not every 401 is that, and this handler used to treat them all alike.
        // A wrong current password on `PATCH /v1/users/me` answers 401 with its
        // own code, and bouncing on it signed the customer out mid-form: they
        // mistyped one field and lost the page. The profile page already
        // excluded that code from its own catch, but this handler ran first, so
        // that exclusion never got a turn.
        const onUnauthorized = (code: string | null): void => {
          if (code !== null && FORM_VALIDATION_401_CODES.has(code)) return;
          authState.clearSession();
          const currentPath = router.url;
          const fromQuery = currentPath ? `?from=${encodeURIComponent(currentPath)}` : '';
          void router.navigateByUrl(`${APP_ROUTES.auth.login(locale.locale())}${fromQuery}`);
        };
        return createBrowserApiClient({ onUnauthorized });
      },
    },
  ],
};
