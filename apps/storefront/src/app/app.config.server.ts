import { mergeApplicationConfig, ApplicationConfig, CSP_NONCE } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { injectRequest, injectResponse } from '@analogjs/router/tokens';

import { STOREFRONT_API_CLIENT, type ApiClient } from '@storefront-services';
import { appConfig } from './app.config';
import { SSR_API_BASE_URL, createServerApiClient } from '../server/server-api-client-factory';
import { readCspNonce } from '../server/csp-nonce';

/**
 * SSR-only application config. Merged onto `appConfig` at server bootstrap
 * via `mergeApplicationConfig`. Provider order: server providers OVERRIDE
 * matching tokens from `appConfig`, so the `STOREFRONT_API_CLIENT` binding
 * here replaces the browser factory at `app.config.ts:48-66` whenever a route
 * renders on the server (Analog's `defineRouteMeta({ load })` codepath).
 *
 * The `STOREFRONT_API_CLIENT` factory pulls Analog's per-request `ServerRequest`
 * + `ServerResponse` tokens (`@analogjs/router/tokens`) and delegates to
 * `createServerApiClient(req, res)`. The factory file itself is unit-tested in
 * `app.config.server.spec.ts`; this provider is the wiring surface.
 *
 * Authority: `agent_docs/storefront/ssr-data-loading.md`
 * `## Server-side STOREFRONT_API_CLIENT provider`.
 */
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    {
      // Stamps the nonce the security-headers middleware already advertised in
      // `script-src` onto the inline scripts hydration event replay emits.
      // Without it those scripts are refused, event replay never arms, and the
      // console carries two CSP violations on every page.
      //
      // Null when the middleware did not run, which is honest: a nonce the
      // header never advertised would be refused anyway, and inventing one here
      // would hide the mismatch rather than surface it.
      provide: CSP_NONCE,
      useFactory: (): string | null => readCspNonce(injectRequest()),
    },
    {
      provide: STOREFRONT_API_CLIENT,
      useFactory: (): ApiClient => {
        const req = injectRequest();
        const res = injectResponse();
        if (!req || !res) {
          // Should never happen on a real SSR pass — Analog's
          // `provideServerContext({ req, res })` populates both before the
          // injector runs the factory. If we land here, the platform contract
          // has changed and the page would silently fall through to a broken
          // browser client; fail loud instead.
          throw new Error(
            'STOREFRONT_API_CLIENT (server): Analog server context missing — ' +
              'expected ServerRequest + ServerResponse from @analogjs/router/tokens.',
          );
        }
        return createServerApiClient(req, res, { baseUrl: SSR_API_BASE_URL });
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
