import { describe, expect, it } from 'vitest';

import { LOADER_QUERY_HEADER, loaderSearchParams } from './loader-query';

/**
 * The reader half of the SSR query-drop fix. `loader-query.ts` carries the
 * rationale; these pin the precedence rule and the shapes a real request can
 * take at the Nitro page-endpoint layer.
 */

function req(
  url: string | undefined,
  headers: Record<string, string | string[] | undefined> = {},
): { url?: string | undefined; headers: Record<string, string | string[] | undefined> } {
  return { url, headers: { host: 'internal.test', ...headers } };
}

describe('loaderSearchParams', () => {
  it('reads the search off the url', () => {
    const params = loaderSearchParams(req('/api/_analog/pages/fr/catalog/index?brand=Nike&page=2'));

    expect(params.get('brand')).toBe('Nike');
    expect(params.get('page')).toBe('2');
  });

  it('falls back to the header when the url carries no search', () => {
    const params = loaderSearchParams(
      req('/api/_analog/pages/fr/catalog/index', { [LOADER_QUERY_HEADER]: 'brand=Nike&page=2' }),
    );

    expect(params.get('brand')).toBe('Nike');
    expect(params.get('page')).toBe('2');
  });

  it('lets the url win over a header that disagrees', () => {
    const params = loaderSearchParams(
      req('/api/_analog/pages/fr/catalog/index?brand=Fresh', {
        [LOADER_QUERY_HEADER]: 'brand=Stale',
      }),
    );

    expect(params.get('brand')).toBe('Fresh');
  });

  it('decodes percent-encoded values from either source', () => {
    expect(loaderSearchParams(req('/catalog?specs=colour%3Ared')).get('specs')).toBe('colour:red');
    expect(
      loaderSearchParams(req('/catalog', { [LOADER_QUERY_HEADER]: 'specs=colour%3Ared' })).get(
        'specs',
      ),
    ).toBe('colour:red');
  });

  it('takes the first value when the header arrives as a list', () => {
    const params = loaderSearchParams(
      req('/catalog', { [LOADER_QUERY_HEADER]: ['brand=First', 'brand=Second'] }),
    );

    expect(params.get('brand')).toBe('First');
  });

  it('is empty when neither source carries a query', () => {
    expect([...loaderSearchParams(req('/api/_analog/pages/fr/catalog/index')).keys()]).toEqual([]);
    expect([...loaderSearchParams(req(undefined)).keys()]).toEqual([]);
    expect([...loaderSearchParams(req('/catalog', { [LOADER_QUERY_HEADER]: '' })).keys()]).toEqual(
      [],
    );
  });

  it('treats a bare ? as no search and still reads the header', () => {
    // `new URL('/catalog?').search` is '', so a trailing `?` is indistinguishable
    // from no query at all. The header only exists when the resolve DID carry a
    // search, so deferring to it is the honest reading rather than a hole.
    const params = loaderSearchParams(req('/catalog?', { [LOADER_QUERY_HEADER]: 'brand=Nike' }));

    expect(params.get('brand')).toBe('Nike');
  });
});
