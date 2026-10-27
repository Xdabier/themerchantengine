import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GeoService } from './geo.service';
import { GEO_LLMS_TXT_QUEUE, GEO_REDIS_CLIENT } from './geo.constants';
import { CurrenciesService } from '../currencies/currencies.service';
import { NEUTRAL_LOCALE_SET, registerScratchLocale, storeLocales } from '@common/locale';

// agent_docs/storefront/seo-geo.md "## llms.txt shape" — H1 / blockquote /
// About / Categories / Featured Products / Policies / Contact / Optional
// lockstep coverage. Lives in a sibling spec because apps/api/jest.config.ts
// testPathIgnorePatterns excludes the main geo.service.spec.ts (pre-S1
// getAiReadinessScore shape drift, separate follow-up). The 2026-05-06
// restructure (catalog split + Optional section + Layer-2 brand description
// blockquote + placeholder-contact suppression) ships coverage here.

const mockPrisma = {
  category: { findMany: jest.fn() },
  product: { findMany: jest.fn() },
  cmsPage: { findFirst: jest.fn() },
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
      // The store name is a proper noun, so every locale carries the same
      // string. Per-locale key selection is proved by its own case below.
      return { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' };
    }
    if (key === 'contactEmail') {
      // Real-shape value (not the legacy `support@example.com` placeholder)
      // so the `## Contact` section emits in the default coverage path.
      return 'info@atlas.example';
    }
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
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cat-1',
    name: { default: 'Gadgets', fr: 'Gadgets', en: 'Gadgets' },
    description: { default: 'All gadgets.', en: 'All gadgets.' },
    slug: 'gadgets',
    isVisible: true,
    deletedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('GeoService.buildLlmsTxt — S23.6 shape coverage', () => {
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
    mockRedis.setex.mockResolvedValue('OK');
  }

  it('emits H1 from StoreSettings.storeName resolved against the locale', async () => {
    stubEmptyReads();

    const frResult = await service.getLlmsTxt('fr', 'https://example.com');
    const enResult = await service.getLlmsTxt('en', 'https://example.com');

    expect(frResult.split('\n')[0]).toBe('# Atlas Supplies');
    expect(enResult.split('\n')[0]).toBe('# Atlas Supplies');
  });

  it('falls back to a neutral line built from the store name when no description is set', async () => {
    stubEmptyReads();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'storeName')
        return { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' };
      if (key === 'description') return { default: '', fr: '', en: '' };
      return undefined;
    });
    const fr = await service.getLlmsTxt('fr', 'https://example.com');
    const en = await service.getLlmsTxt('en', 'https://example.com');
    expect(fr).toContain('> Atlas Supplies : boutique en ligne.');
    expect(en).toContain('> Atlas Supplies: online store.');
  });

  it('H1 reads the requested locale key, not `default`, when the two differ', async () => {
    stubEmptyReads();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'description') {
        return DESCRIPTION;
      }
      if (key === 'storeName') {
        return { default: 'Nom par defaut', fr: 'Nom francais', en: 'English Name' };
      }
      return undefined;
    });

    const frResult = await service.getLlmsTxt('fr', 'https://example.com');
    const enResult = await service.getLlmsTxt('en', 'https://example.com');

    expect(frResult.split('\n')[0]).toBe('# Nom francais');
    expect(enResult.split('\n')[0]).toBe('# English Name');
  });

  it('blockquote uses identity.description from the runtime config, locale-resolved', async () => {
    stubEmptyReads();

    const frResult = await service.getLlmsTxt('fr', 'https://example.com');
    const enResult = await service.getLlmsTxt('en', 'https://example.com');

    expect(frResult).toContain('> Fournitures professionnelles pour ateliers');
    expect(enResult).toContain('> Professional supplies for workshops');
    // The line is the store's own description, never another store's copy.
    expect(frResult).not.toContain('Atlas Supplies:');
    // Generic boilerplate is forbidden per agent_docs/storefront/seo-geo.md "## llms.txt shape".
    expect(enResult).not.toContain('machine-readable content optimised');
  });

  it('emits sections in exact order: About / Categories / Featured Products / Policies / Contact / Optional', async () => {
    stubEmptyReads();
    mockPrisma.category.findMany.mockResolvedValue([makeCategory()]);
    mockPrisma.product.findMany.mockResolvedValue([makeProduct()]);

    const result = await service.getLlmsTxt('en', 'https://example.com');

    const sectionHeaders = (result.match(/^## .+$/gm) ?? []).map((h) => h.replace(/^## /, ''));
    expect(sectionHeaders).toEqual([
      'About',
      'Categories',
      'Featured Products',
      'Policies',
      'Contact',
      'Optional',
    ]);
  });

  it('Categories body emits category links with locale-prefixed URLs (not lumped with products)', async () => {
    stubEmptyReads();
    mockPrisma.category.findMany.mockResolvedValue([makeCategory()]);
    mockPrisma.product.findMany.mockResolvedValue([makeProduct()]);

    const result = await service.getLlmsTxt('en', 'https://example.com');

    // Category URL appears under the ## Categories block, before ## Featured Products.
    const categoriesIdx = result.indexOf('## Categories');
    const productsIdx = result.indexOf('## Featured Products');
    const gadgetIdx = result.indexOf('/en/catalog/gadgets');
    const widgetIdx = result.indexOf('/en/catalog/product/widget');

    expect(categoriesIdx).toBeGreaterThan(0);
    expect(productsIdx).toBeGreaterThan(categoriesIdx);
    expect(gadgetIdx).toBeGreaterThan(categoriesIdx);
    expect(gadgetIdx).toBeLessThan(productsIdx);
    expect(widgetIdx).toBeGreaterThan(productsIdx);

    expect(result).not.toContain('/categories/gadgets');
    expect(result).not.toContain('/products/widget');
  });

  it('Policies section enumerates the four routed slugs (shipping/returns/terms/privacy)', async () => {
    stubEmptyReads();

    const result = await service.getLlmsTxt('en', 'https://example.com');

    expect(result).toContain('/en/policies/shipping');
    expect(result).toContain('/en/policies/returns');
    expect(result).toContain('/en/policies/terms');
    expect(result).toContain('/en/policies/privacy');
  });

  it('Contact section emits a real seeded mailto', async () => {
    stubEmptyReads();

    const result = await service.getLlmsTxt('en', 'https://example.com');

    expect(result).toContain('## Contact');
    expect(result).toContain('<mailto:info@atlas.example>');
  });

  it('Contact section is suppressed entirely when contactEmail is the legacy placeholder', async () => {
    stubEmptyReads();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'description') {
        return DESCRIPTION;
      }
      if (key === 'storeName') {
        return { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' };
      }
      if (key === 'contactEmail') {
        return 'support@example.com'; // PLACEHOLDER_CONTACT_VALUES, must not emit
      }
      return undefined;
    });

    const result = await service.getLlmsTxt('en', 'https://example.com');

    expect(result).not.toContain('## Contact');
    expect(result).not.toContain('support@example.com');
  });

  it('Contact section is suppressed when contactEmail is empty string', async () => {
    stubEmptyReads();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'description') {
        return DESCRIPTION;
      }
      if (key === 'storeName') {
        return { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' };
      }
      if (key === 'contactEmail') return '';
      return undefined;
    });

    const result = await service.getLlmsTxt('en', 'https://example.com');

    expect(result).not.toContain('## Contact');
  });

  it('Optional section points at /llms-full.txt and /sitemap_index.xml', async () => {
    stubEmptyReads();

    const result = await service.getLlmsTxt('en', 'https://example.com');

    expect(result).toContain('## Optional');
    expect(result).toContain('https://example.com/llms-full.txt');
    expect(result).toContain('https://example.com/sitemap_index.xml');
  });

  it('About section links to the locale-prefixed about page (not /pages/about)', async () => {
    stubEmptyReads();
    mockPrisma.cmsPage.findFirst.mockResolvedValue({
      slug: 'about',
      title: { default: 'About Us', en: 'About Us' },
    });

    const result = await service.getLlmsTxt('en', 'https://example.com');

    expect(result).toContain('About Us');
    expect(result).toContain('/en/about');
    expect(result).not.toContain('/pages/about');
  });

  it('cache hit returns the resolved-name H1, not the literal "# Store" placeholder', async () => {
    stubEmptyReads();

    const result = await service.getLlmsTxt('en', 'https://example.com');

    expect(result).not.toMatch(/^# Store$/m);
    expect(result.split('\n')[0]).toBe('# Atlas Supplies');
  });
  it('labels the policies in Arabic', async () => {
    stubEmptyReads();
    const ar = await service.getLlmsTxt('ar', 'https://example.com');
    expect(ar).toContain('[الشحن](https://example.com/ar/policies/shipping)');
    expect(ar).toContain('[الإرجاع](https://example.com/ar/policies/returns)');
  });

  it('falls back to a neutral Arabic line when no description is set', async () => {
    stubEmptyReads();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'storeName') return { default: 'Atlas Supplies' };
      if (key === 'description') return { default: '' };
      return undefined;
    });
    const ar = await service.getLlmsTxt('ar', 'https://example.com');
    expect(ar).toContain('> Atlas Supplies: متجر إلكتروني.');
  });

  it('writes a locale with no label or description in the store default', async () => {
    stubEmptyReads();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'storeName') return { default: 'Atlas Supplies' };
      if (key === 'description') return { default: '' };
      return undefined;
    });
    const remove = registerScratchLocale('xx');
    storeLocales.set({
      supportedLocales: ['fr', 'en', 'xx'],
      defaultLocale: 'fr',
      rtlLocales: [],
      timezone: 'UTC',
    });
    try {
      const out = await service.getLlmsTxt('xx', 'https://example.com');
      expect(out).toContain('> Atlas Supplies : boutique en ligne.');
      expect(out).toContain('[Livraison](https://example.com/xx/policies/shipping)');
    } finally {
      remove();
      storeLocales.set(NEUTRAL_LOCALE_SET);
    }
  });

  it('ends on the store name and the slug when the default locale has no copy', async () => {
    stubEmptyReads();
    mockSettings.get.mockImplementation(async (key: string) => {
      if (key === 'storeName') return { default: 'Atlas Supplies' };
      if (key === 'description') return { default: '' };
      return undefined;
    });
    const remove = registerScratchLocale('xx');
    storeLocales.set({
      supportedLocales: ['xx', 'en'],
      defaultLocale: 'xx',
      rtlLocales: [],
      timezone: 'UTC',
    });
    try {
      const out = await service.getLlmsTxt('xx', 'https://example.com');
      expect(out).toContain('> Atlas Supplies');
      expect(out).not.toContain('online store');
      expect(out).toContain('[shipping](https://example.com/xx/policies/shipping)');
    } finally {
      remove();
      storeLocales.set(NEUTRAL_LOCALE_SET);
    }
  });
});
