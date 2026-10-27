import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CategoriesService } from '../categories/categories.service';
import { ProductCategoryNotFoundException } from './product-category-not-found.exception';
import { ProductNotFoundException } from './product-not-found.exception';
import { ProductSpecDuplicateKeyException } from './product-spec-duplicate-key.exception';
import { ProductSpecEmptyKeyException } from './product-spec-empty-key.exception';
import { ProductsService, toSlug, computeQualityScore } from './products.service';
import {
  PRODUCTS_REDIS_CLIENT,
  PRODUCT_MUTATED_EVENT,
  PRODUCT_SLUG_CHANGED_EVENT,
} from './products.constants';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prod-1',
    name: { default: 'Test Product', fr: 'Test Product', en: 'Test Product' },
    slug: 'test-product',
    description: null,
    shortDescription: null,
    status: ProductStatus.DRAFT,
    productTypeId: null,
    brand: null,
    tags: [],
    isFeatured: false,
    isDigital: false,
    sortOrder: 0,
    metaTitle: null,
    metaDescription: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    variants: [],
    assets: [],
    categories: [],
    faqs: [],
    ...overrides,
  };
}

function makeVariant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'var-1',
    productId: 'prod-1',
    sku: 'SKU-001',
    price: 99.99,
    compareAtPrice: null,
    costPrice: null,
    weight: 1.5,
    length: null,
    width: null,
    height: null,
    barcode: null,
    isDefault: true,
    isActive: true,
    maxDownloads: null,
    downloadExpiryDays: null,
    licenseKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    attributeValues: [],
    ...overrides,
  };
}

