import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  signUpCustomer,
  loginAs,
  ADMIN,
  STORE_ADDRESS,
} from '../../../test/e2e/helpers';

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-returns.test';
const TEST_PASSWORD = 'StrongPass1!';

const SHIPPING_ADDRESS = { ...STORE_ADDRESS, fullName: 'Test User' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function idemKey(): string {
  return randomUUID();
}

function refundIdemKey(): string {
  return randomUUID();
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Returns (e2e)', () => {
  let prisma: PrismaClient;

  let customerCookie: string;
  let otherCookie: string;
  let adminCookie: string;
  let variantId: string;
  let locationId: string;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function addToCart(cookie: string, vId: string, qty = 2) {
    return api()
      .post('/v1/cart/items')
      .set('Cookie', cookie)
      .send({ variantId: vId, quantity: qty });
  }

  function placeOrder(cookie: string, key = idemKey()) {
    return api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', key)
      .send({ shippingAddress: SHIPPING_ADDRESS, billingAddress: SHIPPING_ADDRESS });
  }

  function adminPatchOrderStatus(orderId: string, status: string) {
    return api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status });
  }

  async function deliverOrder(cookie: string): Promise<{ orderId: string; orderItemId: string }> {
    await addToCart(cookie, variantId, 2);
    const orderRes = await placeOrder(cookie);
    const orderId: string = orderRes.body.data.id;
    const orderItemId: string = orderRes.body.data.items[0].id;

    for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
      await adminPatchOrderStatus(orderId, status);
    }
    return { orderId, orderItemId };
  }

  // ── Global setup ──────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Cleanup previous runs ─────────────────────────────────────────────
    const testUsers = await prisma.user.findMany({
      where: { email: { endsWith: TEST_SUFFIX } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);

    if (testUserIds.length) {
      await prisma.giftCardTransaction.deleteMany({
        where: { giftCard: { purchasedBy: null, recipientEmail: { endsWith: TEST_SUFFIX } } },
      });
      await prisma.giftCard.deleteMany({
        where: { recipientEmail: { endsWith: TEST_SUFFIX } },
      });
      await prisma.inventoryMovement.deleteMany({
        where: { variant: { product: { slug: { contains: 'e2e-return-' } } } },
      });
      await prisma.returnItem.deleteMany({
        where: { return: { customerId: { in: testUserIds } } },
      });
      await prisma.returnAsset.deleteMany({
        where: { return: { customerId: { in: testUserIds } } },
      });
      await prisma.return.deleteMany({ where: { customerId: { in: testUserIds } } });
      await prisma.orderItem.deleteMany({
        where: { order: { userId: { in: testUserIds } } },
      });
      await prisma.invoice.deleteMany({
        where: { order: { userId: { in: testUserIds } } },
      });
      await prisma.shipment.deleteMany({
        where: { order: { userId: { in: testUserIds } } },
      });
      await prisma.order.deleteMany({ where: { userId: { in: testUserIds } } });
      await prisma.cartItem.deleteMany({
        where: { cart: { userId: { in: testUserIds } } },
      });
      await prisma.cart.deleteMany({ where: { userId: { in: testUserIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });

    // ── Seed: inventory location ──────────────────────────────────────────
    let location = await prisma.inventoryLocation.findFirst({ where: { isActive: true } });
    if (!location) {
      location = await prisma.inventoryLocation.create({
        data: { name: 'Default', code: 'DEF-RET', isActive: true },
      });
    }
    locationId = location.id;

    // ── Seed: product + variant ───────────────────────────────────────────
    const timestamp = Date.now();
    const product = await prisma.product.create({
      data: {
        name: { default: 'E2E Return Widget', fr: 'E2E Return Widget', en: 'E2E Return Widget' },
        slug: `e2e-return-widget-${timestamp}`,
        description: {
          default: 'Returns E2E test product',
          fr: 'Returns E2E test product',
          en: 'Returns E2E test product',
        },
        status: 'ACTIVE',
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `E2E-RET-V1-${timestamp}`,
        price: 100,
        weight: 0.5,
        isActive: true,
      },
    });
    variantId = variant.id;

    await prisma.stockLevel.upsert({
      where: { variantId_locationId: { variantId, locationId } },
      update: { onHand: 1000 },
      create: { variantId, locationId, onHand: 1000, reserved: 0 },
    });

    // ── Sign in ───────────────────────────────────────────────────────────
    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Alice',
      lastName: 'Returns',
    });
    otherCookie = await signUpCustomer(prisma, `other${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Bob',
      lastName: 'Returns',
    });
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  }, 90_000);

  afterAll(async () => {
    // Return.customerId has onDelete: Restrict — must clean up returns before users.
    const testUsers = await prisma.user.findMany({
      where: { email: { endsWith: TEST_SUFFIX } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);
    if (testUserIds.length) {
      await prisma.returnItem
        .deleteMany({ where: { return: { customerId: { in: testUserIds } } } })
        .catch(() => {});
      await prisma.returnAsset
        .deleteMany({ where: { return: { customerId: { in: testUserIds } } } })
        .catch(() => {});
      await prisma.return
        .deleteMany({ where: { customerId: { in: testUserIds } } })
        .catch(() => {});
      await prisma.giftCard
        .deleteMany({ where: { recipientEmail: { endsWith: TEST_SUFFIX } } })
        .catch(() => {});
      await prisma.orderItem
        .deleteMany({ where: { order: { userId: { in: testUserIds } } } })
        .catch(() => {});
      await prisma.invoice
        .deleteMany({ where: { order: { userId: { in: testUserIds } } } })
        .catch(() => {});
      await prisma.shipment
        .deleteMany({ where: { order: { userId: { in: testUserIds } } } })
        .catch(() => {});
      await prisma.order.deleteMany({ where: { userId: { in: testUserIds } } }).catch(() => {});
      await prisma.cartItem
        .deleteMany({ where: { cart: { userId: { in: testUserIds } } } })
        .catch(() => {});
      await prisma.cart.deleteMany({ where: { userId: { in: testUserIds } } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 1: Full Lifecycle
  //   order → deliver → return request → approve → receive (RESTOCK)
  //   → refund (STORE_CREDIT) → close
  // ══════════════════════════════════════════════════════════════════════════

  describe('Full return lifecycle', () => {
    let orderId: string;
    let orderItemId: string;
    let returnId: string;
    let returnItemId: string;
    let stockBefore: number;

    it('delivers an order', async () => {
      const { orderId: oid, orderItemId: oiid } = await deliverOrder(customerCookie);
      orderId = oid;
      orderItemId = oiid;

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order?.status).toBe('DELIVERED');
    });

    it('records stock level before return', async () => {
      const stock = await prisma.stockLevel.findFirst({ where: { variantId, locationId } });
      stockBefore = stock?.onHand ?? 0;
      expect(stockBefore).toBeGreaterThan(0);
    });

    it('customer requests a return — RET-YYYY-NNNNNN format', async () => {
      const res = await api()
        .post(`/v1/orders/${orderId}/returns`)
        .set('Cookie', customerCookie)
        .send({
          items: [{ orderItemId, quantity: 1 }],
          reason: 'DEFECTIVE',
          reasonDetail: 'Item arrived broken',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('REQUESTED');
      expect(res.body.data.returnNumber).toMatch(/^RET-\d{4}-\d{6}$/);
      expect(res.body.data.reason).toBe('DEFECTIVE');
      expect(res.body.data.items).toHaveLength(1);
      expect(Number(res.body.data.refundAmount)).toBe(100);

      returnId = res.body.data.id;
      returnItemId = res.body.data.items[0].id;
    });

    it('customer can view their return', async () => {
      const res = await api().get(`/v1/returns/${returnId}`).set('Cookie', customerCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(returnId);
    });

    it('other customer cannot view the return — 403', async () => {
      const res = await api().get(`/v1/returns/${returnId}`).set('Cookie', otherCookie);

      expect(res.status).toBe(403);
    });

    it('customer lists their returns', async () => {
      const res = await api().get('/v1/returns').set('Cookie', customerCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta).toBeDefined();
    });

    it('admin can list all returns with status filter', async () => {
      const res = await api().get('/v1/admin/returns?status=REQUESTED').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.some((r: { id: string }) => r.id === returnId)).toBe(true);
    });

    it('admin approves the return', async () => {
      const res = await api()
        .patch(`/v1/admin/returns/${returnId}/approve`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');
      expect(res.body.data.approvedAt).not.toBeNull();
    });

    it('admin receives the return with RESTOCK decision — stock incremented', async () => {
      const res = await api()
        .patch(`/v1/admin/returns/${returnId}/receive`)
        .set('Cookie', adminCookie)
        .send({
          items: [{ returnItemId, restockDecision: 'RESTOCK' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ITEM_RECEIVED');
      expect(res.body.data.receivedAt).not.toBeNull();

      // Verify stock was restored
      const stock = await prisma.stockLevel.findFirst({ where: { variantId, locationId } });
      expect(stock!.onHand).toBe(stockBefore + 1);

      // Verify inventory movement recorded
      const movement = await prisma.inventoryMovement.findFirst({
        where: { variantId, referenceId: returnId, reason: 'RETURN_RESTOCK' },
      });
      expect(movement).not.toBeNull();
      expect(movement!.quantity).toBe(1);
    });

    it('admin processes refund via STORE_CREDIT — gift card issued', async () => {
      const res = await api()
        .patch(`/v1/admin/returns/${returnId}/refund`)
        .set('Cookie', adminCookie)
        .set('X-Idempotency-Key', refundIdemKey())
        .send({ refundMethod: 'STORE_CREDIT' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REFUND_PROCESSED');
      expect(res.body.data.refundMethod).toBe('STORE_CREDIT');
      expect(res.body.data.refundedAt).not.toBeNull();

      // Verify gift card issued to customer
      const customer = await prisma.user.findFirst({
        where: { email: `customer${TEST_SUFFIX}` },
      });
      const gc = await prisma.giftCard.findFirst({
        where: { recipientEmail: customer!.email, purchasedBy: null },
        include: { transactions: true },
      });
      expect(gc).not.toBeNull();
      expect(Number(gc!.currentBalance)).toBe(100);
      expect(gc!.transactions).toHaveLength(1);
      expect(gc!.transactions[0].note).toContain('Store credit issued');
    });

    it('admin closes the return', async () => {
      const res = await api()
        .patch(`/v1/admin/returns/${returnId}/close`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLOSED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 2: Rejection Path
  // ══════════════════════════════════════════════════════════════════════════

  describe('Rejection path', () => {
    let orderId: string;
    let orderItemId: string;
    let returnId: string;

    beforeAll(async () => {
      const delivered = await deliverOrder(customerCookie);
      orderId = delivered.orderId;
      orderItemId = delivered.orderItemId;
    }, 60_000);

    it('customer requests a return', async () => {
      const res = await api()
        .post(`/v1/orders/${orderId}/returns`)
        .set('Cookie', customerCookie)
        .send({ items: [{ orderItemId, quantity: 1 }], reason: 'CHANGED_MIND' });

      expect(res.status).toBe(201);
      returnId = res.body.data.id;
    });

    it('admin rejects the return with a reason', async () => {
      const res = await api()
        .patch(`/v1/admin/returns/${returnId}/reject`)
        .set('Cookie', adminCookie)
        .send({ reason: 'Item shows signs of use' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.adminNotes).toBe('Item shows signs of use');
    });

    it('cannot approve a REJECTED return — 400', async () => {
      const res = await api()
        .patch(`/v1/admin/returns/${returnId}/approve`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 3: Validation Guards
  // ══════════════════════════════════════════════════════════════════════════

  describe('Validation guards', () => {
    let deliveredOrderId: string;
    let deliveredItemId: string;

    beforeAll(async () => {
      const delivered = await deliverOrder(customerCookie);
      deliveredOrderId = delivered.orderId;
      deliveredItemId = delivered.orderItemId;
    }, 60_000);

    it('rejects return on non-DELIVERED order — 400', async () => {
      await addToCart(customerCookie, variantId, 1);
      const orderRes = await placeOrder(customerCookie);
      const pendingOrderId: string = orderRes.body.data.id;
      const pendingItemId: string = orderRes.body.data.items[0].id;

      const res = await api()
        .post(`/v1/orders/${pendingOrderId}/returns`)
        .set('Cookie', customerCookie)
        .send({ items: [{ orderItemId: pendingItemId, quantity: 1 }], reason: 'DEFECTIVE' });

      expect(res.status).toBe(400);
    });

    it("rejects return for another customer's order — 403", async () => {
      const res = await api()
        .post(`/v1/orders/${deliveredOrderId}/returns`)
        .set('Cookie', otherCookie)
        .send({ items: [{ orderItemId: deliveredItemId, quantity: 1 }], reason: 'DEFECTIVE' });

      expect(res.status).toBe(403);
    });

    it('rejects return with quantity > ordered — 400', async () => {
      const res = await api()
        .post(`/v1/orders/${deliveredOrderId}/returns`)
        .set('Cookie', customerCookie)
        .send({ items: [{ orderItemId: deliveredItemId, quantity: 999 }], reason: 'DEFECTIVE' });

      expect(res.status).toBe(400);
    });

    it('rejects duplicate active return for same order — 400', async () => {
      // First return
      await api()
        .post(`/v1/orders/${deliveredOrderId}/returns`)
        .set('Cookie', customerCookie)
        .send({ items: [{ orderItemId: deliveredItemId, quantity: 1 }], reason: 'DEFECTIVE' });

      // Duplicate
      const res = await api()
        .post(`/v1/orders/${deliveredOrderId}/returns`)
        .set('Cookie', customerCookie)
        .send({ items: [{ orderItemId: deliveredItemId, quantity: 1 }], reason: 'DEFECTIVE' });

      expect(res.status).toBe(400);
    });

    it('reject endpoint requires reason — 400 when missing', async () => {
      // Create a return to reject
      const newDelivered = await deliverOrder(customerCookie);
      const returnRes = await api()
        .post(`/v1/orders/${newDelivered.orderId}/returns`)
        .set('Cookie', customerCookie)
        .send({ items: [{ orderItemId: newDelivered.orderItemId, quantity: 1 }], reason: 'OTHER' });
      const rid: string = returnRes.body.data.id;

      const res = await api()
        .patch(`/v1/admin/returns/${rid}/reject`)
        .set('Cookie', adminCookie)
        .send({});

      expect(res.status).toBe(400);
    });

    it('non-admin cannot access admin endpoints — 403', async () => {
      const res = await api().get('/v1/admin/returns').set('Cookie', customerCookie);

      expect(res.status).toBe(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 4: Analytics
  // ══════════════════════════════════════════════════════════════════════════

  describe('Analytics', () => {
    it('returns analytics summary', async () => {
      const res = await api().get('/v1/admin/returns/analytics').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        totalReturns: expect.any(Number),
        totalOrders: expect.any(Number),
        returnRate: expect.any(Number),
        byStatus: expect.any(Array),
        byReason: expect.any(Array),
        refundsByMethod: expect.any(Array),
        topReturnedVariants: expect.any(Array),
      });
    });

    it('filters analytics by date range', async () => {
      const dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const dateTo = new Date().toISOString();

      const res = await api()
        .get(`/v1/admin/returns/analytics?dateFrom=${dateFrom}&dateTo=${dateTo}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.totalReturns).toBeGreaterThanOrEqual(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 4: Refund idempotency contract (audit §1.12)
  //   Suite-local minimum: missing-key 400 + malformed-key 400. The
  //   broader replay-cached / 409-body / 403-caller branches share their
  //   contract with orders.e2e-spec since the IdempotencyService state
  //   machine is identical across endpoints; duplicating the matrix
  //   under returns would only re-prove the cross-endpoint primitive.
  // ══════════════════════════════════════════════════════════════════════════

  describe('PATCH /v1/admin/returns/:id/refund — idempotency contract', () => {
    // Cross-endpoint replay/conflict/forbidden branches share with
    // orders.e2e-spec (single IdempotencyService); this suite owns the
    // route-specific 400 pipe checks.

    it('missing X-Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      // The Return id is irrelevant — the pipe runs before any route logic.
      const res = await api()
        .patch('/v1/admin/returns/nonexistent/refund')
        .set('Cookie', adminCookie)
        .send({ refundMethod: 'STORE_CREDIT' });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('malformed X-Idempotency-Key → 400 IDEMPOTENCY_KEY_MALFORMED', async () => {
      const res = await api()
        .patch('/v1/admin/returns/nonexistent/refund')
        .set('Cookie', adminCookie)
        .set('X-Idempotency-Key', 'not-a-uuid')
        .send({ refundMethod: 'STORE_CREDIT' });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_MALFORMED');
    });
  });
});
