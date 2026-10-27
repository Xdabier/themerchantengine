import { isPlatformServer } from '@angular/common';
import type { HttpInterceptorFn } from '@angular/common/http';
import { PLATFORM_ID, inject } from '@angular/core';

import { LOADER_QUERY_HEADER } from '../lib/loader-query';

/**
 * Carries a page-server companion's query string across Analog's internal
 * `$fetch`, which drops it.
 *
 * Registered BEFORE `requestContextInterceptor` in `app.config.ts`, because
 * that interceptor answers the request itself and never calls `next` on the
 * branch this compensates for. See `lib/loader-query.ts` for the full
 * mechanism; the short version is that the branch fetches
 * `requestUrl.pathname` and tries to restore the search through ofetch's
 * `params` option, which silently discards a `URLSearchParams`. Request
 * headers are the one part of the request it does forward verbatim.
 *
 * Server-only. In the browser the request reaches the endpoint as a real HTTP
 * call with its url intact, so the header would be noise on every navigation.
 *
 * Scoped to `/_analog/` urls: those are Analog's page-endpoint resolves, the
 * only requests whose response is built by a `.server.ts` loader. Storefront
 * API calls go out through `ApiClient`, not `HttpClient`, and never reach here.
 */
export const analogLoaderQueryInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isPlatformServer(inject(PLATFORM_ID))) return next(req);
  if (!req.url.includes('/_analog/')) return next(req);

  // Read off the url the same way Analog's interceptor does, so the header can
  // never disagree with the search that would have been sent. The fragment goes
  // first: `injectRouteEndpointURL` appends the route fragment to the same href
  // and the hash setter does not encode `?`, so a fragment like `#tab?a=1` would
  // otherwise be read as a query the url never had.
  const beforeHash = req.url.split('#')[0];
  const start = beforeHash.indexOf('?');
  if (start < 0) return next(req);
  const search = beforeHash.slice(start + 1);
  if (search.length === 0) return next(req);

  return next(req.clone({ setHeaders: { [LOADER_QUERY_HEADER]: search } }));
};
