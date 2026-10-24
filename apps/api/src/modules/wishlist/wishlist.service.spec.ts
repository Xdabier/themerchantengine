import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { WishlistService } from './wishlist.service';
import { WISHLIST_EVENTS } from './wishlist.constants';

// ── Factories ─────────────────────────────────────────────────────────────────

// Widths deliberately avoid the substring "80": the serializer-hardening test
// below asserts the stock count never reaches the wire by scanning the row for
// it, and an asset width would make that assertion pass for the wrong reason.
const CARD_URL = 'https://cdn.test/assets/widget/small.webp';

function makeArtefact(name: string, format: string, width: number) {
  return {
    url: `https://cdn.test/assets/widget/${name}.${format}`,
    storagePath: `assets/widget/${name}.${format}`,
    width,
    height: width,
    size: 1234,
  };
}

/** Full canonical variant set — `assetVariantsSchema` requires all four names. */
function makeVariantsJson() {
  const widths: Record<string, number> = { thumbnail: 160, small: 400, medium: 900, large: 1440 };
  return Object.fromEntries(
    Object.entries(widths).map(([name, width]) => [
      name,
      { webp: makeArtefact(name, 'webp', width), avif: makeArtefact(name, 'avif', width) },
    ]),
  );
}

function makeAssetJoin(overrides: Record<string, unknown> = {}) {
  return {
    assetId: 'asset-1',
    sortOrder: 0,
    isPrimary: true,
    asset: {
      id: 'asset-1',
      url: 'https://cdn.test/assets/widget/original.png',
      type: 'IMAGE',
      alt: { default: 'Widget Pro' },
      status: 'READY',
      variants: makeVariantsJson(),
    },
    ...overrides,
  };
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    slug: 'widget-pro',
    name: { default: 'Widget Pro' },
    assets: [],
    variants: [
      { id: 'variant-1', price: '99.99', isDefault: true, isActive: true },
      { id: 'variant-2', price: '89.99', isDefault: false, isActive: true },
    ],
    ...overrides,
  };
}

function makeWishlistItem(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    productId: 'product-1',
    // A fixed date: a live clock can serialize to ".800Z" and trip the stock-leak scan.
    createdAt: new Date('2026-01-15T12:34:56.123Z'),
    product: makeProduct(),
    ...overrides,
  };
}

