import { HttpErrorResponse } from '@angular/common/http';

import { DEFAULT_LOCALE, isLocale } from '../i18n/types';

/**
 * Turning a loader 404 into the not-found surface.
 *
 * Analog does not consume a `createError({ statusCode: 404 })` thrown from a
 * `*.server.ts` inside the render. It compiles each loader into a standalone
 * Nitro endpoint under `/api/_analog/pages/...` and registers a route
 * *resolver* that fetches it over HTTP on every navigation. A 404 from that
 * endpoint rejects the resolver, and a rejected resolver is a navigation
 * failure, not a component failure: the navigation is cancelled before
 * activation, so no route component is ever constructed and the wildcard is
 * never reached, because matching already succeeded on the parameterised
 * route. The layout shell renders around an empty `<main>`, on the server and
 * in the browser alike, and the document goes out as 200.
 *
 * That is a soft 404 on three unbounded URL spaces: every unknown policy slug,
 * every unknown category slug, every unknown product slug. `withNavigationErrorHandler`
 * is where it is caught, and this file holds the decision so it can be tested
 * without a router.
 *
 * The predicate is deliberately narrow. A 500 on primary content must keep
 * surfacing the error page: papering a 500 over with a not-found page is the
 * regression `agent_docs/storefront/ssr-data-loading.md` exists to forbid.
 */

/** Analog's compiled page-endpoint prefix. Every loader fetch goes through it. */
const PAGE_ENDPOINT_MARKER = '/_analog/pages';

/**
 * True only for "the loader said this entity does not exist".
 *
 * Not for a 500, not for a 404 on any other request the page happens to make,
 * and not for a non-HTTP failure.
 */
export function isLoaderNotFound(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  if (error.status !== 404) return false;
  return typeof error.url === 'string' && error.url.includes(PAGE_ENDPOINT_MARKER);
}

/**
 * The locale-scoped not-found path for the URL that failed.
 *
 * The target must be a route with no `*.server.ts` sibling, or its own
 * resolver would fail the same way and the handler would loop.
 * `[locale]/[...not-found].page.ts` has no loader, so its resolver returns an
 * empty payload and the navigation completes.
 */
export function notFoundUrlFor(attemptedUrl: string): string {
  const firstSegment = attemptedUrl.split('?')[0].split('#')[0].split('/').filter(Boolean)[0];
  const locale = isLocale(firstSegment) ? firstSegment : DEFAULT_LOCALE;
  return `/${locale}/not-found`;
}
