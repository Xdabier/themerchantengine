import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { SectionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { SettingsService } from '../settings/settings.service';
import { StorefrontConfigService } from './storefront-config.service';
import {
  STOREFRONT_CONFIG_REDIS_CLIENT,
  STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
  STOREFRONT_SECTIONS_CACHE_PREFIX,
} from './storefront-config.constants';
import { STOREFRONT_SECTION_UPDATED_EVENT } from './storefront-config.events';

// ── Factories ──────────────────────────────────────────────────────────────────

const HERO_ASSET_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function validHeroConfig() {
  return {
    assetId: HERO_ASSET_ID,
    eyebrow: { default: 'Summer' },
    headline: { default: 'Sun and surf' },
    body: { default: 'Discover the new collection' },
    cta: { default: 'Shop now' },
    ctaHref: '/catalog',
  };
}

function makeSection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sec-1',
    pageSlug: 'home',
    type: SectionType.HERO,
    title: { default: 'Welcome', en: 'Welcome' },
    config: validHeroConfig(),
    sortOrder: 0,
    isVisible: true,
    visibleFrom: null,
    visibleUntil: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPrisma = {
  storefrontSection: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockAssets = {
  publicProjection: jest.fn(),
};

function variantUrl(url: string) {
  return {
    url,
    width: 1200,
    height: 800,
    format: 'webp' as const,
    srcset: [{ url, width: 1200, format: 'webp' as const }],
  };
}

const mockEvents = {
  emit: jest.fn(),
};

const mockSettings = {
  getGroup: jest.fn(),
  getLocales: jest.fn(),
  get: jest.fn(),
};

const mockCurrencies = {
  getStore: jest.fn(),
};

const mockAnalytics = {
  getPixels: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────

describe('StorefrontConfigService', () => {
  let service: StorefrontConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAssets.publicProjection.mockResolvedValue(new Map());
    mockSettings.getGroup.mockImplementation(async (group: string) =>
      group === 'appearance'
        ? { logoUrl: '', faviconUrl: '' }
        : {
            storeName: { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' },
            contactEmail: '',
            phone: '',
            address: { default: '', fr: '', en: '' },
            socialLinks: { facebook: '', instagram: '', twitter: '', linkedin: '', tiktok: '' },
          },
    );
    mockSettings.getLocales.mockResolvedValue({
      supportedLocales: ['fr', 'en'],
      defaultLocale: 'fr',
    });
    mockSettings.get.mockResolvedValue(5);
    mockCurrencies.getStore.mockResolvedValue({
      code: 'LYD',
      symbol: 'LD',
      decimalPlaces: 3,
      enabled: ['LYD', 'EUR'],
    });
    mockAnalytics.getPixels.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorefrontConfigService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: STOREFRONT_CONFIG_REDIS_CLIENT, useValue: mockRedis },
        { provide: AssetsService, useValue: mockAssets },
        { provide: EventEmitter2, useValue: mockEvents },
        { provide: SettingsService, useValue: mockSettings },
        { provide: CurrenciesService, useValue: mockCurrencies },
        { provide: AnalyticsService, useValue: mockAnalytics },
      ],
    }).compile();

    service = module.get(StorefrontConfigService);
  });

  // ── getSections ─────────────────────────────────────────────────────────────

  describe('getSections', () => {
    it('returns cached rows hydrated under the meta envelope on cache hit', async () => {
      const sections = [makeSection()];
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(sections));
      mockAssets.publicProjection.mockResolvedValueOnce(
        new Map([[HERO_ASSET_ID, variantUrl('https://cdn/hero.webp')]]),
      );

      const result = await service.getSections('home');

      expect(result.meta).toMatchObject({ pageSlug: 'home', total: 1, page: 1, totalPages: 1 });
      expect(result.data).toHaveLength(1);
      expect((result.data[0].config as Record<string, unknown>).assetUrl).toBe(
        'https://cdn/hero.webp',
      );
      expect((result.data[0].config as Record<string, unknown>).assetVariants).toEqual([
        { url: 'https://cdn/hero.webp', width: 1200, format: 'webp' },
      ]);
      expect(mockPrisma.storefrontSection.findMany).not.toHaveBeenCalled();
    });

    it('queries DB, caches rows, hydrates assetUrl + assetVariants on cache miss (AV1)', async () => {
      const sections = [makeSection()];
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce(sections);
      mockRedis.set.mockResolvedValueOnce('OK');
      mockAssets.publicProjection.mockResolvedValueOnce(
        new Map([[HERO_ASSET_ID, variantUrl('https://cdn/hero.webp')]]),
      );

      const result = await service.getSections('home');

      expect(result.data[0].config).toMatchObject({
        assetId: HERO_ASSET_ID,
        assetUrl: 'https://cdn/hero.webp',
      });
      expect(mockPrisma.storefrontSection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ pageSlug: 'home' }) }),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        `${STOREFRONT_SECTIONS_CACHE_PREFIX}home`,
        expect.any(String),
        'EX',
        600,
      );
      // HERO section maps to 'hero' intent per agent_docs/assets-pipeline.md §2
      expect(mockAssets.publicProjection).toHaveBeenCalledWith([HERO_ASSET_ID], 'hero');
    });

    it('returns empty data array with meta when no sections match', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([]);

      const result = await service.getSections('unknown-page');

      expect(result.data).toEqual([]);
      expect(result.meta).toMatchObject({ pageSlug: 'unknown-page', total: 0 });
      expect(mockAssets.publicProjection).not.toHaveBeenCalled();
    });

    it('skips assetUrl hydration for types with no asset paths', async () => {
      const trustSection = makeSection({
        type: SectionType.TRUST_SIGNALS,
        config: {
          items: [{ kind: 'delivery', title: { default: 'X' }, subtitle: { default: 'Y' } }],
        },
      });
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([trustSection]);

      const result = await service.getSections('home');

      expect(result.data[0].config).not.toHaveProperty('assetUrl');
      expect(mockAssets.publicProjection).not.toHaveBeenCalled();
    });

    it('omits assetUrl when the referenced asset cannot be resolved', async () => {
      const sections = [makeSection()];
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce(sections);
      mockAssets.publicProjection.mockResolvedValueOnce(new Map());

      const result = await service.getSections('home');

      expect((result.data[0].config as Record<string, unknown>).assetUrl).toBeUndefined();
      expect((result.data[0].config as Record<string, unknown>).assetVariants).toBeUndefined();
      expect((result.data[0].config as Record<string, unknown>).assetId).toBe(HERO_ASSET_ID);
    });

    it('filters only visible sections with correct where clause', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([]);

      await service.getSections('home');

      const call = mockPrisma.storefrontSection.findMany.mock.calls[0][0];
      expect(call.where.isVisible).toBe(true);
      expect(call.orderBy).toEqual({ sortOrder: 'asc' });
    });

    it('proceeds gracefully when cache GET throws', async () => {
      const sections = [makeSection()];
      mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce(sections);
      mockRedis.set.mockResolvedValueOnce('OK');

      const result = await service.getSections('home');
      expect(result.data).toHaveLength(1);
    });

    it('proceeds gracefully when cache SET throws', async () => {
      const sections = [makeSection()];
      mockRedis.get.mockResolvedValueOnce(null);
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce(sections);
      mockRedis.set.mockRejectedValueOnce(new Error('Redis down'));

      const result = await service.getSections('home');
      expect(result.data).toHaveLength(1);
    });
  });

  // ── getPages ────────────────────────────────────────────────────────────────

  describe('getPages', () => {
    it('returns distinct page slugs ordered alphabetically', async () => {
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([
        { pageSlug: 'home' },
        { pageSlug: 'about' },
      ]);

      const result = await service.getPages();
      expect(result).toEqual(['home', 'about']);
    });
  });

  // ── adminGetSections ────────────────────────────────────────────────────────

  describe('adminGetSections', () => {
    it('returns paginated sections for a page', async () => {
      const sections = [makeSection(), makeSection({ id: 'sec-2', sortOrder: 1 })];
      mockPrisma.storefrontSection.count.mockResolvedValueOnce(2);
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce(sections);

      const result = await service.adminGetSections('home', 1, 20);

      expect(result.data).toEqual(sections);
      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    });

    it('calculates skip correctly for page 2', async () => {
      mockPrisma.storefrontSection.count.mockResolvedValueOnce(25);
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([]);

      await service.adminGetSections('home', 2, 20);

      expect(mockPrisma.storefrontSection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });
  });

  // ── createSection ────────────────────────────────────────────────────────────

  describe('createSection', () => {
    it('creates a section with a valid per-type config and invalidates cache', async () => {
      const section = makeSection();
      mockPrisma.storefrontSection.create.mockResolvedValueOnce(section);
      mockRedis.del.mockResolvedValueOnce(1);

      const result = await service.createSection({
        pageSlug: 'home',
        type: SectionType.HERO,
        config: validHeroConfig(),
        sortOrder: 0,
      });

      expect(result).toEqual(section);
      expect(mockRedis.del).toHaveBeenCalledWith(`${STOREFRONT_SECTIONS_CACHE_PREFIX}home`);
    });

    it('defaults sortOrder to 0 and isVisible to true', async () => {
      const section = makeSection();
      mockPrisma.storefrontSection.create.mockResolvedValueOnce(section);

      await service.createSection({
        pageSlug: 'home',
        type: SectionType.HERO,
        config: validHeroConfig(),
      });

      const data = mockPrisma.storefrontSection.create.mock.calls[0][0].data;
      expect(data.sortOrder).toBe(0);
      expect(data.isVisible).toBe(true);
    });

    it('converts ISO string dates to Date objects', async () => {
      const section = makeSection({ visibleFrom: new Date('2026-06-01') });
      mockPrisma.storefrontSection.create.mockResolvedValueOnce(section);

      await service.createSection({
        pageSlug: 'home',
        type: SectionType.HERO,
        config: validHeroConfig(),
        visibleFrom: '2026-06-01T00:00:00.000Z',
      });

      const data = mockPrisma.storefrontSection.create.mock.calls[0][0].data;
      expect(data.visibleFrom).toBeInstanceOf(Date);
    });

    it('rejects an unsupported section type before any DB write', async () => {
      // S21 dropped TESTIMONIALS from the SectionType enum (DR-05); use a
      // string literal so the spec still asserts that the dropped value is
      // rejected at the DTO allowlist gate.
      await expect(
        service.createSection({
          pageSlug: 'home',
          type: 'TESTIMONIALS' as never,
          config: { quote: { default: 'x' } } as never,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.storefrontSection.create).not.toHaveBeenCalled();
    });

    it('rejects a HERO config that omits required fields', async () => {
      await expect(
        service.createSection({
          pageSlug: 'home',
          type: SectionType.HERO,
          config: { headline: { default: 'no-asset' } } as never,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.storefrontSection.create).not.toHaveBeenCalled();
    });

    it('rejects unknown fields on the per-type config (whitelist)', async () => {
      await expect(
        service.createSection({
          pageSlug: 'home',
          type: SectionType.HERO,
          config: { ...validHeroConfig(), sneaky: 'no' } as never,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.storefrontSection.create).not.toHaveBeenCalled();
    });

    it('accepts a valid FEATURED_PRODUCTS config with productIds + variant', async () => {
      const section = makeSection({ type: SectionType.FEATURED_PRODUCTS });
      mockPrisma.storefrontSection.create.mockResolvedValueOnce(section);

      await service.createSection({
        pageSlug: 'home',
        type: SectionType.FEATURED_PRODUCTS,
        config: { productIds: [PRODUCT_ID], variant: 'scroll' } as never,
      });

      expect(mockPrisma.storefrontSection.create).toHaveBeenCalled();
    });

    it('rejects a FEATURED_PRODUCTS config with an unknown variant', async () => {
      await expect(
        service.createSection({
          pageSlug: 'home',
          type: SectionType.FEATURED_PRODUCTS,
          config: { productIds: [PRODUCT_ID], variant: 'carousel' } as never,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.storefrontSection.create).not.toHaveBeenCalled();
    });
  });

  // ── updateSection ────────────────────────────────────────────────────────────

  describe('updateSection', () => {
    it('throws NotFoundException when section does not exist', async () => {
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateSection('missing', { type: SectionType.HERO, config: validHeroConfig() }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates with a fresh per-type config replacement and invalidates cache', async () => {
      const section = makeSection();
      const updated = makeSection();
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce(updated);
      mockRedis.del.mockResolvedValueOnce(1);

      const result = await service.updateSection('sec-1', {
        type: SectionType.HERO,
        config: validHeroConfig(),
      });

      expect(result).toEqual(updated);
      expect(mockRedis.del).toHaveBeenCalledWith(`${STOREFRONT_SECTIONS_CACHE_PREFIX}home`);
    });

    it('only sends changed envelope fields to Prisma when no config patch is sent', async () => {
      const section = makeSection();
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce(section);

      await service.updateSection('sec-1', { sortOrder: 5 });

      const data = mockPrisma.storefrontSection.update.mock.calls[0][0].data;
      expect(data).toEqual({ sortOrder: 5 });
    });

    it('refuses a type-change without a fresh config payload', async () => {
      const section = makeSection({ type: SectionType.HERO });
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);

      await expect(
        service.updateSection('sec-1', { type: SectionType.TRUST_SIGNALS }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.storefrontSection.update).not.toHaveBeenCalled();
    });

    it('rejects a config patch whose shape does not match the existing row type', async () => {
      const section = makeSection({ type: SectionType.HERO });
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);

      await expect(
        service.updateSection('sec-1', {
          // No type → service falls back to existing row type (HERO), which
          // requires assetId — a TRUST_SIGNALS shape fails.
          config: { items: [] } as never,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.storefrontSection.update).not.toHaveBeenCalled();
    });
  });

  // ── findSectionsByAssetId (DR-07 JSONB references) ──────────────────────────

  describe('findSectionsByAssetId', () => {
    it('queries for assetId on each per-type config path with a typed JSON predicate', async () => {
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([
        {
          id: 'sec-hero',
          pageSlug: 'home',
          type: SectionType.HERO,
          sortOrder: 0,
        },
      ]);

      const refs = await service.findSectionsByAssetId(HERO_ASSET_ID);

      expect(refs).toEqual([
        { id: 'sec-hero', pageSlug: 'home', type: SectionType.HERO, sortOrder: 0 },
      ]);
      const call = mockPrisma.storefrontSection.findMany.mock.calls[0][0];
      // Each OR clause is a typed JSON path predicate, not a $queryRaw.
      const orClauses = call.where.OR as Array<{
        type: SectionType;
        config: { path: string[]; equals: string };
      }>;
      const heroClause = orClauses.find((c) => c.type === SectionType.HERO);
      expect(heroClause).toBeDefined();
      expect(heroClause!.config.path).toEqual(['assetId']);
      expect(heroClause!.config.equals).toBe(HERO_ASSET_ID);
      const promoClause = orClauses.find((c) => c.type === SectionType.PROMOTIONAL_BANNER);
      expect(promoClause).toBeDefined();
    });

    it('returns an empty array when no section references the asset', async () => {
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([]);

      const refs = await service.findSectionsByAssetId(HERO_ASSET_ID);

      expect(refs).toEqual([]);
    });
  });

  // ── deleteSection ────────────────────────────────────────────────────────────

  describe('deleteSection', () => {
    it('throws NotFoundException when section does not exist', async () => {
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(null);

      await expect(service.deleteSection('missing')).rejects.toThrow(NotFoundException);
    });

    it('soft-deletes by setting deletedAt and invalidates cache', async () => {
      const section = makeSection();
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce({
        ...section,
        deletedAt: new Date(),
      });
      mockRedis.del.mockResolvedValueOnce(1);

      await service.deleteSection('sec-1');

      const data = mockPrisma.storefrontSection.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(mockRedis.del).toHaveBeenCalledWith(`${STOREFRONT_SECTIONS_CACHE_PREFIX}home`);
    });
  });

  // ── reorderSections ──────────────────────────────────────────────────────────

  describe('reorderSections', () => {
    it('throws BadRequestException for IDs not on the page', async () => {
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([{ id: 'sec-1' }]);

      await expect(
        service.reorderSections('home', { orderedIds: ['sec-1', 'sec-UNKNOWN'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs all updates in a transaction and invalidates cache', async () => {
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([
        { id: 'sec-1' },
        { id: 'sec-2' },
      ]);
      mockPrisma.$transaction.mockResolvedValueOnce([]);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.reorderSections('home', { orderedIds: ['sec-2', 'sec-1'] });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith(`${STOREFRONT_SECTIONS_CACHE_PREFIX}home`);
    });

    it('assigns sortOrder by array position', async () => {
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([
        { id: 'sec-1' },
        { id: 'sec-2' },
      ]);

      // Capture the operations array passed to $transaction
      let ops: unknown[] = [];
      mockPrisma.$transaction.mockImplementationOnce((arg: unknown[]) => {
        ops = arg;
        return Promise.resolve([]);
      });
      mockPrisma.storefrontSection.update.mockReturnValue(undefined);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.reorderSections('home', { orderedIds: ['sec-2', 'sec-1'] });

      // Two update calls: sec-2 → 0, sec-1 → 1
      expect(ops).toHaveLength(2);
    });
  });

  // ── toggleVisibility ─────────────────────────────────────────────────────────

  describe('toggleVisibility', () => {
    it('throws NotFoundException when section does not exist', async () => {
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(null);

      await expect(service.toggleVisibility('missing', { isVisible: false })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('toggles isVisible and invalidates cache', async () => {
      const section = makeSection({ isVisible: true });
      const updated = makeSection({ isVisible: false });
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce(updated);
      mockRedis.del.mockResolvedValueOnce(1);

      const result = await service.toggleVisibility('sec-1', { isVisible: false });

      expect(result.isVisible).toBe(false);
      expect(mockRedis.del).toHaveBeenCalledWith(`${STOREFRONT_SECTIONS_CACHE_PREFIX}home`);
    });

    it('sets visibleFrom and visibleUntil when provided', async () => {
      const section = makeSection();
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce(section);

      await service.toggleVisibility('sec-1', {
        isVisible: true,
        visibleFrom: '2026-06-01T00:00:00.000Z',
        visibleUntil: '2026-12-31T23:59:59.000Z',
      });

      const data = mockPrisma.storefrontSection.update.mock.calls[0][0].data;
      expect(data.visibleFrom).toBeInstanceOf(Date);
      expect(data.visibleUntil).toBeInstanceOf(Date);
    });

    it('clears visibleUntil when null string passed', async () => {
      const section = makeSection({ visibleUntil: new Date('2026-12-31') });
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce({ ...section, visibleUntil: null });

      await service.toggleVisibility('sec-1', {
        isVisible: true,
        visibleUntil: undefined,
      });

      // visibleUntil key should not be in data when dto field is undefined
      const data = mockPrisma.storefrontSection.update.mock.calls[0][0].data;
      expect('visibleUntil' in data).toBe(false);
    });
  });

  // ── revalidate event emission ──────────────────────────────────────────────

  describe('storefront.section_updated event', () => {
    it('emits on createSection', async () => {
      mockPrisma.storefrontSection.create.mockResolvedValueOnce(makeSection());
      await service.createSection({
        pageSlug: 'home',
        type: SectionType.HERO,
        config: validHeroConfig(),
      });
      expect(mockEvents.emit).toHaveBeenCalledWith(STOREFRONT_SECTION_UPDATED_EVENT, {
        pageSlug: 'home',
      });
    });

    it('emits on updateSection', async () => {
      const section = makeSection();
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce(section);
      await service.updateSection('sec-1', { sortOrder: 2 });
      expect(mockEvents.emit).toHaveBeenCalledWith(STOREFRONT_SECTION_UPDATED_EVENT, {
        pageSlug: 'home',
      });
    });

    it('emits on deleteSection', async () => {
      const section = makeSection();
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce({
        ...section,
        deletedAt: new Date(),
      });
      await service.deleteSection('sec-1');
      expect(mockEvents.emit).toHaveBeenCalledWith(STOREFRONT_SECTION_UPDATED_EVENT, {
        pageSlug: 'home',
      });
    });

    it('emits on reorderSections', async () => {
      mockPrisma.storefrontSection.findMany.mockResolvedValueOnce([{ id: 'sec-1' }]);
      mockPrisma.$transaction.mockResolvedValueOnce([]);
      await service.reorderSections('home', { orderedIds: ['sec-1'] });
      expect(mockEvents.emit).toHaveBeenCalledWith(STOREFRONT_SECTION_UPDATED_EVENT, {
        pageSlug: 'home',
      });
    });

    it('emits on toggleVisibility', async () => {
      const section = makeSection();
      mockPrisma.storefrontSection.findUnique.mockResolvedValueOnce(section);
      mockPrisma.storefrontSection.update.mockResolvedValueOnce(section);
      await service.toggleVisibility('sec-1', { isVisible: false });
      expect(mockEvents.emit).toHaveBeenCalledWith(STOREFRONT_SECTION_UPDATED_EVENT, {
        pageSlug: 'home',
      });
    });
  });

  // ── getPublicConfig (plan I phase I1) ───────────────────────────────────────

  /**
   * The public config is an allowlist, not a settings dump. Every one of these
   * tests exists because the alternative shape, "return the groups the
   * storefront happens to need", puts the next key an operator adds on an
   * unauthenticated endpoint by default. The absent-key tests are the guard.
   */
  describe('getPublicConfig', () => {
    it('carries exactly the five allowlisted top-level groups', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const config = await service.getPublicConfig();

      expect(Object.keys(config).sort()).toEqual([
        'currency',
        'identity',
        'inventory',
        'locales',
        'pixels',
      ]);
    });

    it('carries exactly the five allowlisted identity keys', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const config = await service.getPublicConfig();

      expect(Object.keys(config.identity).sort()).toEqual([
        'contactEmail',
        'logoUrl',
        'phone',
        'socialLinks',
        'storeName',
      ]);
    });

    it('never serializes a setting outside the allowlist', async () => {
      // Everything an operator can store today that is NOT for a customer:
      // the physical address, the mail kill-switch, the checkout flags, the
      // admin currency roster and the store timezone.
      mockRedis.get.mockResolvedValueOnce(null);
      mockSettings.getGroup.mockResolvedValueOnce({
        storeName: { default: 'Atlas Supplies' },
        contactEmail: 'hello@atlas.example',
        phone: '+218 00 000 000',
        address: { default: 'Rue de la Liberte, Tripoli' },
        socialLinks: { facebook: 'https://facebook.com/atlassupplies' },
      });

      const serialized = JSON.stringify(await service.getPublicConfig());

      expect(serialized).not.toContain('Rue de la Liberte');
      expect(serialized).not.toContain('address');
      expect(serialized).not.toContain('pauseAll');
      expect(serialized).not.toContain('guestCheckoutEnabled');
      expect(serialized).not.toContain('minimumOrderAmount');
      expect(serialized).not.toContain('timezone');
      // `enabled` is the admin currency roster on CurrenciesService.getStore().
      expect(serialized).not.toContain('enabled');
    });

    it('leaves storeName as a Translatable so the global interceptor resolves it', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const config = await service.getPublicConfig();

      expect(config.identity.storeName).toEqual({
        default: 'Atlas Supplies',
        fr: 'Atlas Supplies',
        en: 'Atlas Supplies',
      });
    });

    it('reports an unset contact email and phone as null rather than an empty string', async () => {
      // The storefront hides the contact block on null. An empty string is
      // truthy enough in a template to render an empty mailto link.
      mockRedis.get.mockResolvedValueOnce(null);

      const config = await service.getPublicConfig();

      expect(config.identity.contactEmail).toBeNull();
      expect(config.identity.phone).toBeNull();
    });

    it('drops the social platforms the operator left blank', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockSettings.getGroup.mockResolvedValueOnce({
        storeName: { default: 'Atlas Supplies' },
        contactEmail: '',
        phone: '',
        address: {},
        socialLinks: {
          facebook: 'https://facebook.com/atlassupplies',
          instagram: '  ',
          twitter: '',
          linkedin: 'https://linkedin.com/company/atlassupplies',
          tiktok: '',
        },
      });

      const config = await service.getPublicConfig();

      expect(config.identity.socialLinks).toEqual({
        facebook: 'https://facebook.com/atlassupplies',
        linkedin: 'https://linkedin.com/company/atlassupplies',
      });
    });

    it('carries the store currency without the admin roster', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const config = await service.getPublicConfig();

      expect(config.currency).toEqual({ code: 'LYD', symbol: 'LD', decimalPlaces: 3 });
    });

    it('carries the configured locales', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const config = await service.getPublicConfig();

      expect(config.locales).toEqual({ supportedLocales: ['fr', 'en'], defaultLocale: 'fr' });
    });

    it('carries the admin low-stock threshold', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockSettings.get.mockResolvedValueOnce(12);

      const config = await service.getPublicConfig();

      expect(config.inventory).toEqual({ lowStockThreshold: 12 });
    });

    it('falls back to the inventory constant when the threshold row is junk', async () => {
      // Mirrors InventoryService.effectiveLowStockThreshold, which this cannot
      // call: settings must not depend on inventory (§3.1).
      mockRedis.get.mockResolvedValueOnce(null);
      mockSettings.get.mockResolvedValueOnce('not a number');

      const config = await service.getPublicConfig();

      expect(config.inventory.lowStockThreshold).toBe(10);
    });

    it('serves the operator logo from the appearance group', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockSettings.getGroup.mockImplementation(async (group: string) =>
        group === 'appearance'
          ? { logoUrl: 'https://cdn.atlas.example/logo.png', faviconUrl: '' }
          : {
              storeName: { default: 'Atlas Supplies' },
              contactEmail: '',
              phone: '',
              address: {},
              socialLinks: {},
            },
      );

      const config = await service.getPublicConfig();

      expect(config.identity.logoUrl).toBe('https://cdn.atlas.example/logo.png');
    });

    it('reports an unset logo as null, so the baked artwork stays the fallback', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const config = await service.getPublicConfig();

      expect(config.identity.logoUrl).toBeNull();
    });

    it('never puts the favicon on the public wire, which nothing consumes', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockSettings.getGroup.mockImplementation(async (group: string) =>
        group === 'appearance'
          ? { logoUrl: '', faviconUrl: 'https://cdn.atlas.example/favicon.ico' }
          : { storeName: { default: 'Atlas Supplies' }, socialLinks: {} },
      );

      expect(JSON.stringify(await service.getPublicConfig())).not.toContain('favicon');
    });

    it('carries the four pixel slots, nulling the ones with no id', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockAnalytics.getPixels.mockResolvedValueOnce({ googleAnalyticsId: 'G-ABC123' });

      const config = await service.getPublicConfig();

      expect(config.pixels).toEqual({
        googleAnalyticsId: 'G-ABC123',
        metaPixelId: null,
        tiktokPixelId: null,
        snapPixelId: null,
      });
    });

    it('serves the cached payload without touching a single settings service', async () => {
      const cached = {
        identity: {
          storeName: { default: 'cached.example' },
          contactEmail: null,
          phone: null,
          socialLinks: {},
          logoUrl: null,
        },
        currency: { code: 'LYD', symbol: 'LD', decimalPlaces: 3 },
        locales: { supportedLocales: ['fr', 'en'], defaultLocale: 'fr' },
        inventory: { lowStockThreshold: 5 },
        pixels: {
          googleAnalyticsId: null,
          metaPixelId: null,
          tiktokPixelId: null,
          snapPixelId: null,
        },
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

      const config = await service.getPublicConfig();

      expect(config).toEqual(cached);
      expect(mockSettings.getGroup).not.toHaveBeenCalled();
      expect(mockCurrencies.getStore).not.toHaveBeenCalled();
      expect(mockAnalytics.getPixels).not.toHaveBeenCalled();
    });

    it('caches for 60 seconds, not the 10 minute sections window', async () => {
      // An identity or pixel change has to reach a live storefront in about a
      // minute. The sections TTL would hold a renamed store for ten.
      mockRedis.get.mockResolvedValueOnce(null);

      await service.getPublicConfig();

      expect(mockRedis.set).toHaveBeenCalledWith(
        STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
        expect.any(String),
        'EX',
        60,
      );
    });

    it('still answers when Redis is down', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockRedis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const config = await service.getPublicConfig();

      expect(config.currency.code).toBe('LYD');
    });
  });
});
