import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GeoService } from './geo.service';
import {
  CONTENT_STALE_DAYS,
  CONTENT_STALE_NOTIFICATION_TYPE,
  GEO_FAQ_TEMPLATES,
  GEO_LLMS_TXT_QUEUE,
  GEO_REDIS_CLIENT,
} from './geo.constants';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  category: { findMany: jest.fn(), count: jest.fn() },
  product: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  productFaq: { count: jest.fn(), createMany: jest.fn() },
  cmsPage: { findFirst: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
};

const mockQueue = { add: jest.fn() };

const mockNotifications = { createForAllAdmins: jest.fn() };

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prod-1',
    name: { default: 'Widget', en: 'Widget', ar: 'أداة' },
    shortDescription: { default: 'A small widget.', en: 'A small widget.' },
    description: { default: 'A'.repeat(120), en: 'A'.repeat(120) },
    slug: 'widget',
    metaTitle: { default: 'Widget', en: 'Widget' },
    metaDescription: { default: 'Widget desc', en: 'Widget desc' },
    status: ProductStatus.ACTIVE,
    updatedAt: new Date(),
    deletedAt: null,
    faqs: [],
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cat-1',
    name: { default: 'Gadgets', en: 'Gadgets', ar: 'الأجهزة' },
    description: { default: 'All gadgets.', en: 'All gadgets.' },
    slug: 'gadgets',
    isVisible: true,
    deletedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

const mockGeoSettings = {
  get: jest.fn(async (key: string) =>
    key === 'storeName'
      ? { default: 'Atlas Supplies', fr: 'Atlas Supplies', en: 'Atlas Supplies' }
      : undefined,
  ),
};