function makePrisma() {
  return {
    product: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    wishlistItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

function makeInventory() {
  return { availabilityForVariants: jest.fn() };
}

function makeEvents() {
  return { emit: jest.fn() };
}

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('WishlistService', () => {
  let service: WishlistService;
  let prisma: ReturnType<typeof makePrisma>;
  let inventory: ReturnType<typeof makeInventory>;
  let events: ReturnType<typeof makeEvents>;

  beforeEach(async () => {
    prisma = makePrisma();
    inventory = makeInventory();
    events = makeEvents();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventory },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = module.get<WishlistService>(WishlistService);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // list
  // ═════════════════════════════════════════════════════════════════════════

  describe('list', () => {
    it('returns paginated wishlist items with enriched price and availability', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([makeWishlistItem()]);
      prisma.wishlistItem.count.mockResolvedValue(1);
      inventory.availabilityForVariants.mockResolvedValue(
        new Map([['variant-1', { stock: 80, availability: 'IN_STOCK' }]]),
      );

      const result = await service.list('user-1', { page: 1, pageSize: 20 });

      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
        }),
      );
      expect(result).toEqual({
        data: expect.arrayContaining([
          expect.objectContaining({
            productId: 'product-1',
            productSlug: 'widget-pro',
            price: '99.99',
            availability: 'IN_STOCK',
          }),
        ]),
        meta: { page: 1, pageSize: 20, total: 1 },
      });
    });

    it('degrades to OUT_OF_STOCK when grading fails, rather than failing the page', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([makeWishlistItem()]);
      prisma.wishlistItem.count.mockResolvedValue(1);
      inventory.availabilityForVariants.mockRejectedValue(new Error('Stock service down'));

      const result = await service.list('user-1', {});

      expect(result.data[0]).toMatchObject({ availability: 'OUT_OF_STOCK' });
    });

    // The catalogue and search endpoints withhold the count on purpose. The
    // wishlist is owner-scoped, but an account holder can wishlist the whole
    // catalogue, so a count here reads the same inventory position through a
    // side door (plan J, pass-2 finding W2).
    it('never puts the exact stock count on the wire', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([makeWishlistItem()]);
      prisma.wishlistItem.count.mockResolvedValue(1);
      inventory.availabilityForVariants.mockResolvedValue(
        new Map([['variant-1', { stock: 80, availability: 'IN_STOCK' }]]),
      );

      const result = await service.list('user-1', { page: 1, pageSize: 20 });

      const row = result.data[0] as Record<string, unknown>;
      expect(row).not.toHaveProperty('availableStock');
      expect(row).not.toHaveProperty('stock');
      expect(JSON.stringify(row)).not.toContain('80');
    });

    // One call for the whole page, through the same helper the products
    // endpoints use, so a card and its wishlist row cannot disagree.
    it('grades the page in one inventory call, not one per row', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        makeWishlistItem(),
        makeWishlistItem({ productId: 'product-2' }),
      ]);
      prisma.wishlistItem.count.mockResolvedValue(2);
      inventory.availabilityForVariants.mockResolvedValue(new Map());

      await service.list('user-1', {});

      expect(inventory.availabilityForVariants).toHaveBeenCalledTimes(1);
    });

    it('respects page and pageSize parameters', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);
      prisma.wishlistItem.count.mockResolvedValue(100);

      await service.list('user-1', { page: 2, pageSize: 50 });

      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 50 }),
      );
    });

    it('sorts by enriched price in memory; the DB query falls back to createdAt', async () => {
      // `price` is not a WishlistItem column — the DB query sorts by createdAt
      // and the enriched page is re-ordered by price afterwards.
      inventory.availabilityForVariants.mockResolvedValue(new Map());
      prisma.wishlistItem.findMany.mockResolvedValue([
        makeWishlistItem({
          productId: 'product-hi',
          product: makeProduct({
            id: 'product-hi',
            variants: [{ id: 'v-hi', price: '99.99', isDefault: true, isActive: true }],
          }),
        }),
        makeWishlistItem({
          productId: 'product-lo',
          product: makeProduct({
            id: 'product-lo',
            variants: [{ id: 'v-lo', price: '50.00', isDefault: true, isActive: true }],
          }),
        }),
      ]);
      prisma.wishlistItem.count.mockResolvedValue(2);

      const result = await service.list('user-1', { sortBy: 'price', sortOrder: 'asc' });

      // The DB query sorts by createdAt — `price` never reaches Prisma orderBy.
      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
      // The returned page is price-ascending.
      expect(result.data.map((i) => Number((i as { price: string }).price))).toEqual([50, 99.99]);
    });

    it('defaults to createdAt desc when sort not specified', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);
      prisma.wishlistItem.count.mockResolvedValue(0);

      await service.list('user-1', {});

      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // addItem
  // ═════════════════════════════════════════════════════════════════════════

  describe('addItem', () => {
    it('adds a product to wishlist', async () => {
      prisma.product.findUnique.mockResolvedValue(makeProduct());
      prisma.wishlistItem.upsert.mockResolvedValue(makeWishlistItem());

      const result = await service.addItem('user-1', 'product-1');

      expect(prisma.wishlistItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_productId: { userId: 'user-1', productId: 'product-1' } },
          create: { userId: 'user-1', productId: 'product-1' },
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(WISHLIST_EVENTS.ITEM_ADDED, expect.any(Object));
      expect(result).toEqual({ productId: 'product-1', productSlug: 'widget-pro' });
    });

    it('is idempotent: adding same item twice succeeds', async () => {
      prisma.product.findUnique.mockResolvedValue(makeProduct());
      prisma.wishlistItem.upsert.mockResolvedValue(makeWishlistItem());

      await service.addItem('user-1', 'product-1');
      await service.addItem('user-1', 'product-1');

      expect(prisma.wishlistItem.upsert).toHaveBeenCalledTimes(2);
      expect(events.emit).toHaveBeenCalledTimes(2);
    });

    it('throws WISHLIST_PRODUCT_NOT_FOUND when product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.addItem('user-1', 'bad-id')).rejects.toMatchObject({
        response: { error: { code: 'WISHLIST_PRODUCT_NOT_FOUND' } },
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // list — primary asset + variant id (plan E, phase E1)
  // ═════════════════════════════════════════════════════════════════════════

  describe('list — row read model', () => {
    it('emits the card-intent primary asset url and its srcset', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        makeWishlistItem({ product: makeProduct({ assets: [makeAssetJoin()] }) }),
      ]);
      prisma.wishlistItem.count.mockResolvedValue(1);
      inventory.availabilityForVariants.mockResolvedValue(new Map());

      const result = await service.list('user-1', {});

      const row = result.data[0] as { primaryAsset: Record<string, unknown> | null };
      expect(row.primaryAsset).toMatchObject({
        id: 'asset-1',
        assetId: 'asset-1',
        url: CARD_URL,
        type: 'IMAGE',
        isPrimary: true,
        sortOrder: 0,
      });
      expect(Array.isArray(row.primaryAsset?.['assetVariants'])).toBe(true);
      expect((row.primaryAsset?.['assetVariants'] as unknown[]).length).toBeGreaterThan(0);
    });

    it('selects only the primary asset, one row, joined with its variants payload', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);
      prisma.wishlistItem.count.mockResolvedValue(0);

      await service.list('user-1', {});

      const include = prisma.wishlistItem.findMany.mock.calls[0][0].include;
      expect(include.product.select.assets).toMatchObject({
        where: { isPrimary: true },
        take: 1,
      });
      expect(include.product.select.assets.select.asset.select).toMatchObject({
        id: true,
        url: true,
        type: true,
        alt: true,
        status: true,
        variants: true,
      });
    });

    it('emits primaryAsset null for a product with no assets', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([makeWishlistItem()]);
      prisma.wishlistItem.count.mockResolvedValue(1);
      inventory.availabilityForVariants.mockResolvedValue(new Map());

      const result = await service.list('user-1', {});

      expect(result.data[0]).toMatchObject({ primaryAsset: null });
    });

    // An asset still processing has no `small` variant yet. The row must render
    // the branded fallback rather than 500 the whole page.
    it('degrades primaryAsset to null when the asset cannot resolve a card url', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        makeWishlistItem({
          product: makeProduct({
            assets: [makeAssetJoin({ asset: { ...makeAssetJoin().asset, status: 'PROCESSING' } })],
          }),
        }),
      ]);
      prisma.wishlistItem.count.mockResolvedValue(1);
      inventory.availabilityForVariants.mockResolvedValue(new Map());

      const result = await service.list('user-1', {});

      expect(result.data[0]).toMatchObject({ primaryAsset: null });
    });

    it('emits the default active variant id so the row can add to cart', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([makeWishlistItem()]);
      prisma.wishlistItem.count.mockResolvedValue(1);
      inventory.availabilityForVariants.mockResolvedValue(new Map());

      const result = await service.list('user-1', {});

      expect(result.data[0]).toMatchObject({ variantId: 'variant-1' });
    });

    it('emits variantId and price null when the product has no purchasable variant', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        makeWishlistItem({ product: makeProduct({ variants: [] }) }),
      ]);
      prisma.wishlistItem.count.mockResolvedValue(1);
      inventory.availabilityForVariants.mockResolvedValue(new Map());

      const result = await service.list('user-1', {});

      expect(result.data[0]).toMatchObject({
        variantId: null,
        price: null,
        availability: 'OUT_OF_STOCK',
      });
    });

    // Mirrors `products.service.ts`: a soft-deleted or deactivated variant id
    // must never reach the wire, or add-to-cart posts an unbuyable variant.
    it('never selects an inactive or soft-deleted variant', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);
      prisma.wishlistItem.count.mockResolvedValue(0);

      await service.list('user-1', {});

      const include = prisma.wishlistItem.findMany.mock.calls[0][0].include;
      expect(include.product.select.variants.where).toEqual({ isActive: true, deletedAt: null });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // listIds — membership hydration source (plan E, phase E1)
  // ═════════════════════════════════════════════════════════════════════════

  describe('listIds', () => {
    it('returns only the caller productIds, newest first', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([
        { productId: 'product-2' },
        { productId: 'product-1' },
      ]);

      const result = await service.listIds('user-1');

      expect(result).toEqual({ productIds: ['product-2', 'product-1'] });
      expect(prisma.wishlistItem.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { productId: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
    });

    it('costs nothing beyond the id select: no product join, no inventory call', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);

      await service.listIds('user-1');

      const args = prisma.wishlistItem.findMany.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(inventory.availabilityForVariants).not.toHaveBeenCalled();
    });

    it('returns an empty list for a customer with no wishlist', async () => {
      prisma.wishlistItem.findMany.mockResolvedValue([]);

      expect(await service.listIds('user-1')).toEqual({ productIds: [] });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // removeItem
  // ═════════════════════════════════════════════════════════════════════════

  describe('removeItem', () => {
    it('removes a product from wishlist', async () => {
      prisma.product.findUnique.mockResolvedValue(makeProduct());
      prisma.wishlistItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeItem('user-1', 'product-1');

      expect(prisma.wishlistItem.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', productId: 'product-1' },
      });
      expect(events.emit).toHaveBeenCalledWith(WISHLIST_EVENTS.ITEM_REMOVED, expect.any(Object));
    });

    it('is idempotent: removing non-existent item succeeds', async () => {
      prisma.product.findUnique.mockResolvedValue(makeProduct());
      prisma.wishlistItem.deleteMany.mockResolvedValue({ count: 0 });

      await service.removeItem('user-1', 'product-1');

      expect(prisma.wishlistItem.deleteMany).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalled();
    });

    it('throws WISHLIST_PRODUCT_NOT_FOUND when product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.removeItem('user-1', 'bad-id')).rejects.toMatchObject({
        response: { error: { code: 'WISHLIST_PRODUCT_NOT_FOUND' } },
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // isInWishlist
  // ═════════════════════════════════════════════════════════════════════════

  describe('isInWishlist', () => {
    it('returns true when product is in wishlist', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue(makeWishlistItem());

      const result = await service.isInWishlist('user-1', 'product-1');

      expect(result).toBe(true);
    });

    it('returns false when product is not in wishlist', async () => {
      prisma.wishlistItem.findUnique.mockResolvedValue(null);

      const result = await service.isInWishlist('user-1', 'product-1');

      expect(result).toBe(false);
    });
  });
});
