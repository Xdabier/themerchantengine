import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  IS_PUBLIC_KEY,
  OWNER_GUARD_KEY,
  PERMISSIONS_KEY,
  PUBLIC_CACHEABLE_KEY,
} from '@common/decorators';
import { entityPath } from '../seo/site-url';
import {
  StorefrontConfigAdminController,
  StorefrontConfigStorefrontController,
} from './storefront-config.controller';
import { StorefrontConfigService } from './storefront-config.service';

/**
 * Decorator audit for `GET /v1/storefront/config`.
 *
 * The route carries store identity, currency, locales and pixel ids to an
 * anonymous visitor. Both directions of a decoration change break something:
 * adding a guard takes SSR boot down for every first-time reader, and adding a
 * browser cache header would hold a renamed store or a rotated pixel in a CDN
 * long after the operator changed it. Pinned here rather than left to review.
 */
describe('StorefrontConfigStorefrontController: public config decorator audit', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = StorefrontConfigStorefrontController.prototype as any;

  it('is @Public()', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.getConfig)).toBe(true);
  });

  it('carries no admin @Permissions()', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.getConfig)).toBeUndefined();
  });

  it('carries no @OwnerGuard()', () => {
    expect(Reflect.getMetadata(OWNER_GUARD_KEY, proto.getConfig)).toBeFalsy();
  });

  it('sets no browser cache header, leaving the §3.15-A no-store default', () => {
    expect(Reflect.getMetadata(PUBLIC_CACHEABLE_KEY, proto.getConfig)).toBeUndefined();
  });
});

describe('StorefrontConfigAdminController — public config', () => {
  let controller: StorefrontConfigAdminController;
  let get: jest.Mock;

  async function build(env: Record<string, string | undefined>): Promise<void> {
    get = jest.fn((key: string) => env[key]);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorefrontConfigAdminController],
      providers: [
        { provide: StorefrontConfigService, useValue: {} },
        { provide: ConfigService, useValue: { get } },
      ],
    }).compile();
    controller = module.get(StorefrontConfigAdminController);
  }

  type Config = {
    baseUrl: string;
    locales: string[];
    defaultLocale: string;
    productPathTemplate: string;
  };

  it('returns the payload unwrapped, leaving the envelope to the interceptor', async () => {
    await build({ STOREFRONT_PUBLIC_BASE_URL: 'https://example.test' });
    expect(controller.getPublicConfig() as Record<string, unknown>).not.toHaveProperty('data');
  });

  it('reads the canonical origin variable', async () => {
    await build({ STOREFRONT_PUBLIC_BASE_URL: 'https://example.test' });
    expect((controller.getPublicConfig() as Config).baseUrl).toBe('https://example.test');
  });

  it('falls back to the legacy SITE_URL, which older deploys still set', async () => {
    await build({ SITE_URL: 'https://legacy.example' });
    expect((controller.getPublicConfig() as Config).baseUrl).toBe('https://legacy.example');
  });

  it('trims a trailing slash so joining a path cannot double it', async () => {
    await build({ STOREFRONT_PUBLIC_BASE_URL: 'https://example.test/' });
    expect((controller.getPublicConfig() as Config).baseUrl).toBe('https://example.test');
  });

  /**
   * The template must be DERIVED, never written as a literal here. Sitemap,
   * canonical, JSON-LD and the manual reindex all emit `entityPath`'s shape; a
   * second hand-written copy is exactly how an admin deep link drifts from the
   * URL a crawler was told about.
   */
  it('derives the product path template from entityPath rather than restating it', async () => {
    await build({ STOREFRONT_PUBLIC_BASE_URL: 'https://example.test' });
    const { productPathTemplate } = controller.getPublicConfig() as Config;
    expect(productPathTemplate).toBe(entityPath('product', '{slug}', '{locale}'));
  });

  it('the template substitutes into the same URL entityPath would build', async () => {
    await build({ STOREFRONT_PUBLIC_BASE_URL: 'https://example.test' });
    const { baseUrl, productPathTemplate } = controller.getPublicConfig() as Config;
    const built =
      baseUrl + productPathTemplate.replace('{locale}', 'fr').replace('{slug}', 'brosse');
    expect(built).toBe(`https://example.test${entityPath('product', 'brosse', 'fr')}`);
  });

  it('advertises the store locales with the default first', async () => {
    await build({ STOREFRONT_PUBLIC_BASE_URL: 'https://example.test' });
    const { locales, defaultLocale } = controller.getPublicConfig() as Config;
    expect(locales.length).toBeGreaterThan(0);
    expect(locales[0]).toBe(defaultLocale);
  });
});
