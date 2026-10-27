import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES } from '../i18n/types';
import { isLoaderNotFound, notFoundUrlFor } from './loader-navigation-error';

const PAGE_ENDPOINT = 'http://localhost:53311/api/_analog/pages/en/policies/unknown-slug';

describe('isLoaderNotFound', () => {
  it('accepts a 404 from an Analog page endpoint', () => {
    expect(isLoaderNotFound(new HttpErrorResponse({ status: 404, url: PAGE_ENDPOINT }))).toBe(true);
  });

  it('rejects a 500 from the same endpoint, so a broken API still surfaces the error page', () => {
    // agent_docs/storefront/ssr-data-loading.md forbids papering a 500 over
    // with an empty or wrong page. Widening this predicate to any status is
    // exactly how that regression comes back.
    expect(isLoaderNotFound(new HttpErrorResponse({ status: 500, url: PAGE_ENDPOINT }))).toBe(
      false,
    );
  });

  it('rejects a 404 from any other request the page makes', () => {
    const url = 'http://localhost:53001/api/v1/products/unknown';
    expect(isLoaderNotFound(new HttpErrorResponse({ status: 404, url }))).toBe(false);
  });

  it('rejects a 404 with no url at all', () => {
    expect(isLoaderNotFound(new HttpErrorResponse({ status: 404 }))).toBe(false);
  });

  it('rejects anything that is not an HttpErrorResponse', () => {
    expect(isLoaderNotFound(new Error('boom'))).toBe(false);
    expect(isLoaderNotFound({ status: 404, url: PAGE_ENDPOINT })).toBe(false);
    expect(isLoaderNotFound(null)).toBe(false);
    expect(isLoaderNotFound(undefined)).toBe(false);
  });
});

describe('notFoundUrlFor', () => {
  it('keeps the locale of the URL that failed', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(notFoundUrlFor(`/${locale}/policies/unknown-slug`)).toBe(`/${locale}/not-found`);
      expect(notFoundUrlFor(`/${locale}/catalog/nope`)).toBe(`/${locale}/not-found`);
      expect(notFoundUrlFor(`/${locale}/catalog/product/nope`)).toBe(`/${locale}/not-found`);
    }
  });

  it('falls back to the default locale when the first segment is not one', () => {
    expect(notFoundUrlFor('/de/policies/privacy')).toBe(`/${SUPPORTED_LOCALES[0]}/not-found`);
    expect(notFoundUrlFor('/')).toBe(`/${SUPPORTED_LOCALES[0]}/not-found`);
    expect(notFoundUrlFor('')).toBe(`/${SUPPORTED_LOCALES[0]}/not-found`);
  });

  it('ignores a query string and a fragment', () => {
    expect(notFoundUrlFor('/en/catalog/nope?sort=priceAsc#top')).toBe('/en/not-found');
  });

  it('never targets a route that carries a loader, or the handler would loop', () => {
    // The target must resolve through [locale]/[...not-found].page.ts, which
    // has no *.server.ts sibling. Anything with a loader would fail its own
    // resolver, re-enter this handler and navigate forever.
    for (const url of ['/fr/policies/x', '/en/catalog/x', '/en/catalog/product/x', '/en/about']) {
      expect(notFoundUrlFor(url)).toMatch(/^\/(fr|en)\/not-found$/);
    }
  });
});
