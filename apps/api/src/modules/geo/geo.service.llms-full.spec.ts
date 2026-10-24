import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GeoService } from './geo.service';
import { GEO_LLMS_TXT_QUEUE, GEO_REDIS_CLIENT } from './geo.constants';
import { CurrenciesService } from '../currencies/currencies.service';
import { Prisma } from '@prisma/client';

// agent_docs/storefront/seo-geo.md "## llms-full.txt shape" — comprehensive
// catalogue dump for AI inference layers. Sections: H1 / blockquote / About /
// Categories / Products / Policies / Contact, in that order. Every active
// product walked via batches of GEO_LLMS_FULL_BATCH_SIZE; CMS-driven About +
// Policy bodies emitted with HTML stripped to plain text.

const mockPrisma = {
  category: { findMany: jest.fn() },
  product: { findMany: jest.fn() },
  cmsPage: { findFirst: jest.fn(), findMany: jest.fn() },
};

const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
};

const mockQueue = { add: jest.fn() };
const mockNotifications = { createForAllAdmins: jest.fn() };
const mockSettings = { get: jest.fn() };

/** `identity.description` from the runtime config, the llms.txt blockquote source. */
const DESCRIPTION = {
  default: 'Fournitures professionnelles pour ateliers, livrées dans tout le pays.',
  fr: 'Fournitures professionnelles pour ateliers, livrées dans tout le pays.',
  en: 'Professional supplies for workshops, delivered nationwide.',
};

function applyDefaultSettings() {
  mockSettings.get.mockImplementation(async (key: string) => {
    if (key === 'description') {
      return DESCRIPTION;
    }
    if (key === 'storeName') {
      return { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' };
    }
    if (key === 'contactEmail') return 'info@atlas.example';
    return undefined;
  });
}

function makeProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prod-1',
    name: { default: 'Widget', fr: 'Widget', en: 'Widget' },
    shortDescription: { default: 'A small widget.', en: 'A small widget.' },
    slug: 'widget',
    status: ProductStatus.ACTIVE,
    deletedAt: null,
    brand: null,
    brandRelation: null,
    gtin: null,
    mpn: null,
    variants: [{ sku: 'WIDGET-001', price: 49.99, isDefault: true }],
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: { default: 'Gadgets', fr: 'Gadgets', en: 'Gadgets' },
    description: { default: 'All gadgets.', fr: 'All gadgets.', en: 'All gadgets.' },
    slug: 'gadgets',
    ...overrides,
  };
}

