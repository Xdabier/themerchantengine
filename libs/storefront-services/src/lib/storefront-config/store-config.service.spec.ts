import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../shared/api-client.token';
import { StoreConfigApiService } from './store-config.service';

function mockClient(get: ApiClient['get']): ApiClient {
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as ApiClient;
}

const payload = {
  identity: {
    storeName: 'Probe Store',
    contactEmail: 'contact@example.test',
    phone: null,
    socialLinks: { facebook: 'https://facebook.com/probestore' },
    logoUrl: null,
  },
  currency: { code: 'EUR', symbol: '€', decimalPlaces: 2 },
  locales: { supportedLocales: ['fr', 'en'], defaultLocale: 'fr' },
  inventory: { lowStockThreshold: 5 },
  pixels: {
    googleAnalyticsId: null,
    metaPixelId: null,
    tiktokPixelId: null,
    snapPixelId: null,
  },
};

describe('StoreConfigApiService', () => {
  it('reads the public endpoint and unwraps the envelope', async () => {
    const get = vi.fn(async () => ({ data: payload })) as ApiClient['get'];
    const svc = new StoreConfigApiService(mockClient(get));

    const config = await svc.get();

    expect(get).toHaveBeenCalledWith('/v1/storefront/config');
    expect(config.identity.contactEmail).toBe('contact@example.test');
    expect(config.currency.code).toBe('EUR');
  });

  it('strips a key the endpoint grew that no consumer asked for', async () => {
    const get = vi.fn(async () => ({
      data: { ...payload, secrets: { key: 'nope' } },
    })) as ApiClient['get'];
    const svc = new StoreConfigApiService(mockClient(get));

    expect(await svc.get()).not.toHaveProperty('secrets');
  });

  it('rejects an unresolved Translatable store name rather than passing an object on', async () => {
    const get = vi.fn(async () => ({
      data: {
        ...payload,
        identity: { ...payload.identity, storeName: { default: 'Probe Store' } },
      },
    })) as ApiClient['get'];
    const svc = new StoreConfigApiService(mockClient(get));

    await expect(svc.get()).rejects.toThrow();
  });
});
