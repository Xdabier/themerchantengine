/**
 * Return Flow E2E — Full 11-step return lifecycle
 *
 * Setup: register customer → place order → admin transitions to DELIVERED
 *
 * 1.  POST /v1/orders/:orderId/returns       — customer requests return (CHANGED_MIND)
 * 2.  GET  /v1/returns                       — customer sees return in their list
 * 3.  GET  /v1/admin/returns                 — return appears in admin queue
 * 4.  PATCH /v1/admin/returns/:id/approve    — admin approves
 * 5.  PATCH /v1/admin/returns/:id/receive    — admin receives (restockDecision: RESTOCK)
 * 6.  GET  /v1/admin/inventory/variant/:id   — verify stock incremented
 * 7.  PATCH /v1/admin/returns/:id/refund     — admin refunds as STORE_CREDIT
 * 8.  GET  /v1/admin/gift-cards              — verify store-credit gift card created
 * 9.  GET  /v1/gift-cards/balance            — verify positive balance
 * 10. POST /v1/cart/items + POST /v1/cart/gift-card — add product + apply store credit
 * 11. POST /v1/orders                        — place new order, verify store credit deducted
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  ADMIN,
  STORE_ADDRESS,
  api,
  createTestPrisma,
  loginAs,
  shippingMethodForCountry,
  signUpCustomer,
} from './helpers';

const CUSTOMER_EMAIL = `return-flow-${crypto.randomUUID()}@e2e.test`;
const CUSTOMER_PASSWORD = 'ReturnFlow1!';
const PRODUCT_SLUG = 'classic-pique-polo';

describe('Return Flow (e2e)', () => {
  let prisma: PrismaClient;

  let customerCookie: string;
  let adminCookie: string;
  let variantId: string;
  let shippingMethodId: string;
  let orderId: string;
  let orderItemId: string;
  let returnId: string;
  let returnItemId: string;
  let stockBefore: number;
  let giftCardCode: string;
  let balanceAfterRefund: number;

  // ── Setup: deliver an order so it is eligible for return ──────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Register test customer
    customerCookie = await signUpCustomer(prisma, CUSTOMER_EMAIL, CUSTOMER_PASSWORD, {
      firstName: 'Return',
      lastName: 'Tester',
    });

    // A method that actually serves the destination, not `data[0]` of a list
    // ordered by sortOrder across every zone. See shippingMethodForCountry.
    shippingMethodId = await shippingMethodForCountry(adminCookie, STORE_ADDRESS.country);

    // Get an in-stock variant for the test product
    const productRes = await api().get(`/v1/products/${PRODUCT_SLUG}`).expect(200);
    variantId = productRes.body.data.variants[0]?.id;

    // Record stock level before the order (checked after RESTOCK)
    const stockRes = await api()
      .get(`/v1/admin/inventory/variant/${variantId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    // `{ variant, levels }`, not a bare array. See inventory.e2e-spec.ts.
    stockBefore = stockRes.body.data.levels.reduce(
      (sum: number, loc: any) => sum + (loc.onHand ?? 0),
      0,
    );

    // Add to cart → place order
    await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 })
      .expect(200);

    const orderRes = await api()
      .post('/v1/orders')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({ shippingAddress: STORE_ADDRESS, shippingMethodId })
      .expect(201);
    orderId = orderRes.body.data.id;

    // Admin: CONFIRMED → fetch items → create shipment → PROCESSING → SHIPPED → DELIVERED
    await api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    const detailRes = await api()
      .get(`/v1/admin/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    orderItemId = detailRes.body.data.items[0].id;

    await api()
      .post(`/v1/admin/orders/${orderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({
        items: [{ orderItemId, quantity: 1 }],
        carrier: 'QX',
        trackingNumber: 'QX-RTN-001',
      })
      .expect(201);

    // Required transitions: CONFIRMED → PROCESSING → SHIPPED → DELIVERED.
    // Creating the shipment above is what moves the order to PROCESSING since
    // plan M phase M1, so this picks up from SHIPPED.
    await api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'SHIPPED' })
      .expect(200);

    await api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'DELIVERED' })
      .expect(200);
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email: CUSTOMER_EMAIL } });
    } catch {
      // ignore — test may not have reached registration
    }
    await prisma.$disconnect();
  });

  // ── 1. Customer requests return ──────────────────────────────────────────────

  it('1. POST /v1/orders/:orderId/returns — customer requests return (CHANGED_MIND)', async () => {
    const res = await api()
      .post(`/v1/orders/${orderId}/returns`)
      .set('Cookie', customerCookie)
      .send({
        items: [{ orderItemId, quantity: 1 }],
        reason: 'CHANGED_MIND',
        reasonDetail: 'Changed my mind about the purchase.',
        refundMethod: 'STORE_CREDIT',
      })
      .expect(201);

    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe('REQUESTED');
    expect(res.body.data.reason).toBe('CHANGED_MIND');
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.items.length).toBe(1);
    returnId = res.body.data.id;
    // Capture returnItemId from creation response
    returnItemId = res.body.data.items[0]?.id;
  });

  // ── 2. Customer sees return in list ─────────────────────────────────────────

  it('2. GET /v1/returns — return appears in customer return list', async () => {
    const res = await api().get('/v1/returns').set('Cookie', customerCookie).expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.meta).toBeDefined();
    const found = res.body.data.find((r: any) => r.id === returnId);
    expect(found).toBeDefined();
    expect(found.status).toBe('REQUESTED');
  });

  it('(customer) GET /v1/returns/:id — customer sees return detail with items', async () => {
    const res = await api()
      .get(`/v1/returns/${returnId}`)
      .set('Cookie', customerCookie)
      .expect(200);

    expect(res.body.data.id).toBe(returnId);
    expect(res.body.data.items).toBeInstanceOf(Array);
    // Capture returnItemId from detail if not already set from creation
    if (!returnItemId) {
      returnItemId = res.body.data.items[0]?.id;
    }
    expect(returnItemId).toBeDefined();
  });

  // ── 3. Admin sees return in queue ────────────────────────────────────────────

  it('3. GET /v1/admin/returns — return appears in admin return queue', async () => {
    const res = await api().get('/v1/admin/returns').set('Cookie', adminCookie).expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.meta).toBeDefined();
    const found = res.body.data.find((r: any) => r.id === returnId);
    expect(found).toBeDefined();
    expect(found.status).toBe('REQUESTED');
  });

  // ── 4. Admin approves ────────────────────────────────────────────────────────

  it('4. PATCH /v1/admin/returns/:id/approve — admin approves return', async () => {
    const res = await api()
      .patch(`/v1/admin/returns/${returnId}/approve`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.approvedAt).toBeDefined();
  });

  // ── 5. Admin receives items (RESTOCK) ────────────────────────────────────────

  it('5. PATCH /v1/admin/returns/:id/receive — admin receives and restocks', async () => {
    const res = await api()
      .patch(`/v1/admin/returns/${returnId}/receive`)
      .set('Cookie', adminCookie)
      .send({ items: [{ returnItemId, restockDecision: 'RESTOCK' }] })
      .expect(200);

    expect(res.body.data.status).toBe('ITEM_RECEIVED');
    expect(res.body.data.receivedAt).toBeDefined();
  });

  // ── 6. Verify stock incremented ──────────────────────────────────────────────

  it('6. GET /v1/admin/inventory/variant/:id — stock incremented by 1 after RESTOCK', async () => {
    const res = await api()
      .get(`/v1/admin/inventory/variant/${variantId}`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.data.levels).toBeInstanceOf(Array);
    const stockAfter = res.body.data.levels.reduce(
      (sum: number, loc: any) => sum + (loc.onHand ?? 0),
      0,
    );
    // Stock should be restored to at least the level before order placement
    // (order decremented by 1 on placement; RESTOCK increments by 1 on receive)
    expect(stockAfter).toBeGreaterThanOrEqual(stockBefore);
  });

  // ── 7. Admin refunds as store credit ─────────────────────────────────────────

  it('7. PATCH /v1/admin/returns/:id/refund — admin issues store credit', async () => {
    const res = await api()
      .patch(`/v1/admin/returns/${returnId}/refund`)
      .set('Cookie', adminCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({ refundMethod: 'STORE_CREDIT' })
      .expect(200);

    expect(res.body.data.status).toBe('REFUND_PROCESSED');
    expect(res.body.data.refundedAt).toBeDefined();
    expect(res.body.data.refundMethod).toBe('STORE_CREDIT');
  });

  // ── 8. Verify store-credit gift card was created for the customer ─────────────

  it('8. GET /v1/admin/gift-cards — store-credit gift card created for customer', async () => {
    // Filter by recipientEmail — the issueStoreCredit method sets this to
    // the customer's email so we get exactly this customer's card.
    const res = await api()
      .get('/v1/admin/gift-cards')
      .set('Cookie', adminCookie)
      .query({ recipientEmail: CUSTOMER_EMAIL })
      .expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);

    // Store credit: purchasedBy is null (system-issued, not customer-purchased)
    const card = res.body.data.find(
      (gc: any) => gc.purchasedBy === null || gc.purchasedBy === undefined,
    );
    expect(card).toBeDefined();
    expect(card.code).toBeDefined();
    giftCardCode = card.code;
  });

  // ── 9. Verify gift card has a positive balance ───────────────────────────────

  it('9. GET /v1/gift-cards/balance — store credit gift card has positive balance', async () => {
    const res = await api().get('/v1/gift-cards/balance').query({ code: giftCardCode }).expect(200);

    expect(res.body.data.currentBalance).toBeGreaterThan(0);
    balanceAfterRefund = res.body.data.currentBalance;
  });

  // ── 10. Customer adds product to cart and applies store credit ───────────────

  it('10a. POST /v1/cart/items — customer adds product to cart', async () => {
    const res = await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 })
      .expect(200);

    expect(res.body.data.itemCount).toBeGreaterThan(0);
    expect(res.body.data.items.some((i: any) => i.variantId === variantId)).toBe(true);
  });

  it('10b. POST /v1/cart/gift-card — customer applies store credit to cart', async () => {
    const res = await api()
      .post('/v1/cart/gift-card')
      .set('Cookie', customerCookie)
      .send({ code: giftCardCode })
      .expect(200);

    // Cart should reflect gift card applied
    expect(res.body.data).toBeDefined();
  });

  // ── 11. Place new order with store credit; verify balance deducted ───────────

  it('11. POST /v1/orders — new order placed; store credit balance is deducted', async () => {
    const newOrderRes = await api()
      .post('/v1/orders')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({
        shippingAddress: STORE_ADDRESS,
        shippingMethodId,
        giftCardCode,
      })
      .expect(201);

    expect(newOrderRes.body.data.id).toBeDefined();
    expect(newOrderRes.body.data.status).toBe('PENDING');

    // Verify gift card balance was deducted after order placement
    const balanceRes = await api()
      .get('/v1/gift-cards/balance')
      .query({ code: giftCardCode })
      .expect(200);

    // Balance must be less than it was before this order
    expect(balanceRes.body.data.currentBalance).toBeLessThan(balanceAfterRefund);
  });
});
