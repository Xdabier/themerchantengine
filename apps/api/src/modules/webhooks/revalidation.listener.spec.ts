import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { Queue } from 'bullmq';
import { RevalidationListener } from './revalidation.listener';
import { SearchEngineSubmitService } from '../seo/search-engine-submit.service';
import { SeoSubmissionService } from '../seo/seo-submission.service';
import { supportedLocales } from '../seo/seo.constants';
import type { StoreLocaleRegistry } from '../settings/store-locale.registry';
import type { ProductMutatedEventPayload } from '../products/products.constants';

/**
 * The listener fans every path out across the store's enabled locales, so
 * the expectations derive from the same source instead of freezing a pair.
 * A locale added to the constant then has to show up in the dispatched paths
 * or these assertions fail, which is the point: a missing locale is a page
 * that serves stale HTML and never reaches a crawler. One case below pins the
 * concrete pair so the derivation can never be vacuously satisfied.
 */
function localePaths(suffix: string): string[] {
  return supportedLocales().map((locale) => `/${locale}${suffix}`);
}
function localeUrls(base: string, suffix: string): string[] {
  return supportedLocales().map((locale) => `${base}/${locale}${suffix}`);
}

// PRODUCT_MUTATED now carries the slug + a service-computed visibility flag (DR-15).
const MUTATED_PUBLIC: ProductMutatedEventPayload = {
  productId: 'p1',
  slug: 'widget',
  shouldSubmitIndexNow: true,
};
const MUTATED_PRIVATE: ProductMutatedEventPayload = {
  productId: 'p1',
  slug: 'widget',
  shouldSubmitIndexNow: false,
};

type FetchSig = (url: string, init: RequestInit) => Promise<Response>;
function makeFetchSpy(impl?: FetchSig): jest.Mock {
  return jest.fn(impl ?? (async () => new Response('{"data":{}}', { status: 200 })));
}
function callBody(call: [string, RequestInit]): {
  paths: string[];
  reason: string;
  eventId: string;
} {
  return JSON.parse(call[1].body as string);
}
function callHeaders(call: [string, RequestInit]): Record<string, string> {
  return call[1].headers as Record<string, string>;
}