function makeProductForQuality(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prod-1',
    name: { default: 'Test Product', fr: 'Test Product', en: 'Test Product' },
    slug: 'test-product',
    description: {
      default: 'A'.repeat(60),
      fr: 'B'.repeat(60),
      en: 'C'.repeat(60),
    },
    shortDescription: {
      default: 'Short desc',
      fr: 'Short fr',
      en: 'Short en',
    },
    metaTitle: { default: 'Meta', fr: 'Meta', en: 'Meta' },
    metaDescription: { default: 'Desc', fr: 'Desc', en: 'Desc' },
    assets: [
      { sortOrder: 0, isPrimary: true },
      { sortOrder: 1, isPrimary: false },
      { sortOrder: 2, isPrimary: false },
    ],
    categories: [{ categoryId: 'cat-1' }],
    variants: [{ sku: 'SKU-001', price: 99.99, isActive: true, weight: 1.5, deletedAt: null }],
    faqs: [{ id: 'faq-1' }],
    ...overrides,
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  productVariant: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  productCategory: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    count: jest.fn(),
  },
  productAsset: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  productFaq: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  productSpec: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    upsert: jest.fn(),
    groupBy: jest.fn(),
  },
  productType: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  attribute: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  attributeValue: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  variantAttributeValue: {
    count: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockInventory = {
  availabilityForVariants: jest.fn(),
};

const mockCategories = {
  findExistingIds: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string, def: unknown) => def) },
        },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: InventoryService, useValue: mockInventory },
        { provide: CategoriesService, useValue: mockCategories },
        { provide: PRODUCTS_REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    // resetAllMocks clears mockResolvedValueOnce queues (clearAllMocks does not)
    jest.resetAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockInventory.availabilityForVariants.mockResolvedValue(new Map());
  });

  // ── toSlug ──────────────────────────────────────────────────────────────────

  describe('toSlug', () => {
    it('converts spaces to hyphens', () => {
      expect(toSlug('Hello World')).toBe('hello-world');
    });

    it('strips special characters', () => {
      expect(toSlug('Product! #1 (NEW)')).toBe('product-1-new');
    });

    it('collapses multiple hyphens', () => {
      expect(toSlug('foo  --  bar')).toBe('foo-bar');
    });

    it('trims leading and trailing hyphens', () => {
      expect(toSlug('  -foo bar-  ')).toBe('foo-bar');
    });

    it('lowercases input', () => {
      expect(toSlug('UPPER CASE')).toBe('upper-case');
    });

    it('handles non-Latin text by stripping to empty string', () => {
      // Non-ASCII non-word characters are stripped; result may be empty
      const result = toSlug('日本語');
      expect(typeof result).toBe('string');
    });

    it('strips diacritics from accented Latin characters', () => {
      expect(toSlug('Café au lait')).toBe('cafe-au-lait');
    });

    it('handles already valid slug', () => {
      expect(toSlug('valid-slug-123')).toBe('valid-slug-123');
    });
  });

  // ── generateUniqueSlug ──────────────────────────────────────────────────────

  describe('generateUniqueSlug', () => {
    it('returns base slug when no collision', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      const slug = await service.generateUniqueSlug('My Product');
      expect(slug).toBe('my-product');
    });

    it('appends -1 on first collision', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ slug: 'my-product' });
      mockPrisma.product.findMany.mockResolvedValue([{ slug: 'my-product' }]);
      const slug = await service.generateUniqueSlug('My Product');
      expect(slug).toBe('my-product-1');
    });

    it('finds next available suffix when -1 is also taken', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ slug: 'my-product' });
      mockPrisma.product.findMany.mockResolvedValue([
        { slug: 'my-product' },
        { slug: 'my-product-1' },
      ]);
      const slug = await service.generateUniqueSlug('My Product');
      expect(slug).toBe('my-product-2');
    });
  });

  // ── computeQualityScore ─────────────────────────────────────────────────────

  describe('computeQualityScore', () => {
    it('returns 100 for a fully completed product', () => {
      const product = makeProductForQuality();
      const result = computeQualityScore(product as never);
      expect(result.score).toBe(100);
      expect(result.grade).toBe('green');
    });

    it('returns grade=red when score < 50', () => {
      const product = makeProductForQuality({
        name: { default: 'Only default' }, // no fr/en, fails hasNameAllLocales
        description: null,
        shortDescription: null,
        assets: [],
        categories: [],
        variants: [],
        faqs: [],
        metaTitle: null,
        metaDescription: null,
      });
      const result = computeQualityScore(product as never);
      expect(result.score).toBeLessThan(50);
      expect(result.grade).toBe('red');
    });

    it('returns grade=yellow when score is 50-79', () => {
      // score = 100 - 15 (no description) - 10 (no shortDescription) - 15 (no images) = 60
      const product = makeProductForQuality({
        description: null,
        shortDescription: null,
        assets: [],
      });
      const result = computeQualityScore(product as never);
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(result.score).toBeLessThan(80);
      expect(result.grade).toBe('yellow');
    });

    it('deducts 10 pts when name is missing non-default locales', () => {
      const full = makeProductForQuality();
      const partial = makeProductForQuality({ name: { default: 'Test' } });
      const fullResult = computeQualityScore(full as never);
      const partialResult = computeQualityScore(partial as never);
      expect(fullResult.score - partialResult.score).toBe(10);
      expect(partialResult.breakdown.hasNameAllLocales).toBe(false);
    });

    it('counts fr + en + default as the required locale set, so an ar key scores nothing', () => {
      // The required set moved: a row still carrying the previous client's
      // second locale is untranslated as far as the score is concerned.
      const legacy = makeProductForQuality({
        name: { default: 'Test Product', en: 'Test Product', ar: 'Legacy second locale' },
        description: {
          default: 'A'.repeat(60),
          en: 'B'.repeat(60),
          ar: 'C'.repeat(60),
        },
      });
      const result = computeQualityScore(legacy as never);
      expect(result.breakdown.hasNameAllLocales).toBe(false);
      expect(result.breakdown.hasDescriptionAllLocales).toBe(false);

      // The same row with fr in place of ar scores both checks.
      const migrated = makeProductForQuality();
      const migratedResult = computeQualityScore(migrated as never);
      expect(migratedResult.breakdown.hasNameAllLocales).toBe(true);
      expect(migratedResult.breakdown.hasDescriptionAllLocales).toBe(true);
    });

    it('sets hasDescriptionAllLocales=false when description is null', () => {
      const noDesc = makeProductForQuality({ description: null });
      const result = computeQualityScore(noDesc as never);
      expect(result.breakdown.hasDescriptionAllLocales).toBe(false);
      // Null description also fails the answer-first check (no text to inspect)
      expect(result.breakdown.descriptionAnswerFirst).toBe(false);
      expect(result.score).toBe(80); // 100 - 15 (desc) - 5 (answer-first)
    });

    it('deducts 15 pts when fewer than 3 images', () => {
      const full = makeProductForQuality();
      const fewImages = makeProductForQuality({ assets: [{ sortOrder: 0, isPrimary: true }] });
      const fullResult = computeQualityScore(full as never);
      const fewResult = computeQualityScore(fewImages as never);
      expect(fullResult.score - fewResult.score).toBe(15);
    });

    it('sets descriptionAnswerFirst=false for question-leading description', () => {
      // Must be >=50 chars in all locales so hasDescriptionAllLocales still passes
      const longQuestion = 'What is this product? ' + 'A'.repeat(40);
      const questionFirst = makeProductForQuality({
        description: {
          default: longQuestion,
          fr: longQuestion,
          en: longQuestion,
        },
      });
      const result = computeQualityScore(questionFirst as never);
      expect(result.breakdown.hasDescriptionAllLocales).toBe(true);
      expect(result.breakdown.descriptionAnswerFirst).toBe(false);
      expect(result.score).toBe(95); // 100 - 5 (answer-first)
    });

    it('sets descriptionAnswerFirst=false for a French question-leading description', () => {
      // `default` now carries French, so an English-only question pattern
      // would score every French description as answer-first for free.
      const longQuestion = 'Comment poser cet implant ? ' + 'A'.repeat(40);
      const questionFirst = makeProductForQuality({
        description: {
          default: longQuestion,
          fr: longQuestion,
          en: longQuestion,
        },
      });
      const result = computeQualityScore(questionFirst as never);
      expect(result.breakdown.hasDescriptionAllLocales).toBe(true);
      expect(result.breakdown.descriptionAnswerFirst).toBe(false);
    });

    it('keeps a description answer-first when a word merely starts with a question word', () => {
      // The negative lookahead is what stops `Commentaire` matching `comment`
      // and `However` matching `how`.
      const fr = 'Commentaire du fabricant sur ce produit. ' + 'A'.repeat(40);
      const en = 'However you mount it, the seal holds. ' + 'A'.repeat(40);
      const product = makeProductForQuality({
        description: { default: fr, fr, en },
      });
      const result = computeQualityScore(product as never);
      expect(result.breakdown.descriptionAnswerFirst).toBe(true);
    });

    it('marks allVariantsHaveSku=false when active variants list is empty', () => {
      const product = makeProductForQuality({ variants: [] });
      const result = computeQualityScore(product as never);
      expect(result.breakdown.allVariantsHaveSku).toBe(false);
      expect(result.breakdown.hasVariantWithPrice).toBe(false);
      expect(result.breakdown.hasWeight).toBe(false);
    });

    it('ignores soft-deleted variants in quality checks', () => {
      const product = makeProductForQuality({
        variants: [
          { sku: 'SKU-001', price: 99.99, isActive: true, weight: 1.5, deletedAt: null },
          { sku: 'SKU-002', price: 50, isActive: false, weight: null, deletedAt: new Date() },
        ],
      });
      const result = computeQualityScore(product as never);
      expect(result.breakdown.hasVariantWithPrice).toBe(true);
    });
  });

  // ── Status transitions ──────────────────────────────────────────────────────

  // ── Storefront availability (D6) ────────────────────────────────────────────
  //
  // Both storefront reads must emit the three-state `availability` on every
  // variant, and never the exact count: these endpoints are unauthenticated.
  // Neither reads stock rows itself: the grade comes from InventoryService,
  // which owns those rows (§3.1), and the detail path grades after its cache
  // so a cached page cannot serve a stale state.

  function makeStorefrontVariant(overrides: Record<string, unknown> = {}) {
    return {
      id: 'var-1',
      sku: 'SKU-001',
      price: 99.99,
      compareAtPrice: null,
      isDefault: true,
      ...overrides,
    };
  }

  type StorefrontVariant = {
    id: string;
    sku: string;
    availability: string;
    /** Optional so the specs can assert it is absent from the wire. */
    stock?: unknown;
    stockLevels?: unknown;
  };

  /**
   * Seeds what the inventory module reports back. It returns the count as well
   * as the grade on purpose: products must drop the count at the boundary.
   */
  function seedGrades(entries: Record<string, { stock: number; availability: string }>) {
    mockInventory.availabilityForVariants.mockResolvedValue(new Map(Object.entries(entries)));
  }

  describe('listProducts', () => {
    function seed(variants: Record<string, unknown>[]) {
      mockPrisma.product.count.mockResolvedValue(1);
      mockPrisma.product.findMany.mockResolvedValue([
        {
          id: 'prod-1',
          name: { default: 'Fraise diamant', fr: 'Fraise diamant', en: 'Diamond bur' },
          slug: 'fraise-diamant',
          status: ProductStatus.ACTIVE,
          assets: [],
          variants,
        },
      ]);
    }

    async function firstVariant(variants: Record<string, unknown>[]) {
      seed(variants);
      const result = await service.listProducts({});
      const products = result.data as Array<{ variants: StorefrontVariant[] }>;
      return products[0].variants[0];
    }

    it('attaches the grade the inventory module reports', async () => {
      seedGrades({ 'var-1': { stock: 14, availability: 'IN_STOCK' } });
      const variant = await firstVariant([makeStorefrontVariant()]);

      expect(variant.availability).toBe('IN_STOCK');
    });

    it('never puts the exact stock count on the wire', async () => {
      seedGrades({ 'var-1': { stock: 14, availability: 'IN_STOCK' } });
      const variant = await firstVariant([makeStorefrontVariant()]);

      expect(variant).not.toHaveProperty('stock');
    });

    it('surfaces LOW_STOCK verbatim', async () => {
      seedGrades({ 'var-1': { stock: 5, availability: 'LOW_STOCK' } });
      const variant = await firstVariant([makeStorefrontVariant()]);

      expect(variant.availability).toBe('LOW_STOCK');
    });

    it('surfaces OUT_OF_STOCK verbatim', async () => {
      seedGrades({ 'var-1': { stock: 0, availability: 'OUT_OF_STOCK' } });
      const variant = await firstVariant([makeStorefrontVariant()]);

      expect(variant.availability).toBe('OUT_OF_STOCK');
    });

    it('reports OUT_OF_STOCK when the inventory module reports nothing for a variant', async () => {
      seedGrades({});
      const variant = await firstVariant([makeStorefrontVariant()]);

      expect(variant.availability).toBe('OUT_OF_STOCK');
      expect(variant).not.toHaveProperty('stock');
    });

    it('keeps the rest of the variant intact', async () => {
      seedGrades({ 'var-1': { stock: 40, availability: 'IN_STOCK' } });
      const variant = await firstVariant([makeStorefrontVariant()]);

      expect(variant.sku).toBe('SKU-001');
      expect(variant.stockLevels).toBeUndefined();
    });

    it('does not join stock rows on the variant select', async () => {
      seed([makeStorefrontVariant()]);
      await service.listProducts({});

      const args = mockPrisma.product.findMany.mock.calls[0][0] as {
        select: { variants: { select: Record<string, unknown> } };
      };
      expect(args.select.variants.select).not.toHaveProperty('stockLevels');
      expect(args.select.variants.select).toHaveProperty('id', true);
    });

    it('grades the whole page in one inventory call, not one per variant', async () => {
      seed([
        makeStorefrontVariant({ id: 'var-1' }),
        makeStorefrontVariant({ id: 'var-2', isDefault: false }),
        makeStorefrontVariant({ id: 'var-3', isDefault: false }),
      ]);
      await service.listProducts({});

      expect(mockInventory.availabilityForVariants).toHaveBeenCalledTimes(1);
      expect(mockInventory.availabilityForVariants).toHaveBeenCalledWith([
        'var-1',
        'var-2',
        'var-3',
      ]);
    });

    it('collects variant ids across every product on the page', async () => {
      mockPrisma.product.count.mockResolvedValue(2);
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'prod-1', slug: 'a', assets: [], variants: [makeStorefrontVariant({ id: 'var-1' })] },
        { id: 'prod-2', slug: 'b', assets: [], variants: [makeStorefrontVariant({ id: 'var-2' })] },
      ]);
      await service.listProducts({});

      expect(mockInventory.availabilityForVariants).toHaveBeenCalledTimes(1);
      expect(mockInventory.availabilityForVariants).toHaveBeenCalledWith(['var-1', 'var-2']);
    });
  });

  /**
   * The catalogue sort control's price and name options were inert: the
   * storefront emitted `sortBy=price` / `sortBy=name`, the allowlist held
   * neither, and the service fell back to `sortOrder` in silence. Every spec
   * that existed asserted the emitted key, so none of them could fail on it.
   *
   * These assert the ORDER the service produces. `apps/api/test/catalog-sort
   * .e2e-spec.ts` asserts the same contract against a real database.
   */
  describe('listProducts sort', () => {
    interface ScanRow {
      id: string;
      name: Record<string, string>;
      variants: Array<{ price: number }>;
    }

    /**
     * Seeds the two `product.findMany` calls a computed sort makes: the id scan
     * over the filtered set, then the hydration of the page it cut.
     */
    function seedComputedSort(rows: ScanRow[]) {
      mockInventory.availabilityForVariants.mockResolvedValue(new Map());
      mockPrisma.product.findMany.mockResolvedValueOnce(rows);
      mockPrisma.product.findMany.mockImplementationOnce(
        async (args: { where: { id: { in: string[] } } }) =>
          // Deliberately returned in the WRONG order, because the database has
          // no reason to honour the id list's order and the service has to
          // restore it.
          [...args.where.id.in].reverse().map((id) => ({ id, slug: id, assets: [], variants: [] })),
      );
    }

    function scanRow(id: string, price: number | null, name: Record<string, string>): ScanRow {
      return { id, name, variants: price === null ? [] : [{ price }] };
    }

    async function orderOf(
      query: Record<string, unknown>,
      rows: ScanRow[],
      locale?: string,
    ): Promise<string[]> {
      seedComputedSort(rows);
      const result = await service.listProducts(query, locale);
      return (result.data as Array<{ id: string }>).map((p) => p.id);
    }

    const EN_FR = [
      scanRow('p-zinc', 300, { default: 'Zinc', en: 'Zinc', fr: 'Alesoir' }),
      scanRow('p-alpha', 100, { default: 'Alpha', en: 'Alpha', fr: 'Zircone' }),
      scanRow('p-middle', 200, { default: 'Middle', en: 'Middle', fr: 'Middle' }),
    ];

    it('orders by price ascending', async () => {
      expect(await orderOf({ sortBy: 'price', sortOrder: 'asc' }, EN_FR)).toEqual([
        'p-alpha',
        'p-middle',
        'p-zinc',
      ]);
    });

    it('orders by price descending', async () => {
      expect(await orderOf({ sortBy: 'price', sortOrder: 'desc' }, EN_FR)).toEqual([
        'p-zinc',
        'p-middle',
        'p-alpha',
      ]);
    });

    it('sorts a product with no active variant last in both directions', async () => {
      const rows = [...EN_FR, scanRow('p-none', null, { default: 'None', en: 'None', fr: 'None' })];

      const asc = await orderOf({ sortBy: 'price', sortOrder: 'asc' }, rows);
      const desc = await orderOf({ sortBy: 'price', sortOrder: 'desc' }, rows);

      expect(asc[asc.length - 1]).toBe('p-none');
      expect(desc[desc.length - 1]).toBe('p-none');
    });

    it('orders by name in the requested locale', async () => {
      expect(await orderOf({ sortBy: 'name', sortOrder: 'asc' }, EN_FR, 'en')).toEqual([
        'p-alpha',
        'p-middle',
        'p-zinc',
      ]);
      expect(await orderOf({ sortBy: 'name', sortOrder: 'asc' }, EN_FR, 'fr')).toEqual([
        'p-zinc',
        'p-middle',
        'p-alpha',
      ]);
    });

    it('accepts the sentinel locales the request resolver can produce', async () => {
      // `default` (no Accept-Language) and the unsupported-tag sentinel are not
      // BCP-47 tags; handing either to `new Intl.Collator` throws RangeError.
      // The sentinel is built rather than typed: a raw NUL in a source file is
      // invisible in review and turns the file binary to every text tool.
      const UNSUPPORTED_LOCALE_SENTINEL = `${String.fromCharCode(0)}unsupported`;
      await expect(
        orderOf({ sortBy: 'name', sortOrder: 'asc' }, EN_FR, 'default'),
      ).resolves.toEqual(['p-alpha', 'p-middle', 'p-zinc']);
      // The sentinel resolves through the store default rung (DR-31); this
      // fixture's English order is the one the assertion was written for.
      storeLocales.set({
        supportedLocales: ['fr', 'en'],
        defaultLocale: 'en',
        rtlLocales: [],
        timezone: 'UTC',
      });
      try {
        await expect(
          orderOf({ sortBy: 'name', sortOrder: 'asc' }, EN_FR, UNSUPPORTED_LOCALE_SENTINEL),
        ).resolves.toEqual(['p-alpha', 'p-middle', 'p-zinc']);
      } finally {
        storeLocales.set(NEUTRAL_LOCALE_SET);
      }
    });

    it('cuts the page from the computed order and reports the filtered total', async () => {
      seedComputedSort(EN_FR);
      const result = await service.listProducts({
        sortBy: 'price',
        sortOrder: 'asc',
        page: 2,
        pageSize: 2,
      });

      expect((result.data as Array<{ id: string }>).map((p) => p.id)).toEqual(['p-zinc']);
      expect(result.meta).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      // The scan already counted the filtered set; a second count query would
      // be a second answer to the same question.
      expect(mockPrisma.product.count).not.toHaveBeenCalled();
    });

    it('never re-applies skip/take to a page it already cut', async () => {
      seedComputedSort(EN_FR);
      await service.listProducts({ sortBy: 'price', sortOrder: 'asc', page: 2, pageSize: 2 });

      const hydration = mockPrisma.product.findMany.mock.calls[1][0] as Record<string, unknown>;
      expect(hydration).not.toHaveProperty('skip');
      expect(hydration).not.toHaveProperty('take');
      expect(hydration).not.toHaveProperty('orderBy');
    });

    it('leaves the column sorts in SQL', async () => {
      mockPrisma.product.count.mockResolvedValue(0);
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockInventory.availabilityForVariants.mockResolvedValue(new Map());

      await service.listProducts({ sortBy: 'publishedAt', sortOrder: 'desc', pageSize: 5 });

      expect(mockPrisma.product.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.product.findMany.mock.calls[0][0]).toMatchObject({
        orderBy: { publishedAt: 'desc' },
        skip: 0,
        take: 5,
      });
    });

    it('falls back to sortOrder for a field outside the allowlist', async () => {
      mockPrisma.product.count.mockResolvedValue(0);
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockInventory.availabilityForVariants.mockResolvedValue(new Map());

      await service.listProducts({ sortBy: 'costPrice', sortOrder: 'asc' });

      expect(mockPrisma.product.findMany.mock.calls[0][0]).toMatchObject({
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('getProductBySlug', () => {
    function seed(variants: Record<string, unknown>[]) {
      mockPrisma.product.findFirst.mockResolvedValue(
        makeProduct({
          status: ProductStatus.ACTIVE,
          assets: [],
          categories: [],
          faqs: [],
          variants,
        }),
      );
    }

    async function firstVariant(variants: Record<string, unknown>[]) {
      seed(variants);
      const product = (await service.getProductBySlug('fraise-diamant')) as {
        variants: StorefrontVariant[];
      };
      return product.variants[0];
    }

    it('emits the same widened variant shape the list emits', async () => {
      seedGrades({ 'var-1': { stock: 8, availability: 'IN_STOCK' } });
      const variant = await firstVariant([makeVariant()]);

      expect(variant).toEqual(expect.objectContaining({ id: 'var-1', availability: 'IN_STOCK' }));
      expect(variant.stockLevels).toBeUndefined();
    });

    it('never puts the exact stock count on the wire', async () => {
      seedGrades({ 'var-1': { stock: 8, availability: 'IN_STOCK' } });
      const variant = await firstVariant([makeVariant()]);

      expect(variant).not.toHaveProperty('stock');
    });

    it('surfaces LOW_STOCK verbatim', async () => {
      seedGrades({ 'var-1': { stock: 5, availability: 'LOW_STOCK' } });
      const variant = await firstVariant([makeVariant()]);

      expect(variant.availability).toBe('LOW_STOCK');
    });

    it('surfaces OUT_OF_STOCK verbatim', async () => {
      seedGrades({ 'var-1': { stock: 0, availability: 'OUT_OF_STOCK' } });
      const variant = await firstVariant([makeVariant()]);

      expect(variant.availability).toBe('OUT_OF_STOCK');
    });

    it('keeps price serialized as a number', async () => {
      const variant = (await firstVariant([makeVariant({ price: 349.5 })])) as unknown as {
        price: number;
      };

      expect(typeof variant.price).toBe('number');
      expect(variant.price).toBe(349.5);
    });

    // The route is @Public(), so what the query selects IS the public contract
    // (plan J, sweep S1). Asserted as an exact set: a ProductVariant column
    // added later must fail here rather than reach anonymous callers.
    it('queries variants with an explicit public select, never a bare include', async () => {
      seed([makeVariant()]);
      await service.getProductBySlug('fraise-diamant');

      const args = mockPrisma.product.findFirst.mock.calls[0][0] as {
        include: { variants: { select?: Record<string, unknown>; include?: unknown } };
      };
      expect(args.include.variants.include).toBeUndefined();
      expect(Object.keys(args.include.variants.select ?? {}).sort()).toEqual(
        ['id', 'productId', 'sku', 'price', 'compareAtPrice', 'isDefault'].sort(),
      );
    });

    it('never selects cost price, license key or the download policy', async () => {
      seed([makeVariant()]);
      await service.getProductBySlug('fraise-diamant');

      const args = mockPrisma.product.findFirst.mock.calls[0][0] as {
        include: { variants: { select: Record<string, unknown> } };
      };
      for (const forbidden of [
        'costPrice',
        'licenseKey',
        'barcode',
        'maxDownloads',
        'downloadExpiryDays',
        'weight',
        'deletedAt',
        'createdAt',
        'updatedAt',
        'stockLevels',
        'attributeValues',
      ]) {
        expect(args.include.variants.select).not.toHaveProperty(forbidden);
      }
    });

    it('grades the variants in one inventory call, not one per variant', async () => {
      seed([makeVariant({ id: 'var-1' }), makeVariant({ id: 'var-2' })]);
      await service.getProductBySlug('fraise-diamant');

      expect(mockInventory.availabilityForVariants).toHaveBeenCalledTimes(1);
      expect(mockInventory.availabilityForVariants).toHaveBeenCalledWith(['var-1', 'var-2']);
    });

    it('never writes stock or availability into the cache', async () => {
      seedGrades({ 'var-1': { stock: 8, availability: 'IN_STOCK' } });
      seed([makeVariant()]);
      await service.getProductBySlug('fraise-diamant');

      const cached = JSON.parse(mockRedis.set.mock.calls[0][1] as string) as {
        variants: StorefrontVariant[];
      };
      expect(cached.variants[0].stock).toBeUndefined();
      expect(cached.variants[0].availability).toBeUndefined();
      expect(cached.variants[0].stockLevels).toBeUndefined();
    });

    // A cache entry written by the previous deploy still carries the count for
    // up to the 5-minute TTL, so the boundary strips it rather than trusting it.
    it('strips a stock count that rode in on a stale cache entry', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ id: 'prod-1', variants: [{ id: 'var-1', sku: 'SKU-001', stock: 42 }] }),
      );
      seedGrades({ 'var-1': { stock: 42, availability: 'IN_STOCK' } });

      const product = (await service.getProductBySlug('fraise-diamant')) as {
        variants: StorefrontVariant[];
      };

      expect(product.variants[0]).not.toHaveProperty('stock');
      expect(product.variants[0].availability).toBe('IN_STOCK');
    });

    it('still produces a fresh grade on a cache hit', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ id: 'prod-1', variants: [{ id: 'var-1', sku: 'SKU-001' }] }),
      );
      seedGrades({ 'var-1': { stock: 3, availability: 'LOW_STOCK' } });

      const product = (await service.getProductBySlug('fraise-diamant')) as {
        variants: StorefrontVariant[];
      };

      expect(mockPrisma.product.findFirst).not.toHaveBeenCalled();
      expect(mockInventory.availabilityForVariants).toHaveBeenCalledWith(['var-1']);
      expect(product.variants[0]).toEqual(expect.objectContaining({ availability: 'LOW_STOCK' }));
      expect(product.variants[0]).not.toHaveProperty('stock');
    });

    // Regression: nothing invalidates the 5-minute detail cache when stock
    // moves, so a cached page used to keep serving the availability it was
    // built with.
    it('reflects stock that moved after the page was cached', async () => {
      seedGrades({ 'var-1': { stock: 1, availability: 'LOW_STOCK' } });
      seed([makeVariant()]);

      const fresh = (await service.getProductBySlug('fraise-diamant')) as {
        variants: StorefrontVariant[];
      };
      expect(fresh.variants[0].availability).toBe('LOW_STOCK');

      // The last unit sells: the cache still holds the old payload, but the
      // inventory module now reports an empty shelf.
      mockRedis.get.mockResolvedValue(mockRedis.set.mock.calls[0][1] as string);
      seedGrades({ 'var-1': { stock: 0, availability: 'OUT_OF_STOCK' } });

      const afterSale = (await service.getProductBySlug('fraise-diamant')) as {
        variants: StorefrontVariant[];
      };

      expect(afterSale.variants[0].availability).toBe('OUT_OF_STOCK');
      expect(afterSale.variants[0]).not.toHaveProperty('stock');
    });

    it('serves a restock through the cache too', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ id: 'prod-1', variants: [{ id: 'var-1', sku: 'SKU-001' }] }),
      );
      seedGrades({ 'var-1': { stock: 25, availability: 'IN_STOCK' } });

      const product = (await service.getProductBySlug('fraise-diamant')) as {
        variants: StorefrontVariant[];
      };

      expect(product.variants[0].availability).toBe('IN_STOCK');
    });

    it('throws when the slug matches no active product', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(service.getProductBySlug('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteProduct (archive)', () => {
    it('sets status=ARCHIVED and deletedAt', async () => {
      const product = makeProduct({ status: ProductStatus.DRAFT });
      mockPrisma.product.findUnique.mockResolvedValue(product);
      mockPrisma.product.update.mockResolvedValue({ ...product, status: ProductStatus.ARCHIVED });

      await service.deleteProduct('prod-1');

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: expect.objectContaining({
          status: ProductStatus.ARCHIVED,
          deletedAt: expect.any(Date),
        }),
      });
    });

    it('throws NotFoundException when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.deleteProduct('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when product is already archived', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(
        makeProduct({ status: ProductStatus.ARCHIVED }),
      );
      await expect(service.deleteProduct('prod-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('adminGetProduct', () => {
    it('returns the product with nested asset envelope on the assets relation', async () => {
      const product = makeProduct({
        assets: [
          {
            assetId: 'a-1',
            sortOrder: 0,
            isPrimary: true,
            asset: {
              id: 'a-1',
              url: 'https://cdn.example.com/img.jpg',
              type: 'IMAGE',
              alt: { default: 'Alt' },
              status: 'READY',
              mimeType: 'image/jpeg',
              fileSize: 12345,
              width: 800,
              height: 600,
            },
          },
        ],
      });
      mockPrisma.product.findUnique.mockResolvedValueOnce(product);

      const result = (await service.adminGetProduct('prod-1')) as {
        assets: Array<{
          assetId: string;
          sortOrder: number;
          isPrimary: boolean;
          asset: { id: string; url: string; type: string };
        }>;
      };

      expect(mockPrisma.product.findUnique).toHaveBeenCalledTimes(1);
      const call = mockPrisma.product.findUnique.mock.calls[0][0] as {
        include: {
          assets: { include?: { asset: { select: Record<string, true> } } };
        };
      };
      expect(call.include.assets.include).toBeDefined();
      const select = call.include.assets.include!.asset.select;
      expect(select).toMatchObject({
        id: true,
        url: true,
        type: true,
        alt: true,
        status: true,
        mimeType: true,
        fileSize: true,
        width: true,
        height: true,
      });

      expect(result.assets[0].asset.id).toBe('a-1');
      expect(result.assets[0].asset.url).toBe('https://cdn.example.com/img.jpg');
      expect(result.assets[0].asset.type).toBe('IMAGE');
    });

    it('falls back to archived lookup when live row missing', async () => {
      const archived = makeProduct({
        deletedAt: new Date(),
        status: ProductStatus.ARCHIVED,
        assets: [],
      });
      mockPrisma.product.findUnique.mockResolvedValueOnce(null);
      mockPrisma.product.findFirst.mockResolvedValueOnce(archived);

      const result = (await service.adminGetProduct('prod-1')) as { id: string };
      expect(result.id).toBe('prod-1');
      expect(mockPrisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-1', deletedAt: { not: null } },
        include: expect.objectContaining({
          assets: expect.objectContaining({
            include: { asset: { select: expect.any(Object) } },
          }),
        }),
      });
    });

    it('throws NotFoundException when neither live nor archived row exists', async () => {
      mockPrisma.product.findUnique.mockResolvedValueOnce(null);
      mockPrisma.product.findFirst.mockResolvedValueOnce(null);
      await expect(service.adminGetProduct('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('restoreProduct', () => {
    it('clears deletedAt and sets status=DRAFT', async () => {
      const archived = makeProduct({
        status: ProductStatus.ARCHIVED,
        deletedAt: new Date(),
      });
      mockPrisma.product.findFirst.mockResolvedValueOnce(archived); // restore check
      mockPrisma.product.update.mockResolvedValue({
        ...archived,
        status: ProductStatus.DRAFT,
        deletedAt: null,
      });
      // adminGetProduct call
      mockPrisma.product.findUnique.mockResolvedValue({
        ...archived,
        status: ProductStatus.DRAFT,
        deletedAt: null,
        variants: [],
        assets: [],
        faqs: [],
        categories: [],
        productType: null,
      });

      await service.restoreProduct('prod-1');

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { status: ProductStatus.DRAFT, deletedAt: null },
      });
    });

    it('throws NotFoundException when no archived product found', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);
      await expect(service.restoreProduct('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createProduct status default', () => {
    it('defaults to DRAFT when no status provided', async () => {
      const adminProductResult = {
        id: 'prod-1',
        name: { default: 'New' },
        slug: 'new',
        status: ProductStatus.DRAFT,
        variants: [],
        assets: [],
        faqs: [],
        categories: [],
        productType: null,
      };
      mockPrisma.product.findUnique
        .mockResolvedValueOnce(null) // generateUniqueSlug: slug 'new' not taken
        .mockResolvedValueOnce(null) // createProduct: explicit conflict check
        .mockResolvedValueOnce(adminProductResult); // adminGetProduct
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.product.create.mockResolvedValue({ id: 'prod-1', slug: 'new' });

      await service.createProduct({
        name: { default: 'New' },
      });

      expect(mockPrisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ProductStatus.DRAFT }),
        }),
      );
    });
  });

  // ── updateProduct — slug change event ──────────────────────────────────────

  describe('updateProduct slug change', () => {
    it('emits PRODUCT_SLUG_CHANGED_EVENT when slug changes', async () => {
      const existing = makeProduct({ slug: 'old-slug' });
      const adminResult = {
        ...existing,
        slug: 'new-slug',
        variants: [],
        assets: [],
        faqs: [],
        categories: [],
        productType: null,
      };
      // findUnique: call 1 = load existing product; call 2 = invalidateProductCache slug fetch; call 3 = adminGetProduct
      mockPrisma.product.findUnique
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ slug: 'new-slug' })
        .mockResolvedValueOnce(adminResult);
      // findFirst: slug conflict check — no conflict
      mockPrisma.product.findFirst.mockResolvedValueOnce(null);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.product.update.mockResolvedValue({ ...existing, slug: 'new-slug' });
      mockPrisma.productCategory.deleteMany.mockResolvedValue({});

      await service.updateProduct('prod-1', { slug: 'new-slug' });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(PRODUCT_SLUG_CHANGED_EVENT, {
        productId: 'prod-1',
        oldSlug: 'old-slug',
        newSlug: 'new-slug',
      });
    });

    it('does NOT emit PRODUCT_SLUG_CHANGED_EVENT when slug is unchanged', async () => {
      const existing = makeProduct({ slug: 'same-slug' });
      const adminResult = {
        ...existing,
        variants: [],
        assets: [],
        faqs: [],
        categories: [],
        productType: null,
      };
      // No slug change → no findFirst conflict check; call 2 = invalidateProductCache slug fetch; call 3 = adminGetProduct
      mockPrisma.product.findUnique
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ slug: 'same-slug' })
        .mockResolvedValueOnce(adminResult);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.product.update.mockResolvedValue(existing);
      mockPrisma.productCategory.deleteMany.mockResolvedValue({});

      await service.updateProduct('prod-1', { slug: 'same-slug' });

      const slugChangeCalls = (mockEventEmitter.emit as jest.Mock).mock.calls.filter(
        ([event]: [string]) => event === 'product.slug.changed',
      );
      expect(slugChangeCalls).toHaveLength(0);
    });
  });

  // ── PRODUCT_MUTATED IndexNow visibility gate (DR-15 F01) ────────────────────
  //
  // The shouldSubmitIndexNow boolean computed at each emit site IS the core of
  // F01. These assert the full transition matrix so a regression that flips
  // `!slugChanged`, mis-gates archive, or makes a draft/restore submit is caught.

  describe('PRODUCT_MUTATED shouldSubmitIndexNow gate', () => {
    function mutatedPayload(): { shouldSubmitIndexNow: boolean; slug: string } | undefined {
      const calls = (mockEventEmitter.emit as jest.Mock).mock.calls.filter(
        ([event]: [string]) => event === PRODUCT_MUTATED_EVENT,
      );
      return calls[calls.length - 1]?.[1];
    }

    function mockUpdateFlow(
      existing: Record<string, unknown>,
      adminResult: Record<string, unknown>,
    ) {
      mockPrisma.product.findUnique
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ slug: existing['slug'] })
        .mockResolvedValueOnce(adminResult);
      mockPrisma.product.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.product.update.mockResolvedValue(existing);
      mockPrisma.productCategory.deleteMany.mockResolvedValue({});
    }

    it('publish (DRAFT→ACTIVE) submits', async () => {
      const existing = makeProduct({ slug: 's', status: ProductStatus.DRAFT });
      mockUpdateFlow(existing, { ...existing, status: ProductStatus.ACTIVE });
      await service.updateProduct('prod-1', { status: ProductStatus.ACTIVE });
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(true);
    });

    it('live-edit of an ACTIVE product submits', async () => {
      const existing = makeProduct({ slug: 's', status: ProductStatus.ACTIVE });
      mockUpdateFlow(existing, existing);
      await service.updateProduct('prod-1', { name: { default: 'X' } });
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(true);
    });

    it('draft edit (DRAFT→DRAFT) does NOT submit', async () => {
      const existing = makeProduct({ slug: 's', status: ProductStatus.DRAFT });
      mockUpdateFlow(existing, existing);
      await service.updateProduct('prod-1', { name: { default: 'X' } });
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(false);
    });

    it('unpublish (ACTIVE→DRAFT) submits so IndexNow re-crawls → 404', async () => {
      const existing = makeProduct({ slug: 's', status: ProductStatus.ACTIVE });
      mockUpdateFlow(existing, { ...existing, status: ProductStatus.DRAFT });
      await service.updateProduct('prod-1', { status: ProductStatus.DRAFT });
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(true);
    });

    it('slug change on an ACTIVE product does NOT submit via MUTATED (SLUG_CHANGED handles it)', async () => {
      const existing = makeProduct({ slug: 'old', status: ProductStatus.ACTIVE });
      mockUpdateFlow(existing, { ...existing, slug: 'new' });
      await service.updateProduct('prod-1', { slug: 'new' });
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(false);
    });

    it('archive of an ACTIVE product submits removal (and emits MUTATED at all)', async () => {
      const existing = makeProduct({ slug: 's', status: ProductStatus.ACTIVE });
      mockPrisma.product.findUnique.mockResolvedValue(existing);
      mockPrisma.product.update.mockResolvedValue({ ...existing, status: ProductStatus.ARCHIVED });
      await service.deleteProduct('prod-1');
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(true);
    });

    it('archive of a DRAFT product does NOT submit', async () => {
      const existing = makeProduct({ slug: 's', status: ProductStatus.DRAFT });
      mockPrisma.product.findUnique.mockResolvedValue(existing);
      mockPrisma.product.update.mockResolvedValue({ ...existing, status: ProductStatus.ARCHIVED });
      await service.deleteProduct('prod-1');
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(false);
    });

    it('restore (→DRAFT) does NOT submit', async () => {
      const existing = makeProduct({
        slug: 's',
        status: ProductStatus.ARCHIVED,
        deletedAt: new Date(),
      });
      mockPrisma.product.findFirst.mockResolvedValue(existing);
      mockPrisma.product.update.mockResolvedValue({
        ...existing,
        status: ProductStatus.DRAFT,
        deletedAt: null,
      });
      mockPrisma.product.findUnique.mockResolvedValue({ ...existing, status: ProductStatus.DRAFT });
      await service.restoreProduct('prod-1');
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(false);
    });

    it('create as ACTIVE submits', async () => {
      mockPrisma.product.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeProduct({ status: ProductStatus.ACTIVE }));
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.product.create.mockResolvedValue({
        id: 'prod-1',
        slug: 'new',
        status: ProductStatus.ACTIVE,
      });
      await service.createProduct({ name: { default: 'New' }, status: ProductStatus.ACTIVE });
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(true);
    });

    it('create as DRAFT does NOT submit', async () => {
      mockPrisma.product.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeProduct({ status: ProductStatus.DRAFT }));
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
      );
      mockPrisma.product.create.mockResolvedValue({
        id: 'prod-1',
        slug: 'new',
        status: ProductStatus.DRAFT,
      });
      await service.createProduct({ name: { default: 'New' } });
      expect(mutatedPayload()?.shouldSubmitIndexNow).toBe(false);
    });
  });

  // ── deleteVariant guard ────────────────────────────────────────────────────

  describe('deleteVariant', () => {
    it('throws ConflictException when deleting the last active variant', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue(makeVariant());
      mockPrisma.productVariant.count.mockResolvedValue(1);

      await expect(service.deleteVariant('prod-1', 'var-1')).rejects.toThrow(ConflictException);
    });

    it('soft-deletes when more than one active variant exists', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue(makeVariant());
      mockPrisma.productVariant.count.mockResolvedValue(2);
      mockPrisma.productVariant.update.mockResolvedValue({
        ...makeVariant(),
        deletedAt: new Date(),
      });

      await service.deleteVariant('prod-1', 'var-1');

      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-1' },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
    });
  });

  // ── updateAssets validation ────────────────────────────────────────────────

  describe('updateAssets', () => {
    it('throws BadRequestException when multiple primary assets provided', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      await expect(
        service.updateAssets('prod-1', {
          assets: [
            { assetId: 'a1', sortOrder: 0, isPrimary: true },
            { assetId: 'a2', sortOrder: 1, isPrimary: true },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── createProduct — slug conflict ─────────────────────────────────────────

  describe('createProduct', () => {
    it('throws ConflictException when slug already exists', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct()); // slug taken

      await expect(
        service.createProduct({
          name: { default: 'Test' },
          slug: 'test-product',
        }),
      ).rejects.toThrow(ConflictException);
    });

    /**
     * An unknown categoryId used to reach `productCategory.createMany` and
     * surface as a Prisma P2003, i.e. a 500 for a client mistake.
     */
    it('rejects an unknown categoryId with a 400 naming the missing id', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      mockCategories.findExistingIds.mockResolvedValue(['cat-real']);

      const err = await service
        .createProduct({
          name: { default: 'Test' },
          slug: 'test-product',
          categoryIds: ['cat-real', 'cat-ghost'],
        })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ProductCategoryNotFoundException);
      expect((err as { getResponse: () => unknown }).getResponse()).toMatchObject({
        error: {
          code: 'PRODUCT_CATEGORY_NOT_FOUND',
          details: { missingIds: ['cat-ghost'] },
        },
      });
      // Rejected before the write, so no transaction ran.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not consult the category module when no categoryIds are sent', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      await service
        .createProduct({ name: { default: 'Test' }, slug: 'test-product' })
        .catch(() => undefined);

      expect(mockCategories.findExistingIds).not.toHaveBeenCalled();
    });
  });

  describe('updateProduct category validation', () => {
    it('rejects an unknown categoryId with a 400 before replacing the set', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
      mockCategories.findExistingIds.mockResolvedValue([]);

      await expect(
        service.updateProduct('prod-1', { categoryIds: ['cat-ghost'] }),
      ).rejects.toBeInstanceOf(ProductCategoryNotFoundException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('adminGetProductStock', () => {
    beforeEach(() => {
      mockInventory.stockForVariants = jest.fn().mockResolvedValue(new Map());
      mockInventory.listActiveLocations = jest.fn().mockResolvedValue([]);
      mockInventory.stockThreshold = jest.fn().mockResolvedValue(5);
    });

    it('404s on an unknown product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.adminGetProductStock('nope')).rejects.toBeInstanceOf(
        ProductNotFoundException,
      );
    });

    /**
     * The case the whole feature hangs on. A screen built on a StockLevel
     * filter cannot show a variant that has no rows, which is exactly the
     * variant an operator needs to find in order to give it stock.
     */
    it('returns a row for a variant with no stock levels at all', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: 'v-1', sku: 'SKU-1', isDefault: true },
      ]);

      const res = (await service.adminGetProductStock('prod-1')) as {
        variants: Array<{ variantId: string; totals: unknown; levels: unknown[] }>;
      };

      expect(res.variants).toHaveLength(1);
      expect(res.variants[0]).toMatchObject({
        variantId: 'v-1',
        totals: { onHand: 0, reserved: 0, available: 0 },
        levels: [],
      });
    });

    it('excludes soft-deleted variants', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
      mockPrisma.productVariant.findMany.mockResolvedValue([]);

      await service.adminGetProductStock('prod-1');

      expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productId: 'prod-1', deletedAt: null } }),
      );
    });

    it('grades status with the threshold the inventory module reports', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: 'v-1', sku: 'SKU-1', isDefault: true },
      ]);
      mockInventory.stockForVariants = jest
        .fn()
        .mockResolvedValue(
          new Map([['v-1', { levels: [], totals: { onHand: 3, reserved: 0, available: 3 } }]]),
        );

      const res = (await service.adminGetProductStock('prod-1')) as {
        lowStockThreshold: number;
        variants: Array<{ status: string }>;
      };

      expect(res.lowStockThreshold).toBe(5);
      expect(res.variants[0].status).toBe('LOW_STOCK');
    });

    /**
     * The global response interceptor wraps every payload in `{ data: ... }`.
     * A service that wraps as well emits `{"data":{"data":…}}`, which the admin
     * client unwraps once and then fails to parse, so the screen reports
     * "Could not load" for a request that actually succeeded.
     */
    it('returns the payload unwrapped, leaving the envelope to the interceptor', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
      mockPrisma.productVariant.findMany.mockResolvedValue([]);

      const res = (await service.adminGetProductStock('prod-1')) as Record<string, unknown>;

      expect(res).not.toHaveProperty('data');
      expect(res).toHaveProperty('lowStockThreshold');
      expect(res).toHaveProperty('variants');
    });

    /**
     * The §3.1 pin. `stockLevel` is deliberately absent from the Prisma mock,
     * so any direct read of the inventory module's table from here throws
     * rather than quietly working.
     */
    it('never reads StockLevel directly, only through the inventory module', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());
      mockPrisma.productVariant.findMany.mockResolvedValue([
        { id: 'v-1', sku: 'SKU-1', isDefault: true },
      ]);

      await service.adminGetProductStock('prod-1');

      expect(mockInventory.stockForVariants).toHaveBeenCalledWith(['v-1']);
      expect((mockPrisma as Record<string, unknown>)['stockLevel']).toBeUndefined();
    });
  });

  describe('replaceSpecs', () => {
    const tx = {
      productSpec: { deleteMany: jest.fn(), upsert: jest.fn() },
    };

    beforeEach(() => {
      tx.productSpec.deleteMany.mockReset().mockResolvedValue({ count: 0 });
      tx.productSpec.upsert.mockReset().mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
        (fn as (t: unknown) => Promise<unknown>)(tx),
      );
      mockPrisma.productSpec.findMany.mockResolvedValue([]);
    });

    it('404s when the product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.replaceSpecs('nope', { specs: [] })).rejects.toBeInstanceOf(
        ProductNotFoundException,
      );
    });

    it('derives key and valueKey server-side with the shared fold', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      await service.replaceSpecs('prod-1', {
        specs: [{ label: { default: 'Materiau' }, value: { default: 'Acier Inoxydable' } }],
      });

      expect(tx.productSpec.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId_key: { productId: 'prod-1', key: 'materiau' } },
          create: expect.objectContaining({ key: 'materiau', valueKey: 'acier-inoxydable' }),
        }),
      );
    });

    it('assigns sortOrder from array position, not from the client', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      await service.replaceSpecs('prod-1', {
        specs: [
          { label: { default: 'Second' }, value: { default: 'b' } },
          { label: { default: 'First' }, value: { default: 'a' } },
        ],
      });

      const created = tx.productSpec.upsert.mock.calls.map(
        (c) => (c[0] as { create: { sortOrder: number; key: string } }).create,
      );
      expect(created).toEqual([
        expect.objectContaining({ key: 'second', sortOrder: 0 }),
        expect.objectContaining({ key: 'first', sortOrder: 1 }),
      ]);
    });

    it('removes the rows the payload omits', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      await service.replaceSpecs('prod-1', {
        specs: [{ label: { default: 'Kept' }, value: { default: 'v' } }],
      });

      expect(tx.productSpec.deleteMany).toHaveBeenCalledWith({
        where: { productId: 'prod-1', key: { notIn: ['kept'] } },
      });
    });

    it('an empty array is a legal clear-all', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      await service.replaceSpecs('prod-1', { specs: [] });

      expect(tx.productSpec.deleteMany).toHaveBeenCalledWith({
        where: { productId: 'prod-1', key: { notIn: [] } },
      });
      expect(tx.productSpec.upsert).not.toHaveBeenCalled();
    });

    /**
     * The accent-collision path. Both spellings fold to the same key, so the
     * two rows are one specification as far as the unique constraint is
     * concerned; reaching the database would be a P2002, i.e. a 500.
     */
    it('rejects two labels that fold to the same key, naming both spellings', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      const err = await service
        .replaceSpecs('prod-1', {
          specs: [
            { label: { default: 'Materiau' }, value: { default: 'acier' } },
            { label: { default: 'MATERIAU' }, value: { default: 'titane' } },
          ],
        })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ProductSpecDuplicateKeyException);
      expect((err as { getResponse: () => unknown }).getResponse()).toMatchObject({
        error: {
          code: 'PRODUCT_SPEC_DUPLICATE_KEY',
          details: { key: 'materiau', labels: ['Materiau', 'MATERIAU'] },
        },
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a label that folds to nothing', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      await expect(
        service.replaceSpecs('prod-1', {
          specs: [{ label: { default: '!!!' }, value: { default: 'v' } }],
        }),
      ).rejects.toBeInstanceOf(ProductSpecEmptyKeyException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('busts the spec-facet cache, which nothing invalidated before', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(makeProduct());

      await service.replaceSpecs('prod-1', {
        specs: [{ label: { default: 'Materiau' }, value: { default: 'acier' } }],
      });

      const deleted = mockRedis.del.mock.calls.flat();
      expect(deleted).toContain('products:spec-facets');
    });
  });

  describe('listSpecLabels', () => {
    it('folds the search term so an unaccented query finds an accented label', async () => {
      mockPrisma.productSpec.groupBy.mockResolvedValue([]);

      await service.listSpecLabels({ search: 'Materiau' });

      const args = mockPrisma.productSpec.groupBy.mock.calls[0][0] as { where: unknown };
      expect(args.where).toMatchObject({ key: { startsWith: 'materiau' } });
    });

    /**
     * `contains` compiles to a leading-wildcard LIKE, which no btree can serve,
     * so every debounced keystroke would scan every spec row in the catalogue.
     */
    it('matches on a prefix so the key index is usable', async () => {
      mockPrisma.productSpec.groupBy.mockResolvedValue([]);

      await service.listSpecLabels({ search: 'mat' });

      const args = mockPrisma.productSpec.groupBy.mock.calls[0][0] as {
        where: { key?: Record<string, unknown> };
      };
      expect(args.where.key).toHaveProperty('startsWith');
      expect(args.where.key).not.toHaveProperty('contains');
    });

    it('excludes soft-deleted products, whose spec rows survive the soft delete', async () => {
      mockPrisma.productSpec.groupBy.mockResolvedValue([]);

      await service.listSpecLabels({});

      expect(mockPrisma.productSpec.groupBy.mock.calls[0][0]).toMatchObject({
        where: { product: { deletedAt: null } },
      });
    });

    it('does NOT filter on product status, unlike the storefront facet rail', async () => {
      mockPrisma.productSpec.groupBy.mockResolvedValue([]);

      await service.listSpecLabels({});

      const args = mockPrisma.productSpec.groupBy.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(args.where)).not.toContain('status');
    });

    it('returns the product count per key and a resolved label spelling', async () => {
      mockPrisma.productSpec.groupBy
        .mockResolvedValueOnce([{ key: 'materiau', _count: { _all: 7 } }])
        .mockResolvedValueOnce([{ key: 'materiau' }]);
      mockPrisma.productSpec.findMany.mockResolvedValue([
        { key: 'materiau', label: { default: 'Materiau', fr: 'Materiau', en: 'Material' } },
      ]);

      const result = (await service.listSpecLabels({})) as {
        data: Array<{ key: string; label: unknown; productCount: number }>;
        meta: { total: number };
      };

      expect(result.data).toEqual([
        {
          key: 'materiau',
          label: { default: 'Materiau', fr: 'Materiau', en: 'Material' },
          productCount: 7,
        },
      ]);
      expect(result.meta.total).toBe(1);
    });
  });

  // ── findByAssetId / findVariantsByDownloadAssetId (S18 — DR-07) ───────────

  describe('findByAssetId', () => {
    it('queries products via the ProductAsset join with soft-delete middleware', async () => {
      const row = { id: 'prod-1', name: { default: 'Tee' }, slug: 'classic-tee' };
      mockPrisma.product.findMany.mockResolvedValueOnce([row]);

      const result = await service.findByAssetId('asset-9');

      expect(result).toEqual([row]);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: { assets: { some: { assetId: 'asset-9' } } },
        select: { id: true, name: true, slug: true },
      });
    });

    it('returns empty when no products reference the asset', async () => {
      mockPrisma.product.findMany.mockResolvedValueOnce([]);
      const result = await service.findByAssetId('asset-none');
      expect(result).toEqual([]);
    });
  });

  describe('findVariantsByDownloadAssetId', () => {
    it('returns variants flattening parent product slug', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValueOnce([
        {
          id: 'var-1',
          sku: 'SKU-1',
          productId: 'prod-1',
          product: { slug: 'digital-album' },
        },
      ]);

      const result = await service.findVariantsByDownloadAssetId('asset-9');

      expect(result).toEqual([
        { id: 'var-1', productId: 'prod-1', productSlug: 'digital-album', sku: 'SKU-1' },
      ]);
      expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith({
        where: { downloadableFiles: { some: { assetId: 'asset-9' } } },
        select: {
          id: true,
          sku: true,
          productId: true,
          product: { select: { slug: true } },
        },
      });
    });

    it('returns empty when no variant references the asset as a download', async () => {
      mockPrisma.productVariant.findMany.mockResolvedValueOnce([]);
      const result = await service.findVariantsByDownloadAssetId('asset-none');
      expect(result).toEqual([]);
    });
  });

  // ── resolveActivePublicSlugs (SEO submit, DR-17 D2) ───────────────────────────

  describe('resolveActivePublicSlugs', () => {
    it('queries only ACTIVE products for the requested ids and selects id + slug', async () => {
      mockPrisma.product.findMany.mockResolvedValueOnce([
        { id: 'prod-1', slug: 'alpha' },
        { id: 'prod-2', slug: 'beta' },
      ]);
      const result = await service.resolveActivePublicSlugs(['prod-1', 'prod-2']);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['prod-1', 'prod-2'] }, status: ProductStatus.ACTIVE },
        select: { id: true, slug: true },
      });
      expect(result).toEqual([
        { id: 'prod-1', slug: 'alpha' },
        { id: 'prod-2', slug: 'beta' },
      ]);
    });

    it('drops unknown / draft / soft-deleted ids (returns only what the query yields)', async () => {
      // Two requested, only one is ACTIVE + present → the other is silently dropped.
      mockPrisma.product.findMany.mockResolvedValueOnce([{ id: 'prod-1', slug: 'alpha' }]);
      const result = await service.resolveActivePublicSlugs(['prod-1', 'prod-missing']);
      expect(result).toEqual([{ id: 'prod-1', slug: 'alpha' }]);
    });

    it('short-circuits to an empty array without a DB call when no ids are given', async () => {
      const result = await service.resolveActivePublicSlugs([]);
      expect(result).toEqual([]);
      expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    });
  });

  // ── listRecentlyUpdatedActiveSlugs (SEO URL-Inspection sweep, DR-17 D5) ────────

  describe('listRecentlyUpdatedActiveSlugs', () => {
    it('queries ACTIVE products ordered by updatedAt desc, bounded by take', async () => {
      mockPrisma.product.findMany.mockResolvedValueOnce([
        { id: 'prod-1', slug: 'honey', updatedAt: new Date('2026-06-28T00:00:00.000Z') },
      ]);
      const result = await service.listRecentlyUpdatedActiveSlugs(100);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: { status: ProductStatus.ACTIVE },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: { id: true, slug: true, updatedAt: true },
      });
      expect(result).toEqual([
        { id: 'prod-1', slug: 'honey', updatedAt: new Date('2026-06-28T00:00:00.000Z') },
      ]);
    });

    it('never passes deletedAt explicitly (soft-delete handled by the middleware)', async () => {
      mockPrisma.product.findMany.mockResolvedValueOnce([]);
      await service.listRecentlyUpdatedActiveSlugs(50);
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('deletedAt');
      expect(where).toEqual({ status: ProductStatus.ACTIVE });
    });

    it('short-circuits to an empty array without a DB call when limit <= 0', async () => {
      const result = await service.listRecentlyUpdatedActiveSlugs(0);
      expect(result).toEqual([]);
      expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    });
  });

  // ── adminListProducts search (QA finding C2, plan C phase C0) ────────────────

  describe('adminListProducts search', () => {
    function primeList() {
      mockPrisma.product.count.mockResolvedValueOnce(0);
      mockPrisma.product.findMany.mockResolvedValueOnce([]);
    }

    const expectedOr = [
      { slug: { contains: 'urb', mode: 'insensitive' } },
      { variants: { some: { sku: { contains: 'urb', mode: 'insensitive' }, deletedAt: null } } },
      { brand: { contains: 'urb', mode: 'insensitive' } },
      { name: { path: ['fr'], string_contains: 'urb', mode: 'insensitive' } },
      { name: { path: ['en'], string_contains: 'urb', mode: 'insensitive' } },
      { name: { path: ['default'], string_contains: 'urb', mode: 'insensitive' } },
    ];

    it('applies search as an insensitive OR over slug, variant sku, and brand', async () => {
      primeList();
      await service.adminListProducts({ search: 'urb' });
      expect(mockPrisma.product.findMany.mock.calls[0][0].where).toEqual({ OR: expectedOr });
      expect(mockPrisma.product.count.mock.calls[0][0].where).toEqual({ OR: expectedOr });
    });

    it('trims the term and combines the OR with the existing filters', async () => {
      primeList();
      await service.adminListProducts({ search: '  urb  ', status: ProductStatus.ACTIVE });
      expect(mockPrisma.product.findMany.mock.calls[0][0].where).toEqual({
        status: ProductStatus.ACTIVE,
        OR: expectedOr,
      });
    });

    it('also matches the slugified term so a typed product name finds its row', async () => {
      primeList();
      await service.adminListProducts({ search: 'Sidr Honey' });
      // The operator types the name they see on screen. Without this the box
      // looks broken: "Sidr Honey" never matches slug "sidr-honey".
      expect(mockPrisma.product.findMany.mock.calls[0][0].where).toEqual({
        OR: [
          { slug: { contains: 'Sidr Honey', mode: 'insensitive' } },
          { slug: { contains: 'sidr-honey', mode: 'insensitive' } },
          {
            variants: {
              some: { sku: { contains: 'Sidr Honey', mode: 'insensitive' }, deletedAt: null },
            },
          },
          { brand: { contains: 'Sidr Honey', mode: 'insensitive' } },
          { name: { path: ['fr'], string_contains: 'Sidr Honey', mode: 'insensitive' } },
          { name: { path: ['en'], string_contains: 'Sidr Honey', mode: 'insensitive' } },
          { name: { path: ['default'], string_contains: 'Sidr Honey', mode: 'insensitive' } },
        ],
      });
    });

    it('matches an accented French name that no slug can carry', async () => {
      primeList();
      // A slug drops accents, so "poignée" only ever matches on the JSONB side.
      await service.adminListProducts({ search: 'poignée' });
      const clauses = mockPrisma.product.findMany.mock.calls[0][0].where.OR as Array<
        Record<string, unknown>
      >;
      expect(clauses).toContainEqual({
        name: { path: ['fr'], string_contains: 'poignée', mode: 'insensitive' },
      });
    });

    it('does not duplicate the slug clause when the term is already slug-shaped', async () => {
      primeList();
      await service.adminListProducts({ search: 'sidr-honey' });
      const clauses = mockPrisma.product.findMany.mock.calls[0][0].where.OR;
      expect(clauses.filter((c: Record<string, unknown>) => 'slug' in c)).toHaveLength(1);
    });

    it('omits the OR when search is missing or blank', async () => {
      primeList();
      await service.adminListProducts({});
      expect(mockPrisma.product.findMany.mock.calls[0][0].where).not.toHaveProperty('OR');

      mockPrisma.product.count.mockResolvedValueOnce(0);
      mockPrisma.product.findMany.mockResolvedValueOnce([]);
      await service.adminListProducts({ search: '   ' });
      expect(mockPrisma.product.findMany.mock.calls[1][0].where).not.toHaveProperty('OR');
    });
  });
});

