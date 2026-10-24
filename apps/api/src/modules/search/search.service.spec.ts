import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { stockStatusFor } from '../inventory/inventory.constants';
import { SearchService, type ProductSearchResult } from './search.service';

// ── Factories ──────────────────────────────────────────────────────────────────

function makeSynonym(overrides: Record<string, unknown> = {}) {
  return {
    id: 'syn-1',
    terms: ['sneakers', 'trainers', 'running shoes'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    type: 'BOOST',
    query: 'shoes',
    productId: 'product-1',
    position: null,
    priority: 10,
    isActive: true,
    config: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSearchEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    query: 'shoes',
    resultCount: 5,
    clickedProductId: null,
    clickPosition: null,
    convertedToCart: false,
    convertedToOrder: false,
    locale: 'en',
    userId: null,
    sessionId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makePrisma() {
  return {
    searchSynonym: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    merchandisingRule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    searchEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    productCategory: { findMany: jest.fn() },
    productVariant: { aggregate: jest.fn() },
    review: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
}

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('SearchService', () => {
  let service: SearchService;
  let prisma: ReturnType<typeof makePrisma>;
  let inventory: {
    effectiveLowStockThreshold: jest.Mock;
    availabilityForVariants: jest.Mock;
  };
  /** Variant id to available units, consumed by the availabilityForVariants stub. */
  let stockByVariant: Map<string, number>;

  beforeEach(async () => {
    prisma = makePrisma();
    stockByVariant = new Map();
    inventory = {
      effectiveLowStockThreshold: jest.fn().mockResolvedValue(5),
      // Faithful stand-in rather than a canned return: it grades through the
      // real `stockStatusFor` against the mocked threshold, so these tests
      // still assert the grading contract end to end and not the mock's
      // opinion of it.
      availabilityForVariants: jest.fn(async (variantIds: string[]) => {
        const threshold = await inventory.effectiveLowStockThreshold();
        return new Map(
          variantIds.map((id) => {
            const stock = stockByVariant.get(id) ?? 0;
            return [id, { stock, availability: stockStatusFor(stock, threshold) }];
          }),
        );
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventory },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  // ── expandWithSynonyms (via search) ──────────────────────────────────────────

  describe('synonym expansion', () => {
    it('expands query term to all synonym group members', async () => {
      prisma.searchSynonym.findMany.mockResolvedValue([
        makeSynonym({ terms: ['sneakers', 'trainers', 'running shoes'] }),
      ]);
      const expanded = await (service as unknown as SvcWithPrivates).expandWithSynonyms('sneakers');
      expect(expanded).toContain('sneakers');
      expect(expanded).toContain('trainers');
      expect(expanded).toContain('running shoes');
    });

    it('returns original query when no synonyms match', async () => {
      prisma.searchSynonym.findMany.mockResolvedValue([]);
      const expanded = await (service as unknown as SvcWithPrivates).expandWithSynonyms('laptop');
      expect(expanded).toBe('laptop');
    });

    it('returns empty string unchanged', async () => {
      prisma.searchSynonym.findMany.mockResolvedValue([]);
      const expanded = await (service as unknown as SvcWithPrivates).expandWithSynonyms('');
      expect(expanded).toBe('');
    });

    it('deduplicates terms across multiple matching synonym groups', async () => {
      prisma.searchSynonym.findMany.mockResolvedValue([
        makeSynonym({ id: 'syn-1', terms: ['shoes', 'footwear'] }),
        makeSynonym({ id: 'syn-2', terms: ['shoes', 'kicks'] }),
      ]);
      const expanded = await (service as unknown as SvcWithPrivates).expandWithSynonyms('shoes');
      const terms = expanded.split(' ');
      const unique = new Set(terms);
      expect(unique.size).toBe(terms.length); // no duplicates
      expect(expanded).toContain('footwear');
      expect(expanded).toContain('kicks');
    });
  });

  // ── applyScoring ──────────────────────────────────────────────────────────────

  type FtsRow = { id: string; rank: number; trgm_sim: number };
  type SvcWithPrivates = {
    applyScoring(rows: FtsRow[], q: string): Promise<FtsRow[]>;
    applyPins(rows: FtsRow[], q: string): Promise<FtsRow[]>;
    expandWithSynonyms(q: string): Promise<string>;
    computeFacets(ids: string[]): Promise<unknown>;
    fetchProductData(ids: string[], rankedRows: FtsRow[]): Promise<ProductSearchResult[]>;
  };

  describe('applyScoring', () => {
    const rows: FtsRow[] = [
      { id: 'product-1', rank: 0.8, trgm_sim: 0.9 },
      { id: 'product-2', rank: 0.5, trgm_sim: 0.4 },
      { id: 'product-3', rank: 0.3, trgm_sim: 0.2 },
    ];

    it('BOOST rule increases product rank and re-sorts', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([
        makeRule({ type: 'BOOST', productId: 'product-3', priority: 10 }),
      ]);
      const result = await (service as unknown as SvcWithPrivates).applyScoring(rows, 'shoes');
      // product-3 rank was 0.3 + 0.5 boost = 0.8, ties product-1
      const product3 = result.find((r) => r.id === 'product-3')!;
      expect(product3.rank).toBeCloseTo(0.8);
    });

    it('BURY rule decreases product rank', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([
        makeRule({ type: 'BURY', productId: 'product-1', priority: 10 }),
      ]);
      const result = await (service as unknown as SvcWithPrivates).applyScoring(rows, 'shoes');
      const product1 = result.find((r) => r.id === 'product-1')!;
      expect(product1.rank).toBeCloseTo(0.8 - 0.5); // 0.3
    });

    it('returns rows unchanged when no active rules', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([]);
      const result = await (service as unknown as SvcWithPrivates).applyScoring(rows, 'shoes');
      expect(result).toEqual(rows);
    });

    it('skips rules without productId', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([
        makeRule({ type: 'BOOST', productId: null }),
      ]);
      const result = await (service as unknown as SvcWithPrivates).applyScoring(rows, 'shoes');
      expect(result[0].id).toBe('product-1'); // unchanged order
    });
  });

  // ── applyPins ─────────────────────────────────────────────────────────────────

  describe('applyPins', () => {
    const pinRows: FtsRow[] = [
      { id: 'p1', rank: 1.0, trgm_sim: 1.0 },
      { id: 'p2', rank: 0.8, trgm_sim: 0.8 },
      { id: 'p3', rank: 0.6, trgm_sim: 0.6 },
    ];

    it('pins a product to position 0 (first)', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([
        makeRule({ type: 'PIN', productId: 'p3', position: 0 }),
      ]);
      const result = await (service as unknown as SvcWithPrivates).applyPins(pinRows, 'shoes');
      expect(result[0].id).toBe('p3');
    });

    it('pins a product to an explicit middle position', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([
        makeRule({ type: 'PIN', productId: 'p1', position: 2 }),
      ]);
      const result = await (service as unknown as SvcWithPrivates).applyPins(pinRows, 'shoes');
      expect(result[2].id).toBe('p1');
    });

    it('ignores PIN rule if product not in result set', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([
        makeRule({ type: 'PIN', productId: 'unknown-product', position: 0 }),
      ]);
      const result = await (service as unknown as SvcWithPrivates).applyPins(pinRows, 'shoes');
      expect(result.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('returns rows unchanged when no PIN rules', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([]);
      const result = await (service as unknown as SvcWithPrivates).applyPins(pinRows, 'shoes');
      expect(result).toEqual(pinRows);
    });
  });

  // ── computeFacets ─────────────────────────────────────────────────────────────

  describe('computeFacets', () => {
    type FacetResult = {
      categories: Array<{ id: string; name: unknown; count: number }>;
      brands: Array<{ name: string; count: number }>;
      priceRange: { min: number; max: number } | null;
      ratings: Array<{ rating: number; count: number }>;
    };
    type SvcWithFacets = { computeFacets(ids: string[]): Promise<FacetResult> };

    it('returns empty facets when no product IDs', async () => {
      const facets = await (service as unknown as SvcWithFacets).computeFacets([]);
      expect(facets).toEqual({
        categories: [],
        brands: [],
        priceRange: null,
        ratings: [],
      });
    });

    it('aggregates categories by count', async () => {
      prisma.productCategory.findMany.mockResolvedValue([
        {
          productId: 'p1',
          categoryId: 'cat-1',
          category: { id: 'cat-1', name: { default: 'Shoes' } },
        },
        {
          productId: 'p2',
          categoryId: 'cat-1',
          category: { id: 'cat-1', name: { default: 'Shoes' } },
        },
        {
          productId: 'p3',
          categoryId: 'cat-2',
          category: { id: 'cat-2', name: { default: 'Sport' } },
        },
      ]);
      prisma.product.findMany.mockResolvedValue([]);
      prisma.productVariant.aggregate.mockResolvedValue({
        _min: { price: null },
        _max: { price: null },
      });
      prisma.review.findMany.mockResolvedValue([]);

      const facets = await (service as unknown as SvcWithFacets).computeFacets(['p1', 'p2', 'p3']);
      expect(facets.categories[0]).toMatchObject({ id: 'cat-1', count: 2 });
      expect(facets.categories[1]).toMatchObject({ id: 'cat-2', count: 1 });
    });

    it('aggregates brand counts and sorts descending', async () => {
      prisma.productCategory.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([
        { brand: 'Nike' },
        { brand: 'Nike' },
        { brand: 'Adidas' },
      ]);
      prisma.productVariant.aggregate.mockResolvedValue({
        _min: { price: null },
        _max: { price: null },
      });
      prisma.review.findMany.mockResolvedValue([]);

      const facets = await (service as unknown as SvcWithFacets).computeFacets(['p1', 'p2', 'p3']);
      expect(facets.brands[0]).toEqual({ name: 'Nike', count: 2 });
      expect(facets.brands[1]).toEqual({ name: 'Adidas', count: 1 });
    });

    it('returns priceRange from variant aggregate', async () => {
      prisma.productCategory.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([]);
      prisma.productVariant.aggregate.mockResolvedValue({
        _min: { price: 49.99 },
        _max: { price: 199.99 },
      });
      prisma.review.findMany.mockResolvedValue([]);

      const facets = await (service as unknown as SvcWithFacets).computeFacets(['p1']);
      expect(facets.priceRange).toEqual({ min: 49.99, max: 199.99 });
    });

    it('returns rating distribution sorted 5→1', async () => {
      prisma.productCategory.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([]);
      prisma.productVariant.aggregate.mockResolvedValue({
        _min: { price: null },
        _max: { price: null },
      });
      prisma.review.findMany.mockResolvedValue([
        { rating: 5 },
        { rating: 5 },
        { rating: 4 },
        { rating: 3 },
      ]);

      const facets = await (service as unknown as SvcWithFacets).computeFacets(['p1']);
      expect(facets.ratings[0]).toEqual({ rating: 5, count: 2 });
      expect(facets.ratings[1]).toEqual({ rating: 4, count: 1 });
      expect(facets.ratings[2]).toEqual({ rating: 3, count: 1 });
    });
  });

  // ── createSynonym ─────────────────────────────────────────────────────────────

  // ── fetchProductData: availability (D6) ─────────────────────────────────────
  //
  // The search grid renders three states, so each hit carries `availability`
  // alongside the `inStock` boolean the facet filter still reads.

  describe('fetchProductData availability', () => {
    function makeSearchProduct(overrides: Record<string, unknown> = {}) {
      return {
        id: 'product-1',
        name: { default: 'Fraise diamant', fr: 'Fraise diamant', en: 'Diamond bur' },
        slug: 'fraise-diamant',
        brand: null,
        brandRelation: null,
        tags: [],
        isFeatured: false,
        createdAt: new Date(),
        variants: [{ id: 'var-1', price: 120 }],
        assets: [],
        categories: [],
        reviews: [],
        ...overrides,
      };
    }

    async function firstHit(available: number | null) {
      prisma.product.findMany.mockResolvedValue([makeSearchProduct()]);
      if (available !== null) stockByVariant.set('var-1', available);
      const hits = await (service as unknown as SvcWithPrivates).fetchProductData(
        ['product-1'],
        [{ id: 'product-1', rank: 1, trgm_sim: 1 }],
      );
      return hits[0];
    }

    it('reports IN_STOCK above the threshold', async () => {
      const hit = await firstHit(6);
      expect(hit.availability).toBe('IN_STOCK');
      expect(hit.inStock).toBe(true);
    });

    it('reports LOW_STOCK at the threshold', async () => {
      const hit = await firstHit(5);
      expect(hit.availability).toBe('LOW_STOCK');
      expect(hit.inStock).toBe(true);
    });

    it('reports OUT_OF_STOCK at zero', async () => {
      const hit = await firstHit(0);
      expect(hit.availability).toBe('OUT_OF_STOCK');
      expect(hit.inStock).toBe(false);
    });

    it('reports OUT_OF_STOCK when the variant has no stock row', async () => {
      const hit = await firstHit(null);
      expect(hit.availability).toBe('OUT_OF_STOCK');
      expect(hit.inStock).toBe(false);
    });

    it('rolls a product up from its variants graded individually, never from their sum', async () => {
      // Two variants of 3 and 4 against a threshold of 5. Summing would give 7
      // and report IN_STOCK, but a customer buys one variant and neither variant
      // holds more than 4, so the product is LOW_STOCK. This is also what the
      // storefront derives for the catalogue grid, so the same product cannot
      // read differently on the search grid than on the catalogue grid.
      prisma.product.findMany.mockResolvedValue([
        makeSearchProduct({
          variants: [
            { id: 'var-1', price: 120 },
            { id: 'var-2', price: 140 },
          ],
        }),
      ]);
      stockByVariant.set('var-1', 3);
      stockByVariant.set('var-2', 4);

      const hits = await (service as unknown as SvcWithPrivates).fetchProductData(
        ['product-1'],
        [{ id: 'product-1', rank: 1, trgm_sim: 1 }],
      );

      expect(hits[0].availability).toBe('LOW_STOCK');
      // The boolean is unchanged: any stock at all still reads as in stock.
      expect(hits[0].inStock).toBe(true);
    });

    it('takes the best variant state, so one stocked variant carries the product', async () => {
      prisma.product.findMany.mockResolvedValue([
        makeSearchProduct({
          variants: [
            { id: 'var-1', price: 120 },
            { id: 'var-2', price: 140 },
          ],
        }),
      ]);
      stockByVariant.set('var-1', 0);
      stockByVariant.set('var-2', 40);

      const hits = await (service as unknown as SvcWithPrivates).fetchProductData(
        ['product-1'],
        [{ id: 'product-1', rank: 1, trgm_sim: 1 }],
      );

      expect(hits[0].availability).toBe('IN_STOCK');
    });

    it('resolves availability once per search, not once per hit', async () => {
      prisma.product.findMany.mockResolvedValue([
        makeSearchProduct({ id: 'product-1' }),
        makeSearchProduct({ id: 'product-2', variants: [{ id: 'var-2', price: 90 }] }),
        makeSearchProduct({ id: 'product-3', variants: [{ id: 'var-3', price: 80 }] }),
      ]);
      await (service as unknown as SvcWithPrivates).fetchProductData(
        ['product-1', 'product-2', 'product-3'],
        [
          { id: 'product-1', rank: 3, trgm_sim: 1 },
          { id: 'product-2', rank: 2, trgm_sim: 1 },
          { id: 'product-3', rank: 1, trgm_sim: 1 },
        ],
      );

      expect(inventory.availabilityForVariants).toHaveBeenCalledTimes(1);
      expect(inventory.effectiveLowStockThreshold).toHaveBeenCalledTimes(1);
      // One batch, every variant in it, so two cards on the same page cannot
      // be graded against different thresholds.
      expect(inventory.availabilityForVariants).toHaveBeenCalledWith(['var-1', 'var-2', 'var-3']);
    });

    it('reads stock through InventoryService, never through its own SQL', async () => {
      // D8.33c: this path used to run a raw `LEFT JOIN "StockLevel"`, which is
      // a cross-module read (§3.1). DR-19's exemption covers raw SQL in the
      // FTS ranking query (§3.5), not reaching into another module's tables.
      await firstHit(6);
      const rawCalls = prisma.$queryRaw.mock.calls.map((call) => JSON.stringify(call));
      expect(rawCalls.filter((call) => call.includes('StockLevel'))).toEqual([]);
      expect(inventory.availabilityForVariants).toHaveBeenCalled();
    });

    it('grades against the threshold the inventory service resolves', async () => {
      inventory.effectiveLowStockThreshold.mockResolvedValue(50);
      const hit = await firstHit(40);
      expect(hit.availability).toBe('LOW_STOCK');
    });

    it('does not touch inventory when there are no ids', async () => {
      const hits = await (service as unknown as SvcWithPrivates).fetchProductData([], []);
      expect(hits).toEqual([]);
      expect(inventory.availabilityForVariants).not.toHaveBeenCalled();
      expect(inventory.effectiveLowStockThreshold).not.toHaveBeenCalled();
    });
  });

  describe('createSynonym', () => {
    it('creates synonym with lowercased, trimmed terms', async () => {
      const expected = makeSynonym({ terms: ['sneakers', 'trainers'] });
      prisma.searchSynonym.create.mockResolvedValue(expected);

      await service.createSynonym({ terms: ['SNEAKERS', '  Trainers  '] });

      expect(prisma.searchSynonym.create).toHaveBeenCalledWith({
        data: { terms: ['sneakers', 'trainers'] },
      });
    });
  });

  // ── deleteSynonym ─────────────────────────────────────────────────────────────

  describe('deleteSynonym', () => {
    it('throws NotFoundException when synonym does not exist', async () => {
      prisma.searchSynonym.findUnique.mockResolvedValue(null);
      await expect(service.deleteSynonym('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('deletes synonym when found', async () => {
      prisma.searchSynonym.findUnique.mockResolvedValue(makeSynonym());
      prisma.searchSynonym.delete.mockResolvedValue(makeSynonym());
      await expect(service.deleteSynonym('syn-1')).resolves.toBeUndefined();
      expect(prisma.searchSynonym.delete).toHaveBeenCalledWith({ where: { id: 'syn-1' } });
    });
  });

  // ── createMerchandisingRule ───────────────────────────────────────────────────

  describe('createMerchandisingRule', () => {
    it('throws BadRequestException when PIN rule has no position', async () => {
      await expect(
        service.createMerchandisingRule({ type: 'PIN', productId: 'p1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when BOOST rule has no productId', async () => {
      await expect(
        service.createMerchandisingRule({ type: 'BOOST', query: 'shoes' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when BURY rule has no productId', async () => {
      await expect(
        service.createMerchandisingRule({ type: 'BURY', query: 'shoes' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates REDIRECT rule without productId', async () => {
      const rule = makeRule({
        type: 'REDIRECT',
        productId: null,
        query: 'sale',
        config: { url: '/promotions' },
      });
      prisma.merchandisingRule.create.mockResolvedValue(rule);

      const result = await service.createMerchandisingRule({
        type: 'REDIRECT',
        query: 'sale',
        config: { url: '/promotions' },
      });
      expect(result.type).toBe('REDIRECT');
    });

    it('creates PIN rule with position', async () => {
      const rule = makeRule({ type: 'PIN', productId: 'p1', position: 0 });
      prisma.merchandisingRule.create.mockResolvedValue(rule);

      const result = await service.createMerchandisingRule({
        type: 'PIN',
        productId: 'p1',
        position: 0,
        query: 'shoes',
      });
      expect(result.type).toBe('PIN');
    });
  });

  // ── deleteMerchandisingRule ───────────────────────────────────────────────────

  describe('deleteMerchandisingRule', () => {
    it('throws NotFoundException when rule does not exist', async () => {
      prisma.merchandisingRule.findUnique.mockResolvedValue(null);
      await expect(service.deleteMerchandisingRule('missing')).rejects.toThrow(NotFoundException);
    });

    it('deletes rule when found', async () => {
      prisma.merchandisingRule.findUnique.mockResolvedValue(makeRule());
      prisma.merchandisingRule.delete.mockResolvedValue(makeRule());
      await expect(service.deleteMerchandisingRule('rule-1')).resolves.toBeUndefined();
    });
  });

  // ── logClick ──────────────────────────────────────────────────────────────────

  describe('logClick', () => {
    it('throws NotFoundException when search event not found', async () => {
      prisma.searchEvent.findUnique.mockResolvedValue(null);
      await expect(
        service.logClick('missing', { clickedProductId: 'p1', clickPosition: 0 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates search event with click data', async () => {
      prisma.searchEvent.findUnique.mockResolvedValue(makeSearchEvent());
      prisma.searchEvent.update.mockResolvedValue(
        makeSearchEvent({ clickedProductId: 'p1', clickPosition: 2 }),
      );

      await service.logClick('event-1', { clickedProductId: 'p1', clickPosition: 2 });

      expect(prisma.searchEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { clickedProductId: 'p1', clickPosition: 2 },
      });
    });
  });

  // ── logConversion ─────────────────────────────────────────────────────────────

  describe('logConversion', () => {
    it('throws NotFoundException when event not found', async () => {
      prisma.searchEvent.findUnique.mockResolvedValue(null);
      await expect(service.logConversion('missing')).rejects.toThrow(NotFoundException);
    });

    it('marks search event as converted to order', async () => {
      prisma.searchEvent.findUnique.mockResolvedValue(makeSearchEvent());
      prisma.searchEvent.update.mockResolvedValue(makeSearchEvent({ convertedToOrder: true }));

      await service.logConversion('event-1');

      expect(prisma.searchEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { convertedToOrder: true },
      });
    });
  });

  // ── listSynonyms ──────────────────────────────────────────────────────────────

  describe('listSynonyms', () => {
    it('returns paginated synonyms', async () => {
      const syns = [makeSynonym(), makeSynonym({ id: 'syn-2', terms: ['laptop', 'notebook'] })];
      prisma.searchSynonym.findMany.mockResolvedValue(syns);
      prisma.searchSynonym.count.mockResolvedValue(2);

      const result = await service.listSynonyms({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.meta).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    });
  });

  // ── listMerchandisingRules ────────────────────────────────────────────────────

  describe('listMerchandisingRules', () => {
    it('returns paginated rules enriched with the target product name', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([makeRule()]);
      prisma.merchandisingRule.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([
        { id: 'product-1', name: { default: 'Sidr Honey', en: 'Sidr Honey' } },
      ]);

      const result = await service.listMerchandisingRules({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({ total: 1 });
      expect((result.data as Array<{ product: unknown }>)[0].product).toEqual({
        id: 'product-1',
        name: { default: 'Sidr Honey', en: 'Sidr Honey' },
      });
    });

    it('attaches a null product when the rule has no productId', async () => {
      prisma.merchandisingRule.findMany.mockResolvedValue([makeRule({ productId: null })]);
      prisma.merchandisingRule.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([]);

      const result = await service.listMerchandisingRules({ page: 1, pageSize: 20 });

      expect((result.data as Array<{ product: unknown }>)[0].product).toBeNull();
    });
  });

  // ── getRecommendations ────────────────────────────────────────────────────────

  describe('getRecommendations', () => {
    it('returns empty array (stub)', () => {
      const result = service.getRecommendations(['p1', 'p2']);
      expect(result).toEqual({ data: [] });
    });
  });

  // ── reindex ───────────────────────────────────────────────────────────────────

  describe('reindex', () => {
    it('triggers UPDATE and returns count', async () => {
      prisma.$executeRaw.mockResolvedValue(42);
      const result = await service.reindex();
      expect(result.reindexed).toBe(42);
      expect(result.message).toContain('Reindex triggered');
    });
  });
});