interface ListenerHarness {
  listener: RevalidationListener;
  queueAdd: jest.Mock;
  submitToIndexNow: jest.Mock;
  recordEngineResult: jest.Mock;
  refreshLocales: jest.Mock;
}
function makeListener(fetchImpl?: typeof fetch): ListenerHarness {
  const queueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
  const submitToIndexNow = jest.fn().mockResolvedValue({ accepted: true, submitted: 1 });
  const queue = { add: queueAdd } as unknown as Queue;
  const submit = {
    submitToIndexNow,
    submitToGsc: jest.fn(),
  } as unknown as SearchEngineSubmitService;
  const recordEngineResult = jest.fn().mockResolvedValue(undefined);
  const seoSubmissions = { recordEngineResult } as unknown as SeoSubmissionService;
  const refreshLocales = jest.fn().mockResolvedValue(undefined);
  const locales = { refresh: refreshLocales } as unknown as StoreLocaleRegistry;
  return {
    listener: new RevalidationListener(queue, submit, seoSubmissions, fetchImpl, locales),
    queueAdd,
    submitToIndexNow,
    recordEngineResult,
    refreshLocales,
  };
}

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('RevalidationListener', () => {
  const ORIGINAL_URL = process.env['STOREFRONT_REVALIDATE_URL'];
  const ORIGINAL_SECRET = process.env['STOREFRONT_REVALIDATE_SECRET'];
  const ORIGINAL_SITE_URL = process.env['SITE_URL'];

  beforeEach(() => {
    process.env['STOREFRONT_REVALIDATE_URL'] = 'http://storefront.test/api/_internal/revalidate';
    process.env['STOREFRONT_REVALIDATE_SECRET'] = 'a'.repeat(48);
    process.env['SITE_URL'] = 'https://atlas.example';
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env['STOREFRONT_REVALIDATE_URL'];
    else process.env['STOREFRONT_REVALIDATE_URL'] = ORIGINAL_URL;
    if (ORIGINAL_SECRET === undefined) delete process.env['STOREFRONT_REVALIDATE_SECRET'];
    else process.env['STOREFRONT_REVALIDATE_SECRET'] = ORIGINAL_SECRET;
    if (ORIGINAL_SITE_URL === undefined) delete process.env['SITE_URL'];
    else process.env['SITE_URL'] = ORIGINAL_SITE_URL;
  });

  it('posts both old + new product paths in both locales on slug change', async () => {
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onProductSlugChanged({
      productId: 'p1',
      oldSlug: 'old-slug',
      newSlug: 'new-slug',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('http://storefront.test/api/_internal/revalidate');
    expect(call[1].method).toBe('POST');
    const body = callBody(call);
    expect(body.reason).toBe('product.write');
    expect(body.paths).toEqual(
      expect.arrayContaining([
        ...localePaths('/catalog/product/old-slug'),
        ...localePaths('/catalog/product/new-slug'),
        '/sitemap_index.xml',
      ]),
    );
    expect(body.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('sends X-Revalidate-Secret header (and never logs it)', async () => {
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onProductMutated(MUTATED_PRIVATE);

    const headers = callHeaders(fetchSpy.mock.calls[0] as [string, RequestInit]);
    expect(headers['X-Revalidate-Secret']).toBe('a'.repeat(48));
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends category paths in both locales on category slug change', async () => {
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onCategorySlugChanged({
      categoryId: 'c1',
      oldSlug: 'electronics',
      newSlug: 'electronics-pro',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = callBody(fetchSpy.mock.calls[0] as [string, RequestInit]);
    expect(body.reason).toBe('category.write');
    expect(body.paths).toEqual(
      expect.arrayContaining([
        ...localePaths('/catalog/electronics'),
        ...localePaths('/catalog/electronics-pro'),
      ]),
    );
  });

  it('does not throw when the storefront responds non-2xx (fire-and-forget)', async () => {
    const fetchSpy = makeFetchSpy(async () => new Response('boom', { status: 503 }));
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await expect(
      listener.onProductSlugChanged({ productId: 'p1', oldSlug: 'a', newSlug: 'b' }),
    ).resolves.toBeUndefined();
  });

  it('does not throw when fetch itself rejects (fire-and-forget)', async () => {
    const fetchSpy = makeFetchSpy(async () => {
      throw new Error('econn');
    });
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await expect(
      listener.onProductSlugChanged({ productId: 'p1', oldSlug: 'a', newSlug: 'b' }),
    ).resolves.toBeUndefined();
  });

  it('skips dispatch when STOREFRONT_REVALIDATE_URL is unset', async () => {
    delete process.env['STOREFRONT_REVALIDATE_URL'];
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onProductMutated(MUTATED_PRIVATE);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips dispatch when STOREFRONT_REVALIDATE_SECRET is unset', async () => {
    delete process.env['STOREFRONT_REVALIDATE_SECRET'];
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onProductMutated(MUTATED_PRIVATE);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('emits a fresh eventId per dispatch (not a constant)', async () => {
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onProductMutated(MUTATED_PRIVATE);
    await listener.onProductMutated(MUTATED_PRIVATE);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const ev1 = callBody(fetchSpy.mock.calls[0] as [string, RequestInit]).eventId;
    const ev2 = callBody(fetchSpy.mock.calls[1] as [string, RequestInit]).eventId;
    expect(ev1).not.toBe(ev2);
  });

  it('dispatches the home root paths in both locales on storefront.section_updated for the home slug', async () => {
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onStorefrontSectionUpdated({ pageSlug: 'home' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = callBody(fetchSpy.mock.calls[0] as [string, RequestInit]);
    expect(body.reason).toBe('cms.write');
    expect(body.paths).toEqual(localePaths('/'));
  });

  it('dispatches non-home page paths through unchanged', async () => {
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onStorefrontSectionUpdated({ pageSlug: 'sale-2026' });

    const body = callBody(fetchSpy.mock.calls[0] as [string, RequestInit]);
    expect(body.paths).toEqual(localePaths('/sale-2026'));
  });

  it('prefixes every dispatched path with a supported locale, fr first', async () => {
    // The one case that pins the concrete pair, so the derived expectations
    // above cannot pass against an empty or reordered locale set.
    const fetchSpy = makeFetchSpy();
    const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

    await listener.onStorefrontSectionUpdated({ pageSlug: 'sale-2026' });

    const body = callBody(fetchSpy.mock.calls[0] as [string, RequestInit]);
    expect(body.paths).toEqual(['/fr/sale-2026', '/en/sale-2026']);
  });

  /**
   * Plan E3.1.8. A settings write is the only event on this listener that can
   * change the locale set the paths are built from, so the order matters as
   * much as the dispatch: Nest does not order handlers of one event, and a
   * locale enabled by the very write being handled has to be in the paths.
   */
  describe('store config write (E1.2)', () => {
    it('refreshes the locale set before it builds the paths', async () => {
      const order: string[] = [];
      const fetchSpy = makeFetchSpy(async () => {
        order.push('dispatch');
        return new Response('{"data":{}}', { status: 200 });
      });
      const { listener, refreshLocales } = makeListener(fetchSpy as unknown as typeof fetch);
      refreshLocales.mockImplementation(async () => {
        order.push('refresh');
      });

      await listener.onStoreConfigUpdated();

      expect(refreshLocales).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['refresh', 'dispatch']);
    });

    it('dispatches every locale root plus llms.txt, under the config.write reason', async () => {
      const fetchSpy = makeFetchSpy();
      const { listener } = makeListener(fetchSpy as unknown as typeof fetch);

      await listener.onStoreConfigUpdated();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = callBody(fetchSpy.mock.calls[0] as [string, RequestInit]);
      expect(body.reason).toBe('config.write');
      expect(body.paths).toEqual([...localePaths('/'), '/llms.txt']);
    });

    it('does not enqueue a sitemap regen: a config write moves no URL', async () => {
      const fetchSpy = makeFetchSpy();
      const { listener, queueAdd, submitToIndexNow } = makeListener(
        fetchSpy as unknown as typeof fetch,
      );

      await listener.onStoreConfigUpdated();

      expect(queueAdd).not.toHaveBeenCalled();
      expect(submitToIndexNow).not.toHaveBeenCalled();
    });

    it('still dispatches when no locale registry is injected', async () => {
      // The registry is an @Optional() constructor slot, so a listener built
      // without it must not throw on the optional call.
      const fetchSpy = makeFetchSpy();
      const listener = new RevalidationListener(
        { add: jest.fn() } as never,
        { submitToIndexNow: jest.fn(), submitToGsc: jest.fn() } as never,
        { recordEngineResult: jest.fn() } as never,
        fetchSpy as unknown as typeof fetch,
      );

      await expect(listener.onStoreConfigUpdated()).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── S24.9: event-driven sitemap regen + IndexNow per DR-10 ────────────────

  describe('sitemap regen + IndexNow side effects (S24.9)', () => {
    it('enqueues a regen job + submits IndexNow on product slug change', async () => {
      const fetchSpy = makeFetchSpy();
      const { listener, queueAdd, submitToIndexNow } = makeListener(
        fetchSpy as unknown as typeof fetch,
      );

      await listener.onProductSlugChanged({
        productId: 'p1',
        oldSlug: 'old-slug',
        newSlug: 'new-slug',
      });

      // Deterministic jobId keyed on kind = dedup at concurrent-enqueue time.
      expect(queueAdd).toHaveBeenCalledTimes(1);
      const [, payload, opts] = queueAdd.mock.calls[0];
      expect(payload).toEqual({
        kind: 'products',
        triggeredBy: 'product.slug.changed',
      });
      expect(opts).toMatchObject({ jobId: 'regen-products' });

      // IndexNow gets old + new slugs, one URL per supported locale.
      expect(submitToIndexNow).toHaveBeenCalledTimes(1);
      const [urls, siteUrl] = submitToIndexNow.mock.calls[0];
      expect(siteUrl).toBe('https://atlas.example');
      expect(urls).toEqual(
        expect.arrayContaining([
          ...localeUrls('https://atlas.example', '/catalog/product/old-slug'),
          ...localeUrls('https://atlas.example', '/catalog/product/new-slug'),
        ]),
      );
    });

    it('enqueues regen + submits IndexNow on a visibility-relevant mutation (publish / live-edit)', async () => {
      const { listener, queueAdd, submitToIndexNow, recordEngineResult } = makeListener();

      await listener.onProductMutated(MUTATED_PUBLIC);

      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(queueAdd.mock.calls[0][1]).toEqual({
        kind: 'products',
        triggeredBy: 'product.mutated',
      });
      // shouldSubmitIndexNow=true means every locale URL for the slug is
      // submitted (DR-15).
      expect(submitToIndexNow).toHaveBeenCalledTimes(1);
      const [urls, siteUrl] = submitToIndexNow.mock.calls[0];
      expect(siteUrl).toBe('https://atlas.example');
      expect(urls).toEqual(
        expect.arrayContaining(localeUrls('https://atlas.example', '/catalog/product/widget')),
      );
      // DR-17: the IndexNow attempt is recorded to the SeoSubmission audit log.
      expect(recordEngineResult).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'auto-regen',
          engine: 'indexnow',
          targetType: 'url',
          requestedCount: supportedLocales().length,
          result: { accepted: true, submitted: 1 },
        }),
      );
    });

    it('enqueues regen but does NOT submit IndexNow when the mutation is not visibility-relevant (draft edit)', async () => {
      const { listener, queueAdd, submitToIndexNow } = makeListener();

      await listener.onProductMutated(MUTATED_PRIVATE);

      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(submitToIndexNow).not.toHaveBeenCalled();
    });

    it('enqueues a regen job + submits IndexNow on category slug change', async () => {
      const { listener, queueAdd, submitToIndexNow } = makeListener();

      await listener.onCategorySlugChanged({
        categoryId: 'c1',
        oldSlug: 'electronics',
        newSlug: 'electronics-pro',
      });

      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(queueAdd.mock.calls[0][1]).toEqual({
        kind: 'categories',
        triggeredBy: 'category.slug.changed',
      });

      expect(submitToIndexNow).toHaveBeenCalledTimes(1);
      const [urls] = submitToIndexNow.mock.calls[0];
      expect(urls).toEqual(
        expect.arrayContaining([
          ...localeUrls('https://atlas.example', '/catalog/electronics'),
          ...localeUrls('https://atlas.example', '/catalog/electronics-pro'),
        ]),
      );
    });

    it('enqueues a regen job + submits IndexNow on storefront section update (home)', async () => {
      const { listener, queueAdd, submitToIndexNow } = makeListener();

      await listener.onStorefrontSectionUpdated({ pageSlug: 'home' });

      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(queueAdd.mock.calls[0][1]).toMatchObject({ kind: 'pages' });

      const [urls] = submitToIndexNow.mock.calls[0];
      expect(urls).toEqual(localeUrls('https://atlas.example', '/'));
    });

    it('enqueues a regen job + submits IndexNow on storefront section update (non-home)', async () => {
      const { listener, queueAdd, submitToIndexNow } = makeListener();

      await listener.onStorefrontSectionUpdated({ pageSlug: 'about' });

      expect(queueAdd).toHaveBeenCalledTimes(1);
      const [urls] = submitToIndexNow.mock.calls[0];
      expect(urls).toEqual(localeUrls('https://atlas.example', '/about'));
    });

    it('skips IndexNow when SITE_URL is unset (regen still enqueues)', async () => {
      delete process.env['SITE_URL'];
      const { listener, queueAdd, submitToIndexNow } = makeListener();

      await listener.onProductSlugChanged({
        productId: 'p1',
        oldSlug: 'a',
        newSlug: 'b',
      });

      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(submitToIndexNow).not.toHaveBeenCalled();
    });

    it('does not throw when queue.add rejects (fire-and-forget)', async () => {
      const { listener, queueAdd } = makeListener();
      queueAdd.mockRejectedValueOnce(new Error('redis offline'));

      await expect(listener.onProductMutated()).resolves.toBeUndefined();
    });
  });
});
