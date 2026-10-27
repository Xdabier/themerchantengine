import { describe, expect, it } from 'vitest';

import { storefrontConfigResponseSchema, storefrontConfigSchema } from './config.schemas';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    identity: {
      storeName: 'Probe Store',
      contactEmail: null,
      phone: null,
      socialLinks: {},
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
    ...overrides,
  };
}

describe('storefrontConfigSchema', () => {
  it('parses the shape the API serves', () => {
    const parsed = storefrontConfigSchema.parse(payload());
    expect(parsed.currency.code).toBe('EUR');
    expect(parsed.inventory.lowStockThreshold).toBe(5);
  });

  it('strips a key the API added but no consumer asked for', () => {
    // Parse-do-not-trust at the boundary: a future widening of the endpoint
    // must not reach a template that was never written for it.
    const parsed = storefrontConfigSchema.parse(
      payload({ secrets: { stripeKey: 'sk_live_nope' } }) as never,
    );
    expect(parsed).not.toHaveProperty('secrets');
  });

  it('rejects a Translatable store name so the caller falls back instead of rendering an object', () => {
    // The global interceptor resolves Translatable fields against the request
    // locale. An object arriving here means the locale header never travelled.
    const result = storefrontConfigSchema.safeParse(
      payload({
        identity: {
          storeName: { default: 'Probe Store', fr: 'Probe Store' },
          contactEmail: null,
          phone: null,
          socialLinks: {},
          logoUrl: null,
        },
      }) as never,
    );
    expect(result.success).toBe(false);
  });

  it('rejects a currency code that is not ISO shaped', () => {
    const result = storefrontConfigSchema.safeParse(
      payload({ currency: { code: 'dinar', symbol: 'DT', decimalPlaces: 3 } }) as never,
    );
    expect(result.success).toBe(false);
  });

  it('defaults the optional identity fields so a sparse payload still parses', () => {
    const parsed = storefrontConfigSchema.parse(
      payload({ identity: { storeName: 'Probe Store' } }) as never,
    );
    expect(parsed.identity.contactEmail).toBeNull();
    expect(parsed.identity.phone).toBeNull();
    expect(parsed.identity.socialLinks).toEqual({});
    expect(parsed.identity.logoUrl).toBeNull();
  });

  it('keeps the configured social platforms', () => {
    const parsed = storefrontConfigSchema.parse(
      payload({
        identity: {
          storeName: 'Probe Store',
          socialLinks: { facebook: 'https://facebook.com/probestore' },
        },
      }) as never,
    );
    expect(parsed.identity.socialLinks).toEqual({ facebook: 'https://facebook.com/probestore' });
  });

  it('rejects a negative low-stock threshold, which would grade every variant low', () => {
    const result = storefrontConfigSchema.safeParse(
      payload({ inventory: { lowStockThreshold: -1 } }) as never,
    );
    expect(result.success).toBe(false);
  });

  it('accepts a zero threshold, which is the operator opt-out', () => {
    const parsed = storefrontConfigSchema.parse(
      payload({ inventory: { lowStockThreshold: 0 } }) as never,
    );
    expect(parsed.inventory.lowStockThreshold).toBe(0);
  });

  it('unwraps the response envelope', () => {
    const parsed = storefrontConfigResponseSchema.parse({ data: payload() });
    expect(parsed.data.locales.defaultLocale).toBe('fr');
  });
});
