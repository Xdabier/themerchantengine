import { PLATFORM_ID, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StoreConfigApiService, StoreRuntimeConfigApiService } from '@storefront-services';
import {
  NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
  type StorefrontConfig,
  type StorefrontRuntimeConfig,
} from '@storefront-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STORE_CONFIG_STATE_KEY,
  STORE_RUNTIME_CONFIG_STATE_KEY,
  StoreConfigService,
} from './store-config.service';

/**
 * The service now fronts two endpoints: the runtime config (identity, brand,
 * locale set, money, domains) and the narrower one that still owns the social
 * links, the vendor pixels and the low-stock threshold until E2.6 folds them
 * in. They answer independently, and most of what is asserted below is that a
 * failure on one never takes the other's values down with it.
 */

const NEUTRAL_CURRENCY = NEUTRAL_STOREFRONT_RUNTIME_CONFIG.money.currencyCode;

function legacyPayload(overrides: Partial<StorefrontConfig> = {}): StorefrontConfig {
  return {
    identity: {
      storeName: 'Probe Store',
      contactEmail: 'legacy@example.test',
      phone: '+10000000000',
      socialLinks: { facebook: 'https://facebook.com/probe' },
      logoUrl: null,
    },
    currency: { code: 'EUR', symbol: '€', decimalPlaces: 2 },
    locales: { supportedLocales: ['fr', 'en'], defaultLocale: 'fr' },
    inventory: { lowStockThreshold: 12 },
    pixels: {
      googleAnalyticsId: 'G-TEST',
      metaPixelId: null,
      tiktokPixelId: null,
      snapPixelId: null,
    },
    ...overrides,
  } as StorefrontConfig;
}

function runtimePayload(): StorefrontRuntimeConfig {
  return {
    ...NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
    identity: {
      ...NEUTRAL_STOREFRONT_RUNTIME_CONFIG.identity,
      storeName: 'Probe Store',
      contact: { email: 'hello@example.test', phone: '+10000000001' },
    },
    money: { ...NEUTRAL_STOREFRONT_RUNTIME_CONFIG.money, currencyCode: 'EUR', symbol: '€' },
  };
}

function build(options: {
  platform: 'server' | 'browser';
  get?: () => Promise<StorefrontConfig>;
  getRuntime?: () => Promise<StorefrontRuntimeConfig>;
  transferred?: StorefrontConfig;
  transferredRuntime?: StorefrontRuntimeConfig;
}) {
  const get = options.get ?? vi.fn(async () => legacyPayload());
  const getRuntime = options.getRuntime ?? vi.fn(async () => runtimePayload());
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: options.platform },
      { provide: StoreConfigApiService, useValue: { get } },
      { provide: StoreRuntimeConfigApiService, useValue: { get: getRuntime } },
    ],
  });
  const transferState = TestBed.inject(TransferState);
  if (options.transferred) transferState.set(STORE_CONFIG_STATE_KEY, options.transferred);
  if (options.transferredRuntime) {
    transferState.set(STORE_RUNTIME_CONFIG_STATE_KEY, options.transferredRuntime);
  }
  return { service: TestBed.inject(StoreConfigService), get, getRuntime, transferState };
}

const failing = <T>(message: string) =>
  vi.fn(async () => {
    throw new Error(message);
  }) as unknown as () => Promise<T>;

