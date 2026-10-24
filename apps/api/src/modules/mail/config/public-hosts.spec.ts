/**
 * The public origins that appear inside outbound mail links (D7).
 *
 * A wrong host here does not fail loudly — it sends a customer to another
 * client's domain, which is exactly what the seven pre-D7 call sites risked.
 * So every resolution layer is pinned: the configured value, the process.env
 * fallback for a bare ConfigService, the development default, and the
 * trailing-slash trim that keeps `${base}/account/...` from doubling its slash.
 *
 * The two helpers read different keys and must never answer for each other.
 */
import type { ConfigService } from '@nestjs/config';
import { adminBaseUrl, storefrontBaseUrl } from './public-hosts';

/** Mirrors `ConfigService.get(key)` — key-aware, so the two hosts stay distinct. */
function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const ENV_KEYS = ['STOREFRONT_PUBLIC_BASE_URL', 'ADMIN_PUBLIC_BASE_URL'] as const;

describe('public-hosts', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('storefrontBaseUrl', () => {
    it('returns the configured STOREFRONT_PUBLIC_BASE_URL', () => {
      const config = fakeConfig({ STOREFRONT_PUBLIC_BASE_URL: 'https://staging.example.test' });
      expect(storefrontBaseUrl(config)).toBe('https://staging.example.test');
    });

    it('falls back to process.env when the config has no value', () => {
      process.env.STOREFRONT_PUBLIC_BASE_URL = 'https://env.example.test';
      expect(storefrontBaseUrl(fakeConfig({}))).toBe('https://env.example.test');
    });

    it('falls back to process.env when no config is passed at all', () => {
      process.env.STOREFRONT_PUBLIC_BASE_URL = 'https://env.example.test';
      expect(storefrontBaseUrl()).toBe('https://env.example.test');
    });

    it('prefers the configured value over process.env', () => {
      process.env.STOREFRONT_PUBLIC_BASE_URL = 'https://env.example.test';
      const config = fakeConfig({ STOREFRONT_PUBLIC_BASE_URL: 'https://config.example.test' });
      expect(storefrontBaseUrl(config)).toBe('https://config.example.test');
    });

    it('defaults to the example.test storefront when neither is set', () => {
      expect(storefrontBaseUrl(fakeConfig({}))).toBe('https://storefront.example.test');
      expect(storefrontBaseUrl()).toBe('https://storefront.example.test');
    });

    it('trims a trailing slash on the configured value', () => {
      expect(
        storefrontBaseUrl(
          fakeConfig({ STOREFRONT_PUBLIC_BASE_URL: 'https://storefront.example.test/' }),
        ),
      ).toBe('https://storefront.example.test');
    });

    it('trims repeated trailing slashes from the process.env value too', () => {
      process.env.STOREFRONT_PUBLIC_BASE_URL = 'https://storefront.example.test///';
      expect(storefrontBaseUrl(fakeConfig({}))).toBe('https://storefront.example.test');
    });

    it('never answers with the admin host', () => {
      const config = fakeConfig({ ADMIN_PUBLIC_BASE_URL: 'https://admin.example.test' });
      expect(storefrontBaseUrl(config)).toBe('https://storefront.example.test');
    });
  });

  describe('adminBaseUrl', () => {
    it('returns the configured ADMIN_PUBLIC_BASE_URL', () => {
      const config = fakeConfig({ ADMIN_PUBLIC_BASE_URL: 'https://staging-admin.example.test' });
      expect(adminBaseUrl(config)).toBe('https://staging-admin.example.test');
    });

    it('falls back to process.env when the config has no value', () => {
      process.env.ADMIN_PUBLIC_BASE_URL = 'https://env-admin.example.test';
      expect(adminBaseUrl(fakeConfig({}))).toBe('https://env-admin.example.test');
    });

    it('falls back to process.env when no config is passed at all', () => {
      process.env.ADMIN_PUBLIC_BASE_URL = 'https://env-admin.example.test';
      expect(adminBaseUrl()).toBe('https://env-admin.example.test');
    });

    it('prefers the configured value over process.env', () => {
      process.env.ADMIN_PUBLIC_BASE_URL = 'https://env-admin.example.test';
      const config = fakeConfig({ ADMIN_PUBLIC_BASE_URL: 'https://config-admin.example.test' });
      expect(adminBaseUrl(config)).toBe('https://config-admin.example.test');
    });

    it('defaults to the example.test admin host when neither is set', () => {
      expect(adminBaseUrl(fakeConfig({}))).toBe('https://admin.example.test');
      expect(adminBaseUrl()).toBe('https://admin.example.test');
    });

    it('trims a trailing slash on the configured value', () => {
      expect(
        adminBaseUrl(fakeConfig({ ADMIN_PUBLIC_BASE_URL: 'https://admin.example.test/' })),
      ).toBe('https://admin.example.test');
    });

    it('trims repeated trailing slashes from the process.env value too', () => {
      process.env.ADMIN_PUBLIC_BASE_URL = 'https://admin.example.test///';
      expect(adminBaseUrl(fakeConfig({}))).toBe('https://admin.example.test');
    });

    it('never answers with the storefront host', () => {
      const config = fakeConfig({ STOREFRONT_PUBLIC_BASE_URL: 'https://storefront.example.test' });
      expect(adminBaseUrl(config)).toBe('https://admin.example.test');
    });
  });

  // A staff invite links to the admin dashboard while the same mail's other
  // links go to the shop — the two must not collapse onto one origin.
  it('keeps the two origins apart when both are configured', () => {
    const config = fakeConfig({
      STOREFRONT_PUBLIC_BASE_URL: 'https://storefront.example.test',
      ADMIN_PUBLIC_BASE_URL: 'https://admin.example.test',
    });
    expect(storefrontBaseUrl(config)).toBe('https://storefront.example.test');
    expect(adminBaseUrl(config)).toBe('https://admin.example.test');
  });
});
