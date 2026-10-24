import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { SectionsService, STOREFRONT_SECTIONS_STALE_TIME_MS } from './sections.service';

function mockClient(get: ApiClient['get']): ApiClient {
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as ApiClient;
}

const validHomeResponse = () => ({
  data: [
    {
      id: 'sec-hero-1',
      pageSlug: 'home',
      type: 'HERO' as const,
      sortOrder: 0,
      isVisible: true,
      title: 'Welcome',
      visibleFrom: null,
      visibleUntil: null,
      config: {
        assetId: 'asset-hero-1',
        assetUrl: 'https://cdn.example/hero.webp',
        eyebrow: 'Summer',
        headline: 'Sun + Surf',
        body: 'New collection drop',
        cta: 'Shop now',
        ctaHref: '/catalog',
      },
    },
    {
      id: 'sec-trust-1',
      pageSlug: 'home',
      type: 'TRUST_SIGNALS' as const,
      sortOrder: 1,
      isVisible: true,
      title: null,
      visibleFrom: null,
      visibleUntil: null,
      config: {
        items: [{ kind: 'delivery' as const, title: 'Fast', subtitle: 'Two-day delivery' }],
      },
    },
  ],
  meta: { pageSlug: 'home', total: 2 },
});

describe('SectionsService', () => {
  it('exposes the SSG ISR window as a constant', () => {
    expect(STOREFRONT_SECTIONS_STALE_TIME_MS).toBe(10 * 60 * 1000);
  });

  it('fetches + Zod-validates the wrapped sections envelope', async () => {
    const get = vi.fn(async () => validHomeResponse()) as ApiClient['get'];
    const svc = new SectionsService(mockClient(get));

    const result = await svc.getByPageSlug('home');

    expect(get).toHaveBeenCalledWith('/v1/storefront/sections/home');
    expect(result.meta).toEqual({ pageSlug: 'home', total: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.data[0].type).toBe('HERO');
    expect(result.data[1].type).toBe('TRUST_SIGNALS');
  });

  it('exposes assetUrl on hydrated HERO sections', async () => {
    const get = vi.fn(async () => validHomeResponse()) as ApiClient['get'];
    const svc = new SectionsService(mockClient(get));

    const result = await svc.getByPageSlug('home');
    const hero = result.data.find((s) => s.type === 'HERO');
    if (!hero || hero.type !== 'HERO') throw new Error('expected HERO row');
    expect(hero.config.assetUrl).toBe('https://cdn.example/hero.webp');
  });

  it('rejects an empty pageSlug at the client', async () => {
    const svc = new SectionsService(mockClient(vi.fn() as ApiClient['get']));
    await expect(svc.getByPageSlug('')).rejects.toThrow();
  });

  it('rejects an invalid pageSlug shape (uppercase / spaces)', async () => {
    const svc = new SectionsService(mockClient(vi.fn() as ApiClient['get']));
    await expect(svc.getByPageSlug('Home Page')).rejects.toThrow();
  });

  it('throws on an unknown discriminator value', async () => {
    const get = vi.fn(async () => ({
      data: [
        {
          id: 'sec-x',
          pageSlug: 'home',
          type: 'TESTIMONIALS',
          sortOrder: 0,
          isVisible: true,
          config: {},
        },
      ],
      meta: { pageSlug: 'home', total: 1 },
    })) as ApiClient['get'];
    const svc = new SectionsService(mockClient(get));
    await expect(svc.getByPageSlug('home')).rejects.toThrow();
  });

  it('URL-encodes the pageSlug', async () => {
    const get = vi.fn(async () => ({
      data: [],
      meta: { pageSlug: 'home', total: 0 },
    })) as ApiClient['get'];
    const svc = new SectionsService(mockClient(get));
    await svc.getByPageSlug('home');
    expect(get).toHaveBeenCalledWith('/v1/storefront/sections/home');
  });
});
