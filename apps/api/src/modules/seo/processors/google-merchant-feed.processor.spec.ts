import {
  FR_EN_LOCALE_SET,
  NEUTRAL_LOCALE_SET,
  registerScratchLocale,
  storeLocales,
} from '@common/locale';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import { GoogleMerchantFeedProcessor } from './google-merchant-feed.processor';
import {
  GOOGLE_MERCHANT_FEED_CACHE_KEY,
  GOOGLE_MERCHANT_FEED_QUEUE,
  SEO_REDIS_CLIENT,
  SEO_SETTINGS_SERVICE,
} from '../seo.constants';

/**
 * This processor had no spec of any kind, which is how three feed-invalidating
 * defects shipped and stayed: a placeholder `store.example.com` host, a path
 * shape the storefront does not serve, and a duplicated `<g:id>` per item.
 * Google rejects on all three, item by item, so the feed would have looked
 * healthy from this side and been empty on the other.
 */

const mockPrisma = {
  product: { findMany: jest.fn() },
};

const mockRedis = { set: jest.fn() };
const mockQueue = { add: jest.fn() };
const mockCurrencies = { getStore: jest.fn() };

function makeProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prod-1',
    slug: 'turbine-nsk-pana-max',
    name: {
      default: 'Turbine NSK Pana-Max',
      fr: 'Turbine NSK Pana-Max',
      en: 'NSK Pana-Max turbine',
    },
    description: {
      default: 'Turbine a air comprime, raccord Midwest 4 trous.',
      fr: 'Turbine a air comprime, raccord Midwest 4 trous.',
      en: 'Air turbine, Midwest 4-hole coupling.',
    },
    variants: [
      { id: 'v1', sku: 'NSK-PM-01', price: 1290.5, stockLevels: [{ onHand: 4, reserved: 1 }] },
    ],
    assets: [],
    ...overrides,
  };
}

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('GoogleMerchantFeedProcessor', () => {
  let processor: GoogleMerchantFeedProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCurrencies.getStore.mockResolvedValue({ code: 'LYD', decimalPlaces: 3 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleMerchantFeedProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(GOOGLE_MERCHANT_FEED_QUEUE), useValue: mockQueue },
        { provide: SEO_REDIS_CLIENT, useValue: mockRedis },
        { provide: CurrenciesService, useValue: mockCurrencies },
        {
          provide: SEO_SETTINGS_SERVICE,
          useValue: {
            get: async (key: string) =>
              key === 'storeName'
                ? { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' }
                : undefined,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'STOREFRONT_PUBLIC_BASE_URL' ? 'https://atlas.example' : undefined,
          },
        },
      ],
    }).compile();

    processor = module.get(GoogleMerchantFeedProcessor);
  });

  /** Runs the job and returns whatever was written to Redis. */
  async function generate(products: Array<Record<string, unknown>>): Promise<string> {
    mockPrisma.product.findMany.mockResolvedValue(products);
    await processor.process({} as never);
    const [key, body] = mockRedis.set.mock.calls[0] as [string, string];
    expect(key).toBe(GOOGLE_MERCHANT_FEED_CACHE_KEY);
    return body;
  }

  describe('<g:link>', () => {
    it('points at the live storefront route, derived from entityPath', async () => {
      const feed = await generate([makeProduct()]);
      expect(feed).toContain(
        '<g:link>https://atlas.example/fr/catalog/product/turbine-nsk-pana-max</g:link>',
      );
    });

    it('carries no placeholder host and no /products/ path shape', async () => {
      const feed = await generate([makeProduct()]);
      expect(feed).not.toContain('store.example.com');
      expect(feed).not.toContain('example.com');
      // The old shape was `/products/<slug>` with no locale segment. The live
      // route is `/<locale>/catalog/product/<slug>`; asserting the absence of
      // the old one is what stops a partial revert passing.
      expect(feed).not.toMatch(/<g:link>[^<]*\/products\//);
    });

    it('follows the configured base URL rather than hardcoding a host', async () => {
      const feed = await generate([makeProduct()]);
      expect(feed).toContain('<link>https://atlas.example</link>');
    });
  });

  describe('<g:id>', () => {
    it('appears exactly once per item', async () => {
      const feed = await generate([makeProduct()]);
      const ids = feed.match(/<g:id>/g) ?? [];
      expect(ids).toHaveLength(1);
    });

    it('still appears once per item across several items', async () => {
      const feed = await generate([
        makeProduct(),
        makeProduct({ id: 'prod-2', slug: 'fraise-diamantee' }),
      ]);
      expect((feed.match(/<g:id>/g) ?? []).length).toBe(2);
      expect(feed).toContain('<g:id>prod-1</g:id>');
      expect(feed).toContain('<g:id>prod-2</g:id>');
    });
  });

  describe('required attributes', () => {
    it('emits a description, which Google rejects an item for missing', async () => {
      const feed = await generate([makeProduct()]);
      expect(feed).toContain('<g:description><![CDATA[Turbine a air comprime');
    });

    it('falls back to the title when a product has no description', async () => {
      const feed = await generate([makeProduct({ description: null })]);
      expect(feed).toContain('<g:description><![CDATA[Turbine NSK Pana-Max]]></g:description>');
    });

    it('emits the channel-level link and description', async () => {
      const feed = await generate([makeProduct()]);
      expect(feed).toContain('<title>Atlas Supplies</title>');
      expect(feed).toContain('<description>Catalogue Atlas Supplies</description>');
    });
  });

  describe('locale and currency', () => {
    it('resolves Translatable copy in the default locale, not the raw object', async () => {
      const feed = await generate([makeProduct()]);
      expect(feed).toContain('<g:title><![CDATA[Turbine NSK Pana-Max]]></g:title>');
      expect(feed).not.toContain('[object Object]');
      // French is the default, so the English variant must not be what ships.
      expect(feed).not.toContain('NSK Pana-Max turbine');
    });

    it('falls through to the store default rung for a product with no fr translation', async () => {
      // The middle rung is the store default locale (DR-31); this store's is en.
      storeLocales.set({
        supportedLocales: ['fr', 'en'],
        defaultLocale: 'en',
        rtlLocales: [],
        timezone: 'UTC',
      });
      try {
        // The feed used to carry its own two-rung resolver (locale, then
        // default), so an under-translated product shipped its `default` text
        // to Google while a French customer on the product page saw the `en`
        // text the global interceptor falls through to. Two catalogues, one
        // store. `default` is deliberately DIFFERENT from `en` here, because
        // that is the only shape in which the missing rung is visible.
        const feed = await generate([
          makeProduct({
            name: { default: 'INTERNAL-SKU-REF', en: 'Diamond bur, medium grit' },
            description: { default: 'INTERNAL-DESC', en: 'Medium grit, ISO 806.' },
          }),
        ]);
        expect(feed).toContain('<g:title><![CDATA[Diamond bur, medium grit]]></g:title>');
        expect(feed).toContain('<g:description><![CDATA[Medium grit, ISO 806.]]></g:description>');
        expect(feed).not.toContain('INTERNAL-SKU-REF');
        expect(feed).not.toContain('INTERNAL-DESC');
      } finally {
        storeLocales.set(NEUTRAL_LOCALE_SET);
      }
    });

    it.each([
      ['en', 'Atlas Supplies catalogue'],
      ['ar', 'كتالوج Atlas Supplies'],
    ])('words the channel description in the %s default locale', async (locale, expected) => {
      storeLocales.set({
        supportedLocales: ['fr', 'en', 'ar'],
        defaultLocale: locale,
        rtlLocales: ['ar'],
        timezone: 'UTC',
      });
      const feed = await generate([makeProduct()]);
      expect(feed).toContain(`<description>${expected}</description>`);
    });

    it('ships the bare store name, not an English word, for a locale with no channel copy', async () => {
      const remove = registerScratchLocale('xx');
      storeLocales.set({
        supportedLocales: ['fr', 'en', 'xx'],
        defaultLocale: 'xx',
        rtlLocales: [],
        timezone: 'UTC',
      });
      try {
        const feed = await generate([makeProduct()]);
        expect(feed).toContain('<description>Atlas Supplies</description>');
        expect(feed).not.toContain('catalogue');
      } finally {
        remove();
        storeLocales.set(NEUTRAL_LOCALE_SET);
      }
    });

    it('prices in the live store currency at its own precision', async () => {
      const feed = await generate([makeProduct()]);
      expect(feed).toContain('<g:price>1290.500 LYD</g:price>');
      expect(feed).not.toContain('EUR');
      expect(feed).not.toContain('USD');
    });
  });

  describe('availability', () => {
    it('is in stock when on-hand exceeds reserved', async () => {
      const feed = await generate([makeProduct()]);
      expect(feed).toContain('<g:availability>in stock</g:availability>');
    });

    it('clamps each location, so one over-reserved location cannot eat another', async () => {
      // Same divergence D8.33c closed on the search path. Unclamped, the first
      // location contributes -3 and cancels the second, reporting a stocked
      // product as out of stock.
      const feed = await generate([
        makeProduct({
          variants: [
            {
              id: 'v1',
              price: 10,
              stockLevels: [
                { onHand: 1, reserved: 4 },
                { onHand: 6, reserved: 0 },
              ],
            },
          ],
        }),
      ]);
      expect(feed).toContain('<g:availability>in stock</g:availability>');
    });

    it('is out of stock when reserved consumes the on-hand count', async () => {
      const feed = await generate([
        makeProduct({
          variants: [{ id: 'v1', price: 10, stockLevels: [{ onHand: 2, reserved: 2 }] }],
        }),
      ]);
      expect(feed).toContain('<g:availability>out of stock</g:availability>');
    });
  });

  describe('XML safety', () => {
    it('does not let a description close its own CDATA section', async () => {
      const feed = await generate([
        makeProduct({ description: { default: 'edge case ]]> injected' } }),
      ]);
      // The terminator is split, so the section stays open through the value.
      expect(feed).toContain(']]]]><![CDATA[>');
      expect(feed).toContain('</g:description>');
    });

    it('escapes an ampersand in a URL rather than emitting raw XML', async () => {
      const feed = await generate([makeProduct({ slug: 'pinces-a&b' })]);
      expect(feed).toContain('pinces-a&amp;b');
    });
  });
});
