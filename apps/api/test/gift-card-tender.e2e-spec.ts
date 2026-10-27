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
  STORE_CURRENCY,
} from '../../../test/e2e/helpers';

/**
 * A gift card used as tender, end to end, against the real database.
 *
 * The card has to survive four hand-offs: applied on the cart, persisted on
 * the cart row, read back on the next request, and redeemed at order create.
 * Each of those was broken at some point, and each break was invisible from
 * the next one along, so this drives the whole chain in one flow and checks
 * the ledger at the end rather than trusting the order total alone.
 *
 * A code shorter than sixteen characters is used on purpose. Codes are issued
 * 8 to 20 uppercase alphanumerics, but order creation demanded exactly 16, so
 * an operator-issued short card applied to the cart and then 400'd at
 * checkout. A 16-character fixture cannot catch that.
 */

const TEST_SUFFIX = '@e2e-tender.test';
const TEST_PASSWORD = 'StrongPass1!';
const SKU_PREFIX = 'E2E-TENDER-';
const SLUG_PREFIX = 'e2e-tender-';
/** Twelve characters: inside the issuable range, outside the old 16-only gate. */
const CARD_CODE = 'E2ETENDER123';
const CARD_BALANCE = 40;
const UNIT_PRICE = 300;

describe('Gift card tender (e2e)', () => {
  let prisma: PrismaClient;
  let customerCookie: string;
  let adminCookie: string;
  let shippingMethodId: string;
  let variantId: string;

  async function cart(): Promise<Record<string, unknown>> {
    const res = await api().get('/v1/cart').set('Cookie', customerCookie).expect(200);
    return res.body.data;
  }

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
    await prisma.giftCardTransaction.deleteMany({ where: { giftCard: { code: CARD_CODE } } });
    await prisma.giftCard.deleteMany({ where: { code: CARD_CODE } });
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

  beforeAll(async () => {
    prisma = createTestPrisma();
    await purge();

    const product = await prisma.product.create({
      data: {
        name: { default: 'E2E Tender Widget', fr: 'E2E Tender Widget', en: 'E2E Tender Widget' },
        slug: `${SLUG_PREFIX}${Date.now()}`,
        description: { default: 'Tender e2e fixture', fr: 'Fixture', en: 'Fixture' },
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
        data: { name: 'E2E Tender Location', code: `E2E-TENDER-${Date.now()}` },
      }));
    await prisma.stockLevel.create({
      data: { variantId, locationId: location.id, onHand: 50, reserved: 0 },
    });

    await prisma.giftCard.create({
      data: {
        code: CARD_CODE,
        initialBalance: CARD_BALANCE,
        currentBalance: CARD_BALANCE,
        currency: STORE_CURRENCY,
        isActive: true,
      },
    });

    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD);
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    shippingMethodId = await shippingMethodForCountry(adminCookie, STORE_ADDRESS.country);

    await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 })
      .expect(200);
  });

  afterAll(async () => {
    await purge();
    await prisma.$disconnect();
  });

  it('accepts a twelve-character code, which the old sixteen-only gate refused', async () => {
    const res = await api()
      .post('/v1/cart/gift-card')
      .set('Cookie', customerCookie)
      .send({ code: CARD_CODE })
      .expect(200);

    // The apply response is the whole cart, not a bare validation result. The
    // client parses it as a cart, so returning `{ currentBalance, currency }`
    // threw on every SUCCESS and the page reported a valid card as invalid.
    expect(res.body.data.subtotal).toBeDefined();
    expect(res.body.data.giftCard?.code).toBe(CARD_CODE);
  });

  it('rejects a dash-formatted code with a validation error, not a lookup', async () => {
    await api()
      .post('/v1/cart/gift-card')
      .set('Cookie', customerCookie)
      .send({ code: 'GIFT-TEST-1234' })
      .expect(400);
  });

  it('reads the applied card back on a fresh cart request, capped at the payable total', async () => {
    // The code lives on the cart row, so it survives a reload and does not
    // depend on the browser holding it. Before that it was validated and
    // thrown away, and the checkout payload read a field the API never sent.
    const body = await cart();
    expect((body.giftCard as { code: string })?.code).toBe(CARD_CODE);
    const applied = Number((body.giftCard as { balanceApplied: number }).balanceApplied);
    expect(applied).toBe(Math.min(CARD_BALANCE, Number(body.grandTotalTtc)));
  });

  it('removes the card and leaves the cart otherwise intact', async () => {
    await api().delete('/v1/cart/gift-card').set('Cookie', customerCookie).expect(204);
    const afterRemove = await cart();
    expect(afterRemove.giftCard).toBeNull();
    expect(afterRemove.items).toHaveLength(1);

    // Re-apply for the redemption leg below.
    await api()
      .post('/v1/cart/gift-card')
      .set('Cookie', customerCookie)
      .send({ code: CARD_CODE })
      .expect(200);
  });

  it('deducts the card at order create and writes the ledger entry', async () => {
    const before = await cart();
    const applied = Number((before.giftCard as { balanceApplied: number }).balanceApplied);
    expect(applied).toBeGreaterThan(0);

    const res = await api()
      .post('/v1/orders')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({ shippingAddress: STORE_ADDRESS, shippingMethodId });
    // The body names the rejection; a bare status assertion would not.
    expect({ status: res.status, error: res.body.error }).toEqual({
      status: 201,
      error: undefined,
    });

    const order = res.body.data;
    const subtotal = Number(order.subtotal);
    const shippingAmount = Number(order.shippingAmount ?? 0);
    const taxAmount = Number(order.taxAmount ?? 0);
    const discountAmount = Number(order.discountAmount ?? 0);
    // The gift card is folded into `discountAmount` on the order row, so the
    // total is the goods plus shipping and tax, less everything taken off.
    expect(Number(order.total)).toBeCloseTo(
      subtotal - discountAmount + shippingAmount + taxAmount,
      3,
    );
    expect(discountAmount).toBeGreaterThanOrEqual(applied);

    // The ledger, not just the order total: a redemption that moved no balance
    // would leave the order looking right and the card still worth its face
    // value, which is the shape of a free-money defect.
    const card = await prisma.giftCard.findUnique({ where: { code: CARD_CODE } });
    expect(Number(card?.currentBalance)).toBeCloseTo(CARD_BALANCE - applied, 3);

    const transactions = await prisma.giftCardTransaction.findMany({
      where: { giftCard: { code: CARD_CODE } },
    });
    expect(transactions).toHaveLength(1);
    expect(Math.abs(Number(transactions[0].amount))).toBeCloseTo(applied, 3);
  });

  it('clears the code from the cart once the order has consumed it', async () => {
    const after = await cart();
    expect(after.giftCard).toBeNull();
  });
});
