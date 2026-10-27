import crypto from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  ADMIN,
  api,
  createTestPrisma,
  loginAs,
  shippingMethodForCountry,
  signUpCustomer,
  STORE_ADDRESS,
} from '../../../test/e2e/helpers';

/**
 * Free shipping, end to end, against the real database.
 *
 * `PromotionsService.calculateDiscount` returns 0 for a FREE_SHIPPING
 * promotion and calls it a signal, to be applied at checkout. Nothing applied
 * it. The cart advertised the promotion as qualified, listed a zero-amount
 * discount row and still added the full shipping estimate; order creation set
 * `shippingAmount = selected.price` unconditionally and never looked at the
 * automatic list at all.
 *
 * The suite drives the same cart twice, once with the promotion active and
 * once without, so the assertion is a difference between two real orders
 * rather than a single number that could be right by accident.
 */

const TEST_SUFFIX = '@e2e-free-shipping.test';
const TEST_PASSWORD = 'StrongPass1!';
const SKU_PREFIX = 'E2E-FRSHIP-';
const SLUG_PREFIX = 'e2e-free-shipping-';
const PROMO_ID = 'e2e-free-shipping-promo';
/** Comfortably above any seeded threshold, so the promotion is the only lever. */
const UNIT_PRICE = 500;

describe('Free shipping (e2e)', () => {
  let prisma: PrismaClient;
  let customerCookie: string;
  let adminCookie: string;
  let shippingMethodId: string;
  let variantId: string;

  async function cart(): Promise<Record<string, unknown>> {
    const res = await api().get('/v1/cart').set('Cookie', customerCookie).expect(200);
    return res.body.data;
  }

  async function emptyCart(): Promise<void> {
    await api().delete('/v1/cart').set('Cookie', customerCookie).expect(204);
  }

  async function addOneUnit(): Promise<void> {
    await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 })
      .expect(200);
  }

  /**
   * Remove every row this suite creates, in foreign-key order.
   *
   * Run before as well as after, because a suite that dies mid-run leaves an
   * ACTIVE promotion and an extra catalogue product behind, and both are
   * visible to every other suite: the promotion zeroes shipping on their
   * orders, and the product shifts paginated search results far enough to
   * push an expected hit off the first page. That is what a partial first
   * version of this file did, and the failures all surfaced in specs that
   * have nothing to do with shipping.
   *
   * The order matters: placed orders and stock movements reference the
   * variant, and `PromotionUsage` blocks the promotion delete outright
   * (`onDelete: Restrict`).
   */
  async function purge(): Promise<void> {
    const variants = await prisma.productVariant.findMany({
      where: { sku: { startsWith: SKU_PREFIX } },
      select: { id: true },
    });
    const variantIds = variants.map((v) => v.id);
    if (variantIds.length) {
      await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: variantIds } } });
      await prisma.orderItem.deleteMany({ where: { variantId: { in: variantIds } } });
      await prisma.cartItem.deleteMany({ where: { variantId: { in: variantIds } } });
      await prisma.stockLevel.deleteMany({ where: { variantId: { in: variantIds } } });
    }
    await prisma.promotionUsage.deleteMany({ where: { promotionId: PROMO_ID } });
    await prisma.promotionProduct.deleteMany({ where: { promotionId: PROMO_ID } });
    await prisma.promotion.deleteMany({ where: { id: PROMO_ID } });
    if (variantIds.length) {
      await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } });
    }
    await prisma.product.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
    const users = await prisma.user.findMany({
      where: { email: { endsWith: TEST_SUFFIX } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length) {
      await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } });
      await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } });
      await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
  }

  async function setPromotionActive(isActive: boolean): Promise<void> {
    await prisma.promotion.update({ where: { id: PROMO_ID }, data: { isActive } });
    // The cart caches nothing for promotions, but shipping rates are cached
    // for 15 minutes, so the rate itself must stay constant across both legs.
    // Only the promotion flips.
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await purge();

    const product = await prisma.product.create({
      data: {
        name: { default: 'E2E Free Shipping Widget', fr: 'E2E Widget', en: 'E2E Widget' },
        slug: `${SLUG_PREFIX}${Date.now()}`,
        description: { default: 'Free shipping e2e fixture', fr: 'Fixture', en: 'Fixture' },
        status: 'ACTIVE',
        variants: {
          create: {
            sku: `${SKU_PREFIX}${Date.now()}`,
            price: UNIT_PRICE,
            weight: 0.5,
            isActive: true,
          },
        },
      },
      include: { variants: true },
    });
    variantId = product.variants[0].id;

    const location =
      (await prisma.inventoryLocation.findFirst({ where: { isActive: true } })) ??
      (await prisma.inventoryLocation.create({
        data: { name: 'E2E Free Shipping Location', code: `E2E-FRSHIP-${Date.now()}` },
      }));
    await prisma.stockLevel.create({
      data: { variantId, locationId: location.id, onHand: 50, reserved: 0 },
    });

    // FREE_SHIPPING, AUTOMATIC, threshold well below one unit, seeded inactive
    // so the "charged" leg runs first against an untouched baseline.
    //
    // Restricted to this suite's own product. An AUTOMATIC promotion is live
    // for every cart the moment it is active, and Jest runs these suites in
    // parallel: an unrestricted one zeroed the shipping on carts belonging to
    // happy-path and return-flow, turning this spec into a source of failures
    // in specs it has nothing to do with. The eligibility restriction is also
    // what exercises the promo-item id parity, since an order evaluated with
    // empty product ids cannot match it.
    await prisma.promotion.create({
      data: {
        id: PROMO_ID,
        name: {
          default: 'E2E Free Shipping',
          fr: 'E2E Livraison offerte',
          en: 'E2E Free Shipping',
        },
        type: 'FREE_SHIPPING',
        applicationMethod: 'AUTOMATIC',
        value: 0,
        minimumOrderAmount: 100,
        isActive: false,
        priority: 1,
        eligibleProducts: { create: { productId: product.id } },
      },
    });

    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD);
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    shippingMethodId = await shippingMethodForCountry(adminCookie, STORE_ADDRESS.country);
  });

  afterAll(async () => {
    await purge();
    await prisma.$disconnect();
  });

  // ── Baseline: the same cart with the promotion off ─────────────────────────

  let chargedShipping = 0;

  it('charges shipping on the cart and the order while the promotion is inactive', async () => {
    await setPromotionActive(false);
    await emptyCart();
    await addOneUnit();

    const withPromoOff = await cart();
    chargedShipping = Number(withPromoOff.shippingEstimate);
    // Without a non-zero baseline the free-shipping assertions below would pass
    // on a store that never charges shipping at all, which is exactly the shape
    // of test that reports green through a real defect.
    expect(chargedShipping).toBeGreaterThan(0);
    expect(Number(withPromoOff.grandTotal)).toBeCloseTo(
      Number(withPromoOff.total) + chargedShipping,
      3,
    );

    const order = await api()
      .post('/v1/orders')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({ shippingAddress: STORE_ADDRESS, shippingMethodId })
      .expect(201);
    expect(Number(order.body.data.shippingAmount)).toBeCloseTo(chargedShipping, 3);
  });

  // ── The promotion on ───────────────────────────────────────────────────────

  it('zeroes the cart shipping estimate once the promotion is active', async () => {
    await setPromotionActive(true);
    await emptyCart();
    await addOneUnit();

    const body = await cart();
    expect(Number(body.shippingEstimate)).toBe(0);
    // The method is still resolved: the shopper gets the delivery, free.
    expect(body.shippingMethodName).toBeTruthy();
    expect(Number(body.grandTotal)).toBeCloseTo(Number(body.total), 3);
  });

  it('charges zero shipping on the placed order and keeps the method name', async () => {
    const before = await cart();
    expect(before.items).toHaveLength(1);

    const res = await api()
      .post('/v1/orders')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({ shippingAddress: STORE_ADDRESS, shippingMethodId })
      .expect(201);

    const order = res.body.data;
    expect(Number(order.shippingAmount)).toBe(0);
    expect(typeof order.shippingMethodName).toBe('string');
    expect(order.shippingMethodName.length).toBeGreaterThan(0);

    // The whole total, not just the shipping column: a zeroed shipping row that
    // is still folded into the total would be the same defect one field over.
    const subtotal = Number(order.subtotal);
    const discountAmount = Number(order.discountAmount ?? 0);
    const taxAmount = Number(order.taxAmount ?? 0);
    expect(Number(order.total)).toBeCloseTo(subtotal - discountAmount + taxAmount, 3);
  });
});
