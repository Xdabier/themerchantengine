import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PromotionsService } from '../promotions/promotions.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { ShippingService } from '../shipping/shipping.service';
import { TaxService } from '../tax/tax.service';
import { WishlistService } from '../wishlist/wishlist.service';
import { CartService } from './cart.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function dec(n: number) {
  return { toNumber: () => n } as unknown as Prisma.Decimal;
}

function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'variant-1',
    productId: 'product-1',
    price: dec(100),
    compareAtPrice: null,
    weight: null,
    isActive: true,
    deletedAt: null,
    product: {
      id: 'product-1',
      name: { default: 'Widget', en: 'Widget', fr: 'Bidule' },
      slug: 'widget',
      deletedAt: null,
      assets: [],
      categories: [{ categoryId: 'cat-1' }],
    },
    attributeValues: [],
    ...overrides,
  };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    cartId: 'cart-1',
    variantId: 'variant-1',
    quantity: 2,
    productName: 'Widget',
    variantLabel: null,
    productSlug: 'widget',
    unitPrice: dec(100),
    compareAtPrice: null,
    inStock: true,
    stockAvailable: 10,
    thumbnailUrl: null,
    weight: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    variant: makeVariant(),
    ...overrides,
  };
}

function makeCart(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cart-1',
    userId: 'user-1',
    sessionId: null,
    couponCode: null,
    subtotal: dec(0),
    discountAmount: dec(0),
    total: dec(0),
    shippingEstimate: null,
    taxEstimate: null,
    crossSellProductIds: [],
    abandonedAt: null,
    recoveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    items: [],
    ...overrides,
  };
}