describe('GeoService.buildLlmsFullTxt — comprehensive catalogue shape', () => {
  let service: GeoService;

  beforeEach(async () => {
    jest.resetAllMocks();
    applyDefaultSettings();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GEO_REDIS_CLIENT, useValue: mockRedis },
        { provide: getQueueToken(GEO_LLMS_TXT_QUEUE), useValue: mockQueue },
        { provide: 'GEO_NOTIFICATIONS_SERVICE', useValue: mockNotifications },
        { provide: 'GEO_SETTINGS_SERVICE', useValue: mockSettings },
        // llms.txt prices every product, so the builder resolves the store
        // currency once per file rather than emitting a literal.
        {
          provide: CurrenciesService,
          useValue: {
            getStore: jest
              .fn()
              .mockResolvedValue({ code: 'LYD', symbol: 'LD', decimalPlaces: 3, enabled: ['LYD'] }),
          },
        },
      ],
    }).compile();

    service = module.get<GeoService>(GeoService);
  });

  function stubEmptyReads() {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.cmsPage.findFirst.mockResolvedValue(null);
    mockPrisma.cmsPage.findMany.mockResolvedValue([]);
    mockRedis.setex.mockResolvedValue('OK');
  }

  it('emits H1 + blockquote sourced from the runtime config, locale-resolved', async () => {
    stubEmptyReads();

    const fr = await service.getLlmsFullTxt('fr', 'https://example.com');
    const en = await service.getLlmsFullTxt('en', 'https://example.com');

    // The store name is a proper noun, so the H1 is the same in both locales;
    // the blockquote is the part that has to follow the requested locale.
    expect(fr.split('\n')[0]).toBe('# Atlas Supplies');
    expect(en.split('\n')[0]).toBe('# Atlas Supplies');
    expect(fr).toContain('> Fournitures professionnelles pour ateliers');
    expect(en).toContain('> Professional supplies for workshops');
  });

  it('emits sections in stable order when all sources populate', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.category.findMany.mockResolvedValue([makeCategory()]);
    mockPrisma.product.findMany.mockResolvedValueOnce([makeProduct()]).mockResolvedValueOnce([]);
    mockPrisma.cmsPage.findFirst.mockResolvedValue({
      title: { default: 'About', en: 'About' },
      content: { default: '<p>About body.</p>', en: '<p>About body.</p>' },
    });
    mockPrisma.cmsPage.findMany.mockResolvedValue([]);
    mockRedis.setex.mockResolvedValue('OK');

    const result = await service.getLlmsFullTxt('en', 'https://example.com');
    const sectionHeaders = (result.match(/^## .+$/gm) ?? []).map((h) => h.replace(/^## /, ''));

    expect(sectionHeaders).toEqual(['About', 'Categories', 'Products', 'Policies', 'Contact']);
  });

  it('strips HTML tags from CMS rich-text bodies (About + policies)', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValueOnce([]);
    mockPrisma.cmsPage.findFirst.mockResolvedValue({
      title: { default: 'About', en: 'About' },
      content: {
        default: '<h2>Heading</h2><p>Paragraph with <strong>bold</strong>.</p>',
        en: '<h2>Heading</h2><p>Paragraph with <strong>bold</strong>.</p>',
      },
    });
    mockPrisma.cmsPage.findMany.mockResolvedValue([]);
    mockRedis.setex.mockResolvedValue('OK');

    const result = await service.getLlmsFullTxt('en', 'https://example.com');

    expect(result).toContain('Heading');
    expect(result).toContain('Paragraph with bold.');
    expect(result).not.toContain('<h2>');
    expect(result).not.toContain('<strong>');
  });

  it('Products section walks every active product (no per-section cap) with brand + sku + price', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.product.findMany
      .mockResolvedValueOnce([
        makeProduct({
          name: { default: 'Anker Powerline', en: 'Anker Powerline' },
          slug: 'anker-powerline',
          brandRelation: { name: { default: 'Anker', en: 'Anker' } },
          gtin: '0194644000004',
          mpn: 'A8033H11',
          // A real Decimal, not a plain number. The fixture used a number, so it
          // could not see that `formatAmount` returned `0.000` for everything a
          // money column actually reads back as.
          variants: [{ sku: 'A8033-BLK', price: new Prisma.Decimal('79.99'), isDefault: true }],
        }),
        makeProduct({
          name: { default: 'Moxedo Earbuds', en: 'Moxedo Earbuds' },
          slug: 'moxedo-earbuds',
          brand: 'Moxedo', // legacy free-text path
          variants: [{ sku: 'MX-EB-01', price: new Prisma.Decimal('159'), isDefault: true }],
        }),
      ])
      .mockResolvedValueOnce([]); // pagination terminator
    mockPrisma.cmsPage.findFirst.mockResolvedValue(null);
    mockPrisma.cmsPage.findMany.mockResolvedValue([]);
    mockRedis.setex.mockResolvedValue('OK');

    const result = await service.getLlmsFullTxt('en', 'https://example.com');

    // Anker — FK-resolved brand name.
    expect(result).toContain('### Anker Powerline');
    expect(result).toContain('- URL: https://example.com/en/catalog/product/anker-powerline');
    expect(result).toContain('- Brand: Anker');
    expect(result).toContain('- SKU: A8033-BLK');
    // Was a hardcoded 'USD' literal beside an unscaled float. The builder now
    // resolves the store currency once per file and prints at its own scale.
    expect(result).toContain('- Price: 79.990 LYD');
    expect(result).not.toContain('USD');
    expect(result).toContain('- GTIN: 0194644000004');
    expect(result).toContain('- MPN: A8033H11');

    // Moxedo — legacy free-text brand fallback when brandRelation is null.
    expect(result).toContain('### Moxedo Earbuds');
    expect(result).toContain('- Brand: Moxedo');
  });

  it('omits Contact section when contactEmail is the placeholder', async () => {
    stubEmptyReads();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'description') {
        return DESCRIPTION;
      }
      if (key === 'storeName') {
        return { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' };
      }
      if (key === 'contactEmail') return 'support@example.com';
      return undefined;
    });
    mockPrisma.product.findMany.mockResolvedValueOnce([]);

    const result = await service.getLlmsFullTxt('en', 'https://example.com');

    expect(result).not.toContain('## Contact');
    expect(result).not.toContain('support@example.com');
  });

  it('caches the rendered file in Redis and returns the cached body on the next call', async () => {
    mockRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce('# Cached Body');
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValueOnce([]);
    mockPrisma.cmsPage.findFirst.mockResolvedValue(null);
    mockPrisma.cmsPage.findMany.mockResolvedValue([]);
    mockRedis.setex.mockResolvedValue('OK');

    const first = await service.getLlmsFullTxt('en', 'https://example.com');
    const second = await service.getLlmsFullTxt('en', 'https://example.com');

    expect(first).toContain('# Atlas Supplies');
    expect(second).toBe('# Cached Body');
    // First call wrote to cache under the dedicated llms-full prefix.
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'geo:llms-full.txt:en',
      expect.any(Number),
      expect.stringContaining('# Atlas Supplies'),
    );
  });
});