describe('StoreConfigService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe('defaults', () => {
    it('runs on the committed neutral config before any load resolves', () => {
      // An unreachable endpoint must leave a complete storefront standing, not
      // a half-configured one. The neutral config is that complete storefront.
      const { service } = build({ platform: 'browser' });

      expect(service.currencyCode()).toBe(NEUTRAL_CURRENCY);
      expect(service.runtime()).toEqual(NEUTRAL_STOREFRONT_RUNTIME_CONFIG);
      expect(service.runtimeLoaded()).toBe(false);
      expect(service.lowStockThreshold()).toBe(5);
      expect(service.socialLinks()).toEqual([]);
      expect(service.logoUrl()).toBeNull();
      expect(service.pixels()).toEqual({
        googleAnalyticsId: null,
        metaPixelId: null,
        tiktokPixelId: null,
        snapPixelId: null,
      });
    });

    it('carries a complete palette on the neutral config', () => {
      // E2.2 renders the token block from this, so it may never be partial.
      const { service } = build({ platform: 'browser' });
      const palette = service.brand().generatedPalette;

      expect(palette?.tokens['--brand-primary']).toMatch(/^#[0-9a-f]{6}$/);
      expect(palette?.tokens['--brand-bg']).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  describe('server pass', () => {
    it('fetches both configs once and transfers each under its own key', async () => {
      const { service, get, getRuntime, transferState } = build({ platform: 'server' });

      await service.load();

      expect(get).toHaveBeenCalledTimes(1);
      expect(getRuntime).toHaveBeenCalledTimes(1);
      expect(transferState.get(STORE_CONFIG_STATE_KEY, null)).toEqual(legacyPayload());
      expect(transferState.get(STORE_RUNTIME_CONFIG_STATE_KEY, null)).toEqual(runtimePayload());
      expect(service.currencyCode()).toBe('EUR');
      expect(service.contactEmail()).toBe('hello@example.test');
    });

    it('leaves the neutral config in place when the runtime fetch fails', async () => {
      const { service, transferState } = build({
        platform: 'server',
        getRuntime: failing<StorefrontRuntimeConfig>('ECONNREFUSED'),
      });

      await service.load();

      expect(service.currencyCode()).toBe(NEUTRAL_CURRENCY);
      expect(service.runtimeLoaded()).toBe(false);
      expect(transferState.get(STORE_RUNTIME_CONFIG_STATE_KEY, null)).toBeNull();
    });

    it('keeps the runtime config when only the narrow endpoint fails', async () => {
      // The two reads are independent; one outage must not blank the other.
      const { service } = build({
        platform: 'server',
        get: failing<StorefrontConfig>('boom'),
      });

      await service.load();

      expect(service.loaded()).toBe(false);
      expect(service.pixels().googleAnalyticsId).toBeNull();
      expect(service.runtimeLoaded()).toBe(true);
      expect(service.currencyCode()).toBe('EUR');
    });

    it('keeps the narrow config when only the runtime endpoint fails', async () => {
      const { service } = build({
        platform: 'server',
        getRuntime: failing<StorefrontRuntimeConfig>('boom'),
      });

      await service.load();

      expect(service.loaded()).toBe(true);
      expect(service.pixels().googleAnalyticsId).toBe('G-TEST');
      expect(service.runtimeLoaded()).toBe(false);
    });
  });

  describe('browser pass', () => {
    it('reads both transferred payloads without calling the API', async () => {
      const { service, get, getRuntime } = build({
        platform: 'browser',
        transferred: legacyPayload(),
        transferredRuntime: runtimePayload(),
      });

      await service.load();

      expect(get).not.toHaveBeenCalled();
      expect(getRuntime).not.toHaveBeenCalled();
      expect(service.currencyCode()).toBe('EUR');
      expect(service.lowStockThreshold()).toBe(12);
    });

    it('falls back to a fetch when nothing was transferred', async () => {
      const { service, get, getRuntime } = build({ platform: 'browser' });

      await service.load();

      expect(get).toHaveBeenCalledTimes(1);
      expect(getRuntime).toHaveBeenCalledTimes(1);
      expect(service.currencyCode()).toBe('EUR');
    });

    it('never applies a malformed transferred runtime payload, and refetches', async () => {
      // The payload travels through the SSR HTML, so it is the same untrusted
      // boundary the API response is. An unresolved Translatable is the shape
      // to catch: it means the locale headers did not travel, and rendering it
      // would put `[object Object]` where the store name belongs.
      const { service, getRuntime } = build({
        platform: 'browser',
        transferredRuntime: {
          ...runtimePayload(),
          identity: { ...runtimePayload().identity, storeName: { default: 'Probe Store' } },
        } as unknown as StorefrontRuntimeConfig,
      });

      await service.load();

      expect(getRuntime).toHaveBeenCalledTimes(1);
      expect(service.storeName()).toBe('Probe Store');
    });

    it('keeps the neutral config when the transfer is malformed and the refetch fails', async () => {
      const { service } = build({
        platform: 'browser',
        getRuntime: failing<StorefrontRuntimeConfig>('offline'),
        transferredRuntime: { money: 7 } as unknown as StorefrontRuntimeConfig,
      });

      await service.load();

      expect(service.currencyCode()).toBe(NEUTRAL_CURRENCY);
      expect(service.runtimeLoaded()).toBe(false);
    });

    it('does not refetch on a second load', async () => {
      const { service, get, getRuntime } = build({ platform: 'browser' });

      await service.load();
      await service.load();

      expect(get).toHaveBeenCalledTimes(1);
      expect(getRuntime).toHaveBeenCalledTimes(1);
    });
  });

  describe('projections', () => {
    it('sorts the social links into a stable list the footer can render', async () => {
      const { service } = build({
        platform: 'browser',
        transferred: legacyPayload({
          identity: {
            storeName: 'Probe Store',
            contactEmail: null,
            phone: null,
            logoUrl: null,
            socialLinks: {
              instagram: 'https://instagram.com/probe',
              facebook: 'https://facebook.com/probe',
            },
          },
        }),
      });

      await service.load();

      expect(service.socialLinks()).toEqual([
        { platform: 'facebook', url: 'https://facebook.com/probe' },
        { platform: 'instagram', url: 'https://instagram.com/probe' },
      ]);
    });

    it('exposes the pixel ids for the tag loader', async () => {
      const { service } = build({ platform: 'browser', transferred: legacyPayload() });

      await service.load();

      expect(service.pixels().googleAnalyticsId).toBe('G-TEST');
    });

    it('takes the contact details from the runtime config, not the narrow one', async () => {
      // Both endpoints carry a contact block. The runtime one is the source
      // the admin identity screen writes, so it wins.
      const { service } = build({
        platform: 'browser',
        transferred: legacyPayload(),
        transferredRuntime: runtimePayload(),
      });

      await service.load();

      expect(service.contactEmail()).toBe('hello@example.test');
      expect(service.phone()).toBe('+10000000001');
    });
  });
});