function makePrisma() {
  return {
    cart: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    cartItem: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function makeInventory() {
  return { checkAvailability: jest.fn() };
}

function makePromotions() {
  return {
    getApplicableAutomatic: jest.fn(),
    getFreeShippingProgress: jest.fn(),
    validateCoupon: jest.fn(),
  };
}

function makeGiftCards() {
  return { checkBalance: jest.fn() };
}

function makeShipping() {
  return {
    calculateRates: jest.fn(),
    // Mirror the real flag-based resolution so cart tests exercise a faithful
    // contract (default-first, fallback to the first rate, null when empty).
    resolveDefaultRate: jest.fn(
      (rates: { isDefault?: boolean }[]) => rates.find((r) => r.isDefault) ?? rates[0] ?? null,
    ),
    getStoreDefaultRate: jest.fn().mockResolvedValue(null),
  };
}

function makeTax() {
  return { calculateTax: jest.fn() };
}

function makeWishlist() {
  return { addItem: jest.fn() };
}

function makeEvents() {
  return { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
}

const FREE_SHIPPING_NONE = {
  threshold: null,
  remaining: null,
  qualified: false,
  message: {},
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CartService', () => {
  let service: CartService;
  let prisma: ReturnType<typeof makePrisma>;
  let inventory: ReturnType<typeof makeInventory>;
  let promotions: ReturnType<typeof makePromotions>;
  let giftCardsService: ReturnType<typeof makeGiftCards>;
  let shippingService: ReturnType<typeof makeShipping>;
  let taxService: ReturnType<typeof makeTax>;
  let wishlistService: ReturnType<typeof makeWishlist>;
  let events: ReturnType<typeof makeEvents>;

  beforeEach(async () => {
    prisma = makePrisma();
    inventory = makeInventory();
    promotions = makePromotions();
    giftCardsService = makeGiftCards();
    shippingService = makeShipping();
    taxService = makeTax();
    wishlistService = makeWishlist();
    events = makeEvents();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventory },
        { provide: PromotionsService, useValue: promotions },
        { provide: GiftCardsService, useValue: giftCardsService },
        { provide: ShippingService, useValue: shippingService },
        { provide: TaxService, useValue: taxService },
        { provide: WishlistService, useValue: wishlistService },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = module.get(CartService);
  });

  // ── getCart ───────────────────────────────────────────────────────────────

  describe('getCart', () => {
    it('returns an empty cart response when no cart exists', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      const result = await service.getCart('user-1');

      expect(result.items).toHaveLength(0);
      expect(result.subtotal).toBe(0);
      expect(result.total).toBe(0);
      expect(result.couponCode).toBeNull();
    });

    it('computes subtotal from live variant price × quantity', async () => {
      const item = makeItem({ quantity: 2, variant: makeVariant({ price: dec(50) }) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.subtotal).toBe(100); // 2 × 50
      expect(result.items[0].lineTotal).toBe(100);
    });

    it('includes automatic discounts in discounts array', async () => {
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(200) }) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 10, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([
        {
          promotionId: 'promo-1',
          type: 'PERCENTAGE',
          discountAmount: 20,
          label: 'Sale',
          priority: 0,
        },
      ]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.discounts).toHaveLength(1);
      expect(result.discounts[0].type).toBe('automatic');
      expect(result.discounts[0].amount).toBe(20);
      expect(result.total).toBe(180);
    });

    it('zeroes the shipping estimate when a FREE_SHIPPING promotion applies', async () => {
      // `calculateDiscount` returns 0 for FREE_SHIPPING with the comment
      // "signal only; shipping discount applied at checkout", and no path ever
      // honoured the signal. The cart showed the promotion qualified, listed a
      // zero-amount discount row, and still added the full shipping estimate.
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(400) }) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([
        {
          promotionId: 'promo-freeship',
          type: 'FREE_SHIPPING',
          discountAmount: 0,
          label: { default: 'Free shipping over 300 LYD' },
          priority: 5,
        },
      ]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);
      shippingService.getStoreDefaultRate.mockResolvedValue({
        methodId: 'm-def',
        name: { default: 'Standard Delivery' },
        price: 10,
        isDefault: true,
        estimatedDaysMin: 1,
        estimatedDaysMax: 3,
      });

      const result = await service.getCart('user-1');

      expect(result.shippingEstimate).toBe(0);
      expect(result.grandTotal).toBe(400);
      // The method is still resolved: the shopper gets the delivery, free.
      expect(result.shippingMethodName).toEqual({ default: 'Standard Delivery' });
    });

    it('zeroes a persisted address-specific estimate too when free shipping applies', async () => {
      // The zeroing keys off the applicable-automatic list, so it has to cover
      // the cached-estimate source as well as the store default.
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(400) }) });
      prisma.cart.findFirst.mockResolvedValue(
        makeCart({ items: [item], shippingEstimate: dec(25) }),
      );
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([
        {
          promotionId: 'promo-freeship',
          type: 'FREE_SHIPPING',
          discountAmount: 0,
          label: { default: 'Free shipping over 300 LYD' },
          priority: 5,
        },
      ]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.shippingEstimate).toBe(0);
      expect(result.grandTotal).toBe(400);
    });

    it('emits the product and category the promotions engine needs per line', async () => {
      // Order creation built its promo items with empty ids, so any promotion
      // restricted to certain products or categories applied on the cart and
      // silently evaporated at order create. Both sides now read the same
      // emitted line, so they cannot diverge.
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(100) }) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.items[0].productId).toBe(item.variant.productId);
      expect(result.items[0].categoryId).toBe(
        item.variant.product.categories[0]?.categoryId ?? null,
      );
    });

    it('emits the live product name so the locale interceptor can resolve it', async () => {
      // `addItem` snapshots the name once, as `name.default`, and `getCart`
      // returned that snapshot verbatim. On this catalogue the default value is
      // the French string, so a cart opened under /en showed French line names
      // for a product whose English name the API already had in hand.
      const item = makeItem({
        productName: 'Bidule',
        variant: makeVariant({
          product: {
            id: 'product-1',
            name: { default: 'Bidule', en: 'Widget', fr: 'Bidule' },
            slug: 'widget',
            deletedAt: null,
            assets: [],
            categories: [{ categoryId: 'cat-1' }],
          },
        }),
      });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.items[0].productName).toEqual({
        default: 'Bidule',
        en: 'Widget',
        fr: 'Bidule',
      });
    });

    it('falls back to the add-time snapshot when the product is gone', async () => {
      // The snapshot is what an order keeps, and it is the only name left once
      // the product is archived. A line must still say what was bought.
      const item = makeItem({
        productName: 'Discontinued Widget',
        variant: makeVariant({
          product: {
            id: 'product-1',
            name: null,
            slug: 'widget',
            deletedAt: new Date(),
            assets: [],
            categories: [],
          },
        }),
      });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.items[0].productName).toBe('Discontinued Widget');
    });

    it('includes the store default shipping in grandTotal and surfaces the method name', async () => {
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(100) }) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);
      shippingService.getStoreDefaultRate.mockResolvedValue({
        methodId: 'm-def',
        name: { default: 'Standard Delivery' },
        price: 10,
        isDefault: true,
        estimatedDaysMin: 1,
        estimatedDaysMax: 3,
      });

      const result = await service.getCart('user-1');

      expect(result.total).toBe(100);
      expect(result.shippingEstimate).toBe(10);
      expect(result.grandTotal).toBe(110);
      expect(result.shippingMethodName).toEqual({ default: 'Standard Delivery' });
    });

    it('grandTotal equals total when no store default shipping is resolvable', async () => {
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(100) }) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);
      shippingService.getStoreDefaultRate.mockResolvedValue(null);

      const result = await service.getCart('user-1');

      expect(result.grandTotal).toBe(result.total);
      expect(result.shippingMethodName).toBeNull();
    });

    it('composes grandTotalTtc from grandTotal plus the stored tax estimate', async () => {
      // The TTC figure the checkout summary binds its headline row to.
      // `grandTotal` deliberately EXCLUDES tax, so the cart can quote HT; if
      // the checkout bound to it instead, a 19 per cent store would under-quote
      // the charge by the whole VAT.
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(100) }) });
      prisma.cart.findFirst.mockResolvedValue(
        makeCart({ items: [item], taxEstimate: dec(19), shippingEstimate: dec(8) }),
      );
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);
      shippingService.getStoreDefaultRate.mockResolvedValue(null);

      const result = await service.getCart('user-1');

      expect(result.taxEstimate).toBe(19);
      expect(result.grandTotal).toBe(108);
      expect(result.grandTotalTtc).toBe(127);
      // The two must differ by exactly the VAT, or one of them is lying.
      expect(result.grandTotalTtc - result.grandTotal).toBe(result.taxEstimate);
    });

    it('grandTotalTtc equals grandTotal before a tax zone has resolved', async () => {
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(100) }) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);
      shippingService.getStoreDefaultRate.mockResolvedValue(null);

      const result = await service.getCart('user-1');

      expect(result.taxEstimate).toBeNull();
      expect(result.grandTotalTtc).toBe(result.grandTotal);
    });

    it('total is clamped to zero when discounts exceed subtotal', async () => {
      const item = makeItem({ quantity: 1, variant: makeVariant({ price: dec(10) }) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([
        { promotionId: 'p-1', type: 'FIXED_AMOUNT', discountAmount: 50, label: {}, priority: 0 },
      ]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.total).toBe(0);
    });

    it('counts itemCount as sum of all item quantities', async () => {
      const item1 = makeItem({ id: 'i1', variantId: 'v1', quantity: 2 });
      const item2 = makeItem({ id: 'i2', variantId: 'v2', quantity: 3 });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item1, item2] }));
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.itemCount).toBe(5);
    });

    it('reports live stock from InventoryService', async () => {
      const item = makeItem({ quantity: 1 });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      inventory.checkAvailability.mockResolvedValue({ available: 3, locations: [] });
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      const result = await service.getCart('user-1');

      expect(result.items[0].stockAvailable).toBe(3);
      expect(result.items[0].inStock).toBe(true);
    });
  });

  // ── addItem ───────────────────────────────────────────────────────────────

  describe('addItem', () => {
    function setupAdd() {
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant());
      inventory.checkAvailability.mockResolvedValue({ available: 10, locations: [] });
      // isNew check → null, getOrCreate check → existing, getCart → full cart
      prisma.cart.findFirst
        .mockResolvedValueOnce(null) // isNew check
        .mockResolvedValueOnce({ id: 'cart-1' }) // getOrCreate
        .mockResolvedValue(makeCart({ items: [makeItem()] }));
      prisma.cart.create.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.findUnique.mockResolvedValue(null);
      prisma.cartItem.create.mockResolvedValue(makeItem());
      prisma.cart.update.mockResolvedValue(makeCart());
      prisma.cartItem.findMany.mockResolvedValue([makeItem()]);
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);
    }

    it('creates a CartItem for a new variant', async () => {
      setupAdd();
      await service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1');
      expect(prisma.cartItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ variantId: 'variant-1', quantity: 1 }),
        }),
      );
    });

    it('increments quantity when variant already exists in cart', async () => {
      setupAdd();
      prisma.cartItem.findUnique.mockResolvedValue(makeItem({ quantity: 2 }));
      prisma.cartItem.update.mockResolvedValue(makeItem({ quantity: 3 }));

      await service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1');

      expect(prisma.cartItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { quantity: { increment: 1 } } }),
      );
    });

    it('throws NotFoundException for inactive variant', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant({ isActive: false }));
      await expect(
        service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted variant', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant({ deletedAt: new Date() }));
      await expect(
        service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when stock is insufficient', async () => {
      // The stock check now reads the existing line (if any) before deciding,
      // so it needs the same cart/cartItem lookups every other `addItem` case
      // mocks via `setupAdd()`, not just the variant and the availability call.
      setupAdd();
      inventory.checkAvailability.mockResolvedValue({ available: 2, locations: [] });

      await expect(
        service.addItem({ variantId: 'variant-1', quantity: 5 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when an existing line plus the new quantity exceeds stock', async () => {
      // The regression this guards: two adds that are each individually under
      // stock (3 + 3 against 5 available) must still be refused on the second
      // one, because together they oversell the variant.
      setupAdd();
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      prisma.cartItem.findUnique.mockResolvedValue(makeItem({ quantity: 3 }));

      await expect(
        service.addItem({ variantId: 'variant-1', quantity: 3 }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('emits cart.created for a brand-new cart', async () => {
      setupAdd();
      await service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1');
      expect(events.emit).toHaveBeenCalledWith('cart.created', expect.any(Object));
    });

    // ── variantLabel snapshot (finding AD2) ─────────────────────────────────
    //
    // `CartItem.variantLabel` is a plain text column, so the global
    // Translatable interceptor never touches it. The label has to be resolved
    // at write time. Joining `attributeValue.value` straight into a string
    // wrote "[object Object]" for every variant that carries attribute values,
    // and every `AttributeValue.value` row in this store is a Translatable
    // object, so the bug fired on every such add-to-cart.

    function setupAddWithAttributes() {
      setupAdd();
      prisma.productVariant.findUnique.mockResolvedValue(
        makeVariant({
          attributeValues: [
            { attributeValue: { value: { default: 'Métal', fr: 'Métal', en: 'Metal' } } },
            { attributeValue: { value: { default: 'Grand', fr: 'Grand', en: 'Large' } } },
          ],
        }),
      );
    }

    function createdVariantLabel() {
      const call = prisma.cartItem.create.mock.calls.at(-1)?.[0] as {
        data: { variantLabel: string | null };
      };
      return call.data.variantLabel;
    }

    it('snapshots the variant label as resolved text under the requested locale', async () => {
      setupAddWithAttributes();

      await service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1', undefined, 'en');

      expect(createdVariantLabel()).toBe('Metal, Large');
    });

    it('snapshots the variant label in French for a French shopper', async () => {
      setupAddWithAttributes();

      await service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1', undefined, 'fr');

      expect(createdVariantLabel()).toBe('Métal, Grand');
    });

    it('snapshots the default rung when the request states no locale', async () => {
      setupAddWithAttributes();

      await service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1');

      expect(createdVariantLabel()).toBe('Métal, Grand');
    });

    it('leaves the variant label null when the variant carries no attribute values', async () => {
      setupAdd();

      await service.addItem({ variantId: 'variant-1', quantity: 1 }, 'user-1', undefined, 'en');

      expect(createdVariantLabel()).toBeNull();
    });
  });

  // ── mergeAnonymousCart ────────────────────────────────────────────────────

  describe('mergeAnonymousCart', () => {
    it('uses Serializable isolation level', async () => {
      prisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<void>, opts: unknown) => {
          await fn({
            cart: {
              findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
              update: jest.fn(),
            },
            cartItem: { createMany: jest.fn() },
          });
          return opts;
        },
      );
      prisma.cart.findUnique.mockResolvedValue(null);

      await service.mergeAnonymousCart('user-1', 'sess-abc');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });

    /**
     * Serializable is not a promise that a transaction succeeds. It is a
     * promise that if it succeeds, it was equivalent to some serial order —
     * and Postgres enforces that by ABORTING one side of a conflict with
     * `40001`, which Prisma surfaces as `P2034`. Retrying is the application's
     * job, and until this merge had a caller nothing ever exercised it.
     *
     * The real trigger is mundane: the storefront shell boot fires the merge
     * while the SSR render and the badge hydration are reading the same cart
     * rows. That produced a 500 on roughly one sign-in in twelve, and the
     * customer whose request lost the coin toss lost their basket.
     */
    function serializationFailure(): Error & { code: string } {
      const err = new Error(
        'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
      ) as Error & { code: string };
      err.code = 'P2034';
      return err;
    }

    /**
     * The SECOND shape the same conflict arrives in, and the one that made the
     * first version of this retry useless.
     *
     * A conflict detected mid-statement surfaces through Prisma as `P2034`. A
     * conflict detected at COMMIT surfaces from the pg driver adapter as a
     * `DriverAdapterError` reading `TransactionWriteConflict`, with no
     * `code` at all. Matching only `P2034` retried the first and let the second
     * straight through to a 500.
     */
    function driverWriteConflict(): Error {
      const err = new Error('TransactionWriteConflict');
      err.name = 'DriverAdapterError';
      return err;
    }

    it('retries the commit-time conflict the driver adapter raises without a code', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);
      prisma.$transaction
        .mockRejectedValueOnce(driverWriteConflict())
        .mockResolvedValueOnce(undefined);

      await expect(service.mergeAnonymousCart('user-1', 'sess-abc')).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('retries a deadlock reported by SQLSTATE', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);
      const deadlock = new Error('deadlock detected') as Error & { code: string };
      deadlock.code = '40P01';
      prisma.$transaction.mockRejectedValueOnce(deadlock).mockResolvedValueOnce(undefined);

      await expect(service.mergeAnonymousCart('user-1', 'sess-abc')).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('retries a write conflict instead of failing the sign-in', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);
      prisma.$transaction
        .mockRejectedValueOnce(serializationFailure())
        .mockResolvedValueOnce(undefined);

      await expect(service.mergeAnonymousCart('user-1', 'sess-abc')).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('gives up after a bounded number of write conflicts rather than looping', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(serializationFailure());

      await expect(service.mergeAnonymousCart('user-1', 'sess-abc')).rejects.toMatchObject({
        code: 'P2034',
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('does not retry an error that is not a write conflict', async () => {
      // A genuine bug must surface on the first attempt, not be replayed twice
      // and then reported as a conflict.
      prisma.cart.findUnique.mockResolvedValue(null);
      const boom = new Error('column does not exist');
      prisma.$transaction.mockRejectedValue(boom);

      await expect(service.mergeAnonymousCart('user-1', 'sess-abc')).rejects.toThrow(
        'column does not exist',
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('announces the merge so a guest order placed in that session can be claimed', async () => {
      // The endpoint clears the `sessionId` cookie right after this, and that
      // cookie is the only key to any order the guest just placed. Awaited
      // rather than fired and forgotten, so the claim lands before the key is
      // thrown away.
      prisma.cart.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockResolvedValue(undefined);

      await service.mergeAnonymousCart('user-1', 'sess-abc');

      expect(events.emitAsync).toHaveBeenCalledWith('cart.merged', {
        userId: 'user-1',
        sessionId: 'sess-abc',
      });
    });

    it('carries a guest gift card and coupon onto an existing user cart', async () => {
      // Only items used to move. A shopper who applied a gift card as a guest
      // and then signed in with an existing basket lost it with no message.
      const updateFn = jest.fn().mockResolvedValue({});
      const userCart = makeCart({
        id: 'user-cart',
        giftCardCode: null,
        couponCode: null,
        items: [],
      });
      const anonCart = makeCart({
        id: 'anon-cart',
        userId: null,
        sessionId: 'sess-abc',
        giftCardCode: 'GUESTCARD0000001',
        couponCode: 'GUESTPROMO',
        items: [makeItem({ cartId: 'anon-cart' })],
      });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          cart: {
            findUnique: jest.fn().mockResolvedValueOnce(userCart).mockResolvedValueOnce(anonCart),
            update: updateFn,
          },
          cartItem: { createMany: jest.fn() },
        }),
      );

      await service.mergeAnonymousCart('user-1', 'sess-abc');

      expect(updateFn).toHaveBeenCalledWith({
        where: { id: 'user-cart' },
        data: { giftCardCode: 'GUESTCARD0000001', couponCode: 'GUESTPROMO' },
      });
    });

    it('leaves the user their own codes when they already have some', async () => {
      // Same rule the items follow one line above: what the signed-in shopper
      // already chose wins over what the guest session carried.
      const updateFn = jest.fn().mockResolvedValue({});
      const userCart = makeCart({
        id: 'user-cart',
        giftCardCode: 'MINE000000000001',
        couponCode: 'MINEPROMO',
        items: [],
      });
      const anonCart = makeCart({
        id: 'anon-cart',
        userId: null,
        sessionId: 'sess-abc',
        giftCardCode: 'GUESTCARD0000001',
        couponCode: 'GUESTPROMO',
        items: [makeItem({ cartId: 'anon-cart' })],
      });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          cart: {
            findUnique: jest.fn().mockResolvedValueOnce(userCart).mockResolvedValueOnce(anonCart),
            update: updateFn,
          },
          cartItem: { createMany: jest.fn() },
        }),
      );

      await service.mergeAnonymousCart('user-1', 'sess-abc');

      // The only update is the soft-delete of the anonymous cart.
      expect(updateFn).toHaveBeenCalledTimes(1);
      expect(updateFn).toHaveBeenCalledWith({
        where: { id: 'anon-cart' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('claims the anonymous cart when user has no cart', async () => {
      const updateFn = jest.fn().mockResolvedValue({});
      const anonCart = makeCart({
        id: 'anon-cart',
        userId: null,
        sessionId: 'sess-abc',
        items: [makeItem({ cartId: 'anon-cart' })],
      });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          cart: {
            findUnique: jest
              .fn()
              .mockResolvedValueOnce(null) // user cart → none
              .mockResolvedValueOnce(anonCart), // anon cart
            update: updateFn,
          },
          cartItem: { createMany: jest.fn() },
        }),
      );
      prisma.cart.findUnique.mockResolvedValue(null);

      await service.mergeAnonymousCart('user-1', 'sess-abc');

      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', sessionId: null }),
        }),
      );
    });

    it('adds only non-conflicting items to the user cart', async () => {
      const conflictItem = makeItem({ id: 'ci', variantId: 'variant-1', cartId: 'anon-cart' });
      const newItem = makeItem({ id: 'ni', variantId: 'variant-2', cartId: 'anon-cart' });
      const userCart = makeCart({
        id: 'user-cart',
        userId: 'user-1',
        items: [makeItem({ variantId: 'variant-1' })],
      });
      const anonCart = makeCart({
        id: 'anon-cart',
        userId: null,
        sessionId: 'sess-abc',
        items: [conflictItem, newItem],
      });

      const createMany = jest.fn().mockResolvedValue({ count: 1 });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          cart: {
            findUnique: jest.fn().mockResolvedValueOnce(userCart).mockResolvedValueOnce(anonCart),
            update: jest.fn().mockResolvedValue({}),
          },
          cartItem: { createMany },
        }),
      );
      prisma.cart.findUnique.mockResolvedValue({ id: 'user-cart' });
      prisma.cartItem.findMany.mockResolvedValue([makeItem({ variantId: 'variant-1' })]);
      promotions.getApplicableAutomatic.mockResolvedValue([]);

      await service.mergeAnonymousCart('user-1', 'sess-abc');

      const addedData = createMany.mock.calls[0][0].data as { variantId: string }[];
      expect(addedData.some((d) => d.variantId === 'variant-2')).toBe(true);
      expect(addedData.some((d) => d.variantId === 'variant-1')).toBe(false);
    });

    it('soft-deletes the anonymous cart after merge', async () => {
      const updateFn = jest.fn().mockResolvedValue({});
      const anonCart = makeCart({
        id: 'anon-cart',
        userId: null,
        sessionId: 'sess-abc',
        items: [makeItem()],
      });
      const userCart = makeCart({ id: 'user-cart', userId: 'user-1', items: [] });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          cart: {
            findUnique: jest.fn().mockResolvedValueOnce(userCart).mockResolvedValueOnce(anonCart),
            update: updateFn,
          },
          cartItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        }),
      );
      prisma.cart.findUnique.mockResolvedValue({ id: 'user-cart' });
      prisma.cartItem.findMany.mockResolvedValue([]);
      promotions.getApplicableAutomatic.mockResolvedValue([]);

      await service.mergeAnonymousCart('user-1', 'sess-abc');

      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'anon-cart' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  // ── applyCoupon ───────────────────────────────────────────────────────────

  describe('gift card on the cart', () => {
    /**
     * The apply used to validate and return `{ currentBalance, currency,
     * expiresAt }` while persisting nothing. The storefront parsed that as a
     * full cart, so every valid card threw a schema error the page rendered as
     * "this gift card is not valid", and the checkout payload read
     * `cart.giftCard?.code`, a field the backend never emitted. The tender was
     * unreachable end to end. These cases pin the shape that fixes it.
     */
    function basket(cartOverrides: Record<string, unknown> = {}) {
      const item = makeItem({
        quantity: 1,
        unitPrice: dec(200),
        variant: makeVariant({ price: dec(200) }),
      });
      prisma.cartItem.findMany.mockResolvedValue([item]);
      prisma.cart.update.mockResolvedValue(makeCart());
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
      return { item, cart: makeCart({ id: 'cart-1', items: [item], ...cartOverrides }) };
    }

    /** Apply path: requireCartWithItems reads first, then getCart re-reads. */
    function setupCart(cartOverrides: Record<string, unknown> = {}) {
      const { item, cart } = basket();
      prisma.cart.findFirst
        .mockResolvedValueOnce(cart)
        .mockResolvedValue(makeCart({ items: [item], ...cartOverrides }));
    }

    /** Read path: getCart is the only reader, so every call sees the same row. */
    function setupStoredCart(cartOverrides: Record<string, unknown> = {}) {
      const { cart } = basket(cartOverrides);
      prisma.cart.findFirst.mockResolvedValue(cart);
    }

    it('persists the code and answers with the cart, not a balance envelope', async () => {
      setupCart({ giftCardCode: 'GIFT000000000001' });
      giftCardsService.checkBalance.mockResolvedValue({
        currentBalance: 50,
        currency: 'LYD',
        expiresAt: null,
      });

      const result = await service.applyGiftCard('GIFT000000000001', 'user-1');

      expect(prisma.cart.update).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
        data: { giftCardCode: 'GIFT000000000001' },
      });
      // The shape the storefront's cartSchema requires. A validation envelope
      // has neither of these and is what made every valid card read invalid.
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total');
      expect(result.giftCard).toEqual({ code: 'GIFT000000000001', balanceApplied: 50 });
    });

    it('writes nothing when the card does not validate', async () => {
      setupCart();
      giftCardsService.checkBalance.mockRejectedValue(new BadRequestException('nope'));

      await expect(service.applyGiftCard('GIFT000000000002', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.cart.update).not.toHaveBeenCalled();
    });

    it('caps the applied amount at what the cart can consume', async () => {
      // A 500 balance against a 200 cart must report 200, not 500: the figure
      // the cart shows has to be the figure the order deducts, and
      // OrdersService caps against the same base.
      setupStoredCart({ giftCardCode: 'GIFT000000000003' });
      giftCardsService.checkBalance.mockResolvedValue({
        currentBalance: 500,
        currency: 'LYD',
        expiresAt: null,
      });

      const cart = await service.getCart('user-1');

      expect(cart.grandTotalTtc).toBe(200);
      expect(cart.giftCard).toEqual({ code: 'GIFT000000000003', balanceApplied: 200 });
    });

    it('reports no card when the stored one has since died', async () => {
      // Expired, emptied by another order, or deactivated by an admin between
      // the apply and this load. The column is read back through checkBalance
      // every time rather than trusted.
      setupStoredCart({ giftCardCode: 'GIFT000000000004' });
      giftCardsService.checkBalance.mockRejectedValue(new BadRequestException('expired'));

      const cart = await service.getCart('user-1');

      expect(cart.giftCard).toBeNull();
    });

    it('clears the code on remove', async () => {
      prisma.cart.findFirst.mockResolvedValue({ id: 'cart-1' });
      prisma.cart.update.mockResolvedValue(makeCart());

      await service.removeGiftCard('user-1');

      expect(prisma.cart.update).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
        data: { giftCardCode: null },
      });
      expect(events.emit).toHaveBeenCalledWith('cart.updated', expect.any(Object));
    });

    it('is a no-op on remove when the customer has no cart', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      await service.removeGiftCard('user-1');

      expect(prisma.cart.update).not.toHaveBeenCalled();
    });
  });

  describe('applyCoupon', () => {
    function setupCoupon() {
      // unitPrice snapshot and live variant price both at 200 so subtotal = 200
      const item = makeItem({
        quantity: 1,
        unitPrice: dec(200),
        variant: makeVariant({ price: dec(200) }),
      });
      const cart = makeCart({ id: 'cart-1', items: [item] });
      prisma.cart.findFirst
        .mockResolvedValueOnce(cart) // requireCartWithItems
        .mockResolvedValue(makeCart({ couponCode: 'SAVE20', items: [item] }));
      prisma.cartItem.findMany.mockResolvedValue([item]);
      prisma.cart.update.mockResolvedValue(makeCart());
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);
      inventory.checkAvailability.mockResolvedValue({ available: 5, locations: [] });
    }

    it('calls validateCoupon with correct subtotal and items', async () => {
      setupCoupon();
      promotions.validateCoupon.mockResolvedValue({
        promotionId: 'promo-1',
        code: 'SAVE20',
        type: 'FIXED_AMOUNT',
        discountAmount: 20,
        label: 'Save $20',
      });

      await service.applyCoupon('SAVE20', 'user-1');

      expect(promotions.validateCoupon).toHaveBeenCalledWith(
        'SAVE20',
        200,
        expect.any(Array),
        'user-1',
      );
    });

    it('clears the persisted estimates, since the coupon moved the tax base', async () => {
      // `applyCoupon` writes its own update rather than going through
      // `recalculateTotals`, so it needs the same clearing. A coupon lowers the
      // discounted goods total the VAT is charged on, and the estimate on the
      // row was quoted before it applied.
      setupCoupon();
      promotions.validateCoupon.mockResolvedValue({
        promotionId: 'p1',
        code: 'SAVE20',
        type: 'FIXED_AMOUNT',
        discountAmount: 20,
        label: {},
      });

      await service.applyCoupon('SAVE20', 'user-1');

      expect(prisma.cart.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shippingEstimate: null, taxEstimate: null }),
        }),
      );
    });

    it('persists couponCode and discountAmount to cart', async () => {
      setupCoupon();
      promotions.validateCoupon.mockResolvedValue({
        promotionId: 'p1',
        code: 'SAVE20',
        type: 'FIXED_AMOUNT',
        discountAmount: 20,
        label: {},
      });

      await service.applyCoupon('SAVE20', 'user-1');

      expect(prisma.cart.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ couponCode: 'SAVE20', discountAmount: 20 }),
        }),
      );
    });
  });

  // ── clearCart ─────────────────────────────────────────────────────────────

  describe('clearCart', () => {
    // This method had no unit coverage at all before the estimate-clearing fix.
    it('zeroes the totals and drops the estimates quoted against the old basket', async () => {
      prisma.cart.findFirst.mockResolvedValue({ id: 'cart-1' });
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 2 });
      prisma.cart.update.mockResolvedValue(makeCart());

      await service.clearCart('user-1');

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 'cart-1' } });
      expect(prisma.cart.update).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
        data: {
          subtotal: 0,
          discountAmount: 0,
          // A gift card outlives the basket it was applied to unless this
          // clears it, and would be re-applied to the shopper's next order.
          giftCardCode: null,
          total: 0,
          couponCode: null,
          shippingEstimate: null,
          taxEstimate: null,
        },
      });
      expect(events.emit).toHaveBeenCalledWith('cart.updated', expect.any(Object));
    });

    it('is a no-op when the customer has no cart', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      await service.clearCart('user-1');

      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.cart.update).not.toHaveBeenCalled();
    });
  });

  // ── estimateShipping ──────────────────────────────────────────────────────

  describe('estimateShipping', () => {
    it('returns shipping rates and tax estimate', async () => {
      const item = makeItem({ quantity: 1, unitPrice: dec(100), weight: dec(0.5) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      shippingService.calculateRates.mockResolvedValue([
        {
          methodId: 'm1',
          name: { default: 'Standard' },
          price: 10,
          estimatedDaysMin: 3,
          estimatedDaysMax: 5,
        },
      ]);
      taxService.calculateTax.mockResolvedValue({ rate: 0.05, amount: 5, zone: null });
      prisma.cart.update.mockResolvedValue(makeCart());

      const result = await service.estimateShipping(
        { country: 'US', postalCode: '10001' },
        'user-1',
      );

      expect(result.rates).toHaveLength(1);
      expect(result.rates[0].price).toBe(10);
      expect(result.taxEstimate).toBe(5);
    });

    it('caches the default rate (not the cheapest) on the cart', async () => {
      const item = makeItem({ quantity: 1, unitPrice: dec(100), weight: dec(0.5) });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [item] }));
      shippingService.calculateRates.mockResolvedValue([
        {
          methodId: 'cheap',
          name: { default: 'Cheap' },
          price: 5,
          isDefault: false,
          estimatedDaysMin: null,
          estimatedDaysMax: null,
        },
        {
          methodId: 'std',
          name: { default: 'Standard' },
          price: 10,
          isDefault: true,
          estimatedDaysMin: null,
          estimatedDaysMax: null,
        },
      ]);
      taxService.calculateTax.mockResolvedValue({ rate: 0, amount: 0, zone: null });
      prisma.cart.update.mockResolvedValue(makeCart());

      await service.estimateShipping({ country: 'QA' }, 'user-1');

      expect(prisma.cart.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shippingEstimate: 10 }),
        }),
      );
    });

    it('returns empty rates and null taxEstimate for empty cart', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      const result = await service.estimateShipping({ country: 'US' }, 'user-1');

      expect(result.rates).toHaveLength(0);
      expect(result.taxEstimate).toBeNull();
    });
  });

  // ── removeItem ────────────────────────────────────────────────────────────

  describe('removeItem', () => {
    it('deletes the item and recalculates totals', async () => {
      const item = makeItem();
      prisma.cart.findFirst
        .mockResolvedValueOnce({ id: 'cart-1' }) // requireCart
        .mockResolvedValue(makeCart()); // final getCart
      prisma.cartItem.findFirst.mockResolvedValue(item); // requireItem
      prisma.cartItem.delete.mockResolvedValue(item);
      prisma.cart.update.mockResolvedValue(makeCart());
      prisma.cartItem.findMany.mockResolvedValue([]);
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      await service.removeItem('item-1', 'user-1');

      expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
      expect(events.emit).toHaveBeenCalledWith('cart.updated', expect.any(Object));
    });

    it('throws NotFoundException when item does not belong to cart', async () => {
      prisma.cart.findFirst.mockResolvedValue({ id: 'cart-1' }); // requireCart
      prisma.cartItem.findFirst.mockResolvedValue(null); // requireItem → not found

      await expect(service.removeItem('bad-id', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('clears the persisted shipping and tax estimates, which were quoted against the old basket', async () => {
      // `estimateShipping` persists both onto the cart row. `recalculateTotals`
      // then recomputed subtotal, discount and total and left those two
      // untouched, so a customer who estimated on a 1600 DT basket and then
      // removed an item kept the 304 DT of VAT quoted against the larger one:
      // `getCart` composes `grandTotalTtc` as `grandTotal + taxEstimate`, so
      // the checkout headline over-quoted the charge by the whole difference.
      //
      // Cleared rather than recomputed: the delivery country is not in scope
      // here, and the storefront re-runs the estimate when the address is
      // entered. Until it does, the total reads HT, which is true.
      const item = makeItem();
      prisma.cart.findFirst.mockResolvedValueOnce({ id: 'cart-1' }).mockResolvedValue(makeCart());
      prisma.cartItem.findFirst.mockResolvedValue(item);
      prisma.cartItem.delete.mockResolvedValue(item);
      prisma.cart.update.mockResolvedValue(makeCart());
      prisma.cartItem.findMany.mockResolvedValue([]);
      promotions.getApplicableAutomatic.mockResolvedValue([]);
      promotions.getFreeShippingProgress.mockResolvedValue(FREE_SHIPPING_NONE);

      await service.removeItem('item-1', 'user-1');

      expect(prisma.cart.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shippingEstimate: null, taxEstimate: null }),
        }),
      );
    });
  });
});