/**
 * Finding C11, absorbing the prior pass's C5 (plan L Phase L5).
 *
 * The catalogue rail derived its brand list from the products currently loaded,
 * which is a page-1 sample of the filtered result. Pick a brand and the sample
 * contains one brand, so the facet collapsed to the selection and the shopper
 * could not switch without clearing. Brands come from the whole ACTIVE
 * catalogue now, the same way spec facets already did.
 */
describe('ProductsService.listBrandFacets', () => {
  let service: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PRODUCTS_REDIS_CLIENT, useValue: mockRedis },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: InventoryService, useValue: mockInventory },
        { provide: CategoriesService, useValue: mockCategories },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  it('groups brands over the whole ACTIVE, non-deleted catalogue', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { brand: 'Nike' },
      { brand: 'Nike' },
      { brand: 'H&M' },
    ]);
    const facets = (await service.listBrandFacets()) as { brand: string; count: number }[];
    expect(facets).toEqual([
      { brand: 'Nike', count: 2 },
      { brand: 'H&M', count: 1 },
    ]);
    const args = mockPrisma.product.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({ status: ProductStatus.ACTIVE, deletedAt: null });
  });

  it('scopes to a category when one is given', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ brand: 'Nike' }]);
    await service.listBrandFacets('cat-1');
    const args = mockPrisma.product.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where['categories']).toEqual({ some: { categoryId: 'cat-1' } });
  });

  it('leaves the category filter off when none is given', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ brand: 'Nike' }]);
    await service.listBrandFacets();
    const args = mockPrisma.product.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).not.toHaveProperty('categories');
  });

  it('drops products with no brand rather than emitting a blank facet', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { brand: null },
      { brand: '   ' },
      { brand: 'Nike' },
    ]);
    const facets = (await service.listBrandFacets()) as { brand: string; count: number }[];
    expect(facets).toEqual([{ brand: 'Nike', count: 1 }]);
  });

  it('breaks a count tie on the brand name', async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { brand: 'Zephyr' },
      { brand: 'Acme' },
      { brand: 'Mid' },
    ]);
    const facets = (await service.listBrandFacets()) as { brand: string }[];
    expect(facets.map((f) => f.brand)).toEqual(['Acme', 'Mid', 'Zephyr']);
  });

  it('serves a cached payload without querying', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify([{ brand: 'Cached', count: 3 }]));
    const facets = await service.listBrandFacets();
    expect(facets).toEqual([{ brand: 'Cached', count: 3 }]);
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
  });

  it('caches per category, so one scope cannot serve another', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ brand: 'Nike' }]);
    await service.listBrandFacets('cat-1');
    await service.listBrandFacets('cat-2');
    const keys = mockRedis.set.mock.calls.map((call) => call[0] as string);
    expect(new Set(keys).size).toBe(2);
  });
});