describe('GeoService', () => {
  let service: GeoService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GEO_REDIS_CLIENT, useValue: mockRedis },
        { provide: getQueueToken(GEO_LLMS_TXT_QUEUE), useValue: mockQueue },
        { provide: 'GEO_NOTIFICATIONS_SERVICE', useValue: mockNotifications },
        { provide: 'GEO_SETTINGS_SERVICE', useValue: mockGeoSettings },
      ],
    }).compile();

    service = module.get<GeoService>(GeoService);
  });

  // ── getLlmsTxt() ───────────────────────────────────────────────────────────

  describe('getLlmsTxt()', () => {
    it('returns cached content when Redis hit', async () => {
      mockRedis.get.mockResolvedValue('# Store\n\ncached content');

      const result = await service.getLlmsTxt('en', 'https://example.com');

      expect(result).toBe('# Store\n\ncached content');
      expect(mockPrisma.category.findMany).not.toHaveBeenCalled();
    });

    it('generates and caches llms.txt on Redis miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.category.findMany.mockResolvedValue([makeCategory()]);
      mockPrisma.product.findMany.mockResolvedValue([makeProduct()]);
      mockPrisma.cmsPage.findFirst.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');

      const result = await service.getLlmsTxt('en', 'https://example.com');

      expect(mockRedis.setex).toHaveBeenCalled();
      expect(result).toContain('# Store');
      expect(result).toContain('Gadgets');
      expect(result).toContain('/categories/gadgets');
      expect(result).toContain('Widget');
      expect(result).toContain('/products/widget');
    });

    it('resolves category names in ar locale', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.category.findMany.mockResolvedValue([makeCategory()]);
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.cmsPage.findFirst.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');

      const result = await service.getLlmsTxt('ar', 'https://example.com');

      expect(result).toContain('الأجهزة');
    });

    it('includes about page link when CMS about page exists', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.category.findMany.mockResolvedValue([]);
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.cmsPage.findFirst.mockResolvedValue({
        slug: 'about',
        title: { default: 'About Us', en: 'About Us' },
      });
      mockRedis.setex.mockResolvedValue('OK');

      const result = await service.getLlmsTxt('en', 'https://example.com');

      expect(result).toContain('About Us');
      expect(result).toContain('/pages/about');
    });
  });

  // ── regenerateLlmsTxt() ───────────────────────────────────────────────────

  describe('regenerateLlmsTxt()', () => {
    it('writes both en and ar locales to Redis', async () => {
      mockPrisma.category.findMany.mockResolvedValue([]);
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.cmsPage.findFirst.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');

      await service.regenerateLlmsTxt('https://example.com');

      expect(mockRedis.setex).toHaveBeenCalledTimes(2);
      const keys = mockRedis.setex.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(keys).toContain('geo:llms.txt:en');
      expect(keys).toContain('geo:llms.txt:ar');
    });
  });

  // ── checkContentFreshness() ────────────────────────────────────────────────

  describe('checkContentFreshness()', () => {
    it('returns zero counts when no stale content', async () => {
      mockPrisma.product.count.mockResolvedValue(0);
      mockPrisma.category.count.mockResolvedValue(0);
      mockPrisma.cmsPage.count.mockResolvedValue(0);

      const result = await service.checkContentFreshness();

      expect(result).toEqual({ staleProducts: 0, staleCategories: 0, stalePages: 0 });
      expect(mockNotifications.createForAllAdmins).not.toHaveBeenCalled();
    });

    it('creates CONTENT_STALE notification when stale items found', async () => {
      mockPrisma.product.count.mockResolvedValue(5);
      mockPrisma.category.count.mockResolvedValue(2);
      mockPrisma.cmsPage.count.mockResolvedValue(1);
      mockNotifications.createForAllAdmins.mockResolvedValue(undefined);

      const result = await service.checkContentFreshness();

      expect(result).toEqual({ staleProducts: 5, staleCategories: 2, stalePages: 1 });
      expect(mockNotifications.createForAllAdmins).toHaveBeenCalledWith(
        CONTENT_STALE_NOTIFICATION_TYPE,
        expect.objectContaining({ en: 'Content Freshness Alert' }),
        expect.objectContaining({ en: expect.stringContaining('5 products') }),
        { staleProducts: 5, staleCategories: 2, stalePages: 1 },
      );
    });

    it('queries products updated before the 90-day threshold', async () => {
      mockPrisma.product.count.mockResolvedValue(0);
      mockPrisma.category.count.mockResolvedValue(0);
      mockPrisma.cmsPage.count.mockResolvedValue(0);

      await service.checkContentFreshness();

      const call = mockPrisma.product.count.mock.calls[0][0] as {
        where: { updatedAt: { lt: Date } };
      };
      const threshold = call.where.updatedAt.lt;
      const expectedThreshold = new Date();
      expectedThreshold.setDate(expectedThreshold.getDate() - CONTENT_STALE_DAYS);

      // Threshold should be within 1 second of expected
      expect(Math.abs(threshold.getTime() - expectedThreshold.getTime())).toBeLessThan(1000);
    });
  });

  // ── getAiReadinessScore() ─────────────────────────────────────────────────

  describe('getAiReadinessScore()', () => {
    it('returns zero scores when no products', async () => {
      mockPrisma.product.count.mockResolvedValue(0);
      mockPrisma.product.findMany.mockResolvedValue([]);

      const result = await service.getAiReadinessScore();

      expect(result.data.totalProducts).toBe(0);
      expect(result.data.overallScore).toBe(0);
      expect(result.data.breakdown.answerFirstDescription.percentage).toBe(0);
    });

    it('counts products with long descriptions as answer-first', async () => {
      mockPrisma.product.count
        .mockResolvedValueOnce(2) // totalProducts
        .mockResolvedValueOnce(1) // withFaqs
        .mockResolvedValueOnce(1); // withSchemaMarkup
      mockPrisma.product.findMany.mockResolvedValue([
        makeProduct({ description: { default: 'A'.repeat(150) } }),
        makeProduct({ id: 'prod-2', description: { default: 'Short' } }),
      ]);

      const result = await service.getAiReadinessScore();

      expect(result.data.breakdown.answerFirstDescription.count).toBe(1);
      expect(result.data.breakdown.answerFirstDescription.percentage).toBe(50);
    });

    it('computes overall score as average of three signals', async () => {
      // 100% answer-first, 100% faqs, 100% schema → overall = 100
      mockPrisma.product.count
        .mockResolvedValueOnce(1) // totalProducts
        .mockResolvedValueOnce(1) // withFaqs
        .mockResolvedValueOnce(1); // withSchemaMarkup
      mockPrisma.product.findMany.mockResolvedValue([
        makeProduct({ description: { default: 'A'.repeat(150) } }),
      ]);

      const result = await service.getAiReadinessScore();

      expect(result.data.overallScore).toBe(100);
    });

    it('returns correct structure with all breakdown fields', async () => {
      mockPrisma.product.count.mockResolvedValue(0);
      mockPrisma.product.findMany.mockResolvedValue([]);

      const result = await service.getAiReadinessScore();

      expect(result.data).toHaveProperty('totalProducts');
      expect(result.data).toHaveProperty('overallScore');
      expect(result.data.breakdown).toHaveProperty('answerFirstDescription');
      expect(result.data.breakdown).toHaveProperty('faqEntries');
      expect(result.data.breakdown).toHaveProperty('completeSchemaMarkup');
    });
  });

  // ── getFaqSuggestions() ───────────────────────────────────────────────────

  describe('getFaqSuggestions()', () => {
    it('returns 3 suggestions when product has no FAQs', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct({ faqs: [] }));

      const result = await service.getFaqSuggestions('prod-1');

      expect(result.data.suggestions).toHaveLength(3);
      expect(result.data.suggestions[0]).toHaveProperty('question');
      expect(result.data.suggestions[0]).toHaveProperty('answer');
    });

    it('suggestions match the defined templates', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct({ faqs: [] }));

      const result = await service.getFaqSuggestions('prod-1');

      expect(result.data.suggestions[0].question.en).toBe(GEO_FAQ_TEMPLATES[0].question.en);
      expect(result.data.suggestions[1].question.en).toBe(GEO_FAQ_TEMPLATES[1].question.en);
    });

    it('returns empty suggestions when product already has FAQs', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct({ faqs: [{ id: 'faq-1' }] }));

      const result = await service.getFaqSuggestions('prod-1');

      expect(result.data.suggestions).toHaveLength(0);
    });

    it('throws NotFoundException for unknown product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(service.getFaqSuggestions('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── acceptFaqSuggestions() ────────────────────────────────────────────────

  describe('acceptFaqSuggestions()', () => {
    const dto = {
      faqs: [
        {
          question: { default: 'Q1?', en: 'Q1?' },
          answer: { default: 'A1.', en: 'A1.' },
          sortOrder: 0,
        },
      ],
    };

    it('creates FAQs and returns count', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<number>) => {
          mockPrisma.productFaq.count.mockResolvedValue(0);
          mockPrisma.productFaq.createMany.mockResolvedValue({ count: 1 });
          return fn(mockPrisma);
        },
      );

      const result = await service.acceptFaqSuggestions('prod-1', dto);

      expect(result.data.created).toBe(1);
    });

    it('is idempotent — returns 0 if product already has FAQs', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<number>) => {
          mockPrisma.productFaq.count.mockResolvedValue(2); // already has FAQs
          return fn(mockPrisma);
        },
      );

      const result = await service.acceptFaqSuggestions('prod-1', dto);

      expect(result.data.created).toBe(0);
      expect(mockPrisma.productFaq.createMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(service.acceptFaqSuggestions('missing', dto)).rejects.toThrow(NotFoundException);
    });
  });

  // ── enqueueLlmsRegeneration() ─────────────────────────────────────────────

  describe('enqueueLlmsRegeneration()', () => {
    it('adds a job to the llms-txt queue', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job-1' });

      await service.enqueueLlmsRegeneration();

      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        {},
        expect.objectContaining({ jobId: 'llms-txt-generate' }),
      );
    });
  });
});
