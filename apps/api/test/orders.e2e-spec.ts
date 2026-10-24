import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import type { Response } from 'supertest';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  signUpCustomer,
  loginAs,
  ADMIN,
  STORE_ADDRESS,
} from '../../../test/e2e/helpers';

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-orders.test';
const TEST_PASSWORD = 'StrongPass1!';

/** Staff who may read orders but is not the SUPER_ADMIN permission bypass. */
const ORDERS_STAFF_EMAIL = `staff-orders${TEST_SUFFIX}`;
/** Staff with an unrelated permission — proves the guard checks orders:view. */
const OTHER_STAFF_EMAIL = `staff-other${TEST_SUFFIX}`;

/** Collect a binary (non-JSON) response body into a Buffer. */
function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

const SHIPPING_ADDRESS = { ...STORE_ADDRESS, fullName: 'Test User' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function idemKey(): string {
  return randomUUID();
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Orders (e2e)', () => {
  let prisma: PrismaClient;

  let customerACookie: string;
  let customerBCookie: string;
  let adminCookie: string;
  let variantId: string;
  let variant2Id: string;
  let locationId: string;

  // ── Shortcuts ─────────────────────────────────────────────────────────────

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

  function adminPatchStatus(orderId: string, status: string) {
    return api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status });
  }

  // ── Global setup ──────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Cleanup previous runs ─────────────────────────────────────────────
    await prisma.inventoryMovement.deleteMany({
      where: { variant: { product: { slug: { contains: 'e2e-order-' } } } },
    });
    await prisma.auditLogEntry
      .deleteMany({
        where: { entityType: 'Order' },
      })
      .catch(() => {
        /* audit log cleanup is best-effort */
      });
    await prisma.orderItem.deleteMany({
      where: { order: { user: { email: { endsWith: TEST_SUFFIX } } } },
    });
    await prisma.invoice.deleteMany({
      where: { order: { user: { email: { endsWith: TEST_SUFFIX } } } },
    });
    await prisma.shipment.deleteMany({
      where: { order: { user: { email: { endsWith: TEST_SUFFIX } } } },
    });
    // Cascades from Order, so this is belt and braces rather than a
    // requirement; kept explicit so the cleanup reads as a complete list.
    await prisma.orderStatusHistory.deleteMany({
      where: { order: { user: { email: { endsWith: TEST_SUFFIX } } } },
    });
    await prisma.order.deleteMany({
      where: { user: { email: { endsWith: TEST_SUFFIX } } },
    });
    await prisma.cartItem.deleteMany({
      where: { cart: { user: { email: { endsWith: TEST_SUFFIX } } } },
    });
    await prisma.cart.deleteMany({
      where: { user: { email: { endsWith: TEST_SUFFIX } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });

    // ── Seed: inventory location ──────────────────────────────────────────
    let location = await prisma.inventoryLocation.findFirst({ where: { isActive: true } });
    if (!location) {
      location = await prisma.inventoryLocation.create({
        data: { name: 'Default', code: 'DEF-ORD', isActive: true },
      });
    }
    locationId = location.id;

    // ── Seed: product + 2 variants ────────────────────────────────────────
    const timestamp = Date.now();

    const product = await prisma.product.create({
      data: {
        name: { default: 'E2E Order Widget', fr: 'E2E Order Widget', en: 'E2E Order Widget' },
        slug: `e2e-order-widget-${timestamp}`,
        description: {
          default: 'Orders E2E test product',
          fr: 'Orders E2E test product',
          en: 'Orders E2E test product',
        },
        status: 'ACTIVE',
      },
    });

    const v1 = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `E2E-ORD-V1-${timestamp}`,
        price: 100,
        weight: 0.5,
        isActive: true,
      },
    });
    variantId = v1.id;

    const v2 = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `E2E-ORD-V2-${timestamp}`,
        price: 50,
        weight: 0.3,
        isActive: true,
      },
    });
    variant2Id = v2.id;

    // ── Seed: stock (1000 units each, room for all scenarios) ─────────────
    await prisma.stockLevel.upsert({
      where: { variantId_locationId: { variantId: variantId, locationId } },
      update: { onHand: 1000 },
      create: { variantId: variantId, locationId, onHand: 1000, reserved: 0 },
    });
    await prisma.stockLevel.upsert({
      where: { variantId_locationId: { variantId: variant2Id, locationId } },
      update: { onHand: 1000 },
      create: { variantId: variant2Id, locationId, onHand: 1000, reserved: 0 },
    });

    // ── Sign-in ───────────────────────────────────────────────────────────
    customerACookie = await signUpCustomer(prisma, `customerA${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Alice',
      lastName: 'Orders',
    });
    customerBCookie = await signUpCustomer(prisma, `customerB${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Bob',
      lastName: 'Orders',
    });
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 1: Full Lifecycle
  //   cart → place (PENDING) → CONFIRMED (invoice) → PROCESSING
  //   → create shipment → SHIPPED → DELIVERED
  // ══════════════════════════════════════════════════════════════════════════

  describe('Full lifecycle', () => {
    let orderId: string;
    let orderItemId: string;
    let shipmentId: string;

    it('adds 2 units to cart', async () => {
      const res = await addToCart(customerACookie, variantId, 2);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });

    it('places order — PENDING, ORD-YYYY-NNNNNN format, items snapshotted', async () => {
      const res = await placeOrder(customerACookie);

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');
      expect(res.body.data.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(2);
      expect(Number(res.body.data.subtotal)).toBe(200);

      orderId = res.body.data.id;
      orderItemId = res.body.data.items[0].id;
    });

    it('admin confirms order — invoice auto-generated', async () => {
      const res = await adminPatchStatus(orderId, 'CONFIRMED');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CONFIRMED');

      const invoice = await prisma.invoice.findUnique({ where: { orderId } });
      expect(invoice).not.toBeNull();
      expect(invoice!.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    });

    it('admin moves to PROCESSING', async () => {
      const res = await adminPatchStatus(orderId, 'PROCESSING');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PROCESSING');
    });

    it('admin creates a shipment — carrier + tracking captured; order stays PROCESSING', async () => {
      // Plan M phase M1: creating a shipment no longer ships the order. The row
      // is born PROCESSING, and announcing SHIPPED here would have lied about a
      // parcel still being packed. The order ships when the shipment does.
      const res = await api()
        .post(`/v1/admin/orders/${orderId}/shipments`)
        .set('Cookie', adminCookie)
        .send({
          items: [{ orderItemId, quantity: 2 }],
          carrier: 'DHL',
          trackingNumber: 'DHL123456',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.carrier).toBe('DHL');
      expect(res.body.data.trackingNumber).toBe('DHL123456');

      shipmentId = res.body.data.id;

      const orderRes = await api().get(`/v1/admin/orders/${orderId}`).set('Cookie', adminCookie);
      expect(orderRes.status).toBe(200);
      expect(orderRes.body.data.status).toBe('PROCESSING');
    });

    it('admin ships the shipment — the order follows it to SHIPPED', async () => {
      const res = await api()
        .patch(`/v1/admin/orders/${orderId}/shipments/${shipmentId}`)
        .set('Cookie', adminCookie)
        .send({ status: 'SHIPPED' });
      expect(res.status).toBe(200);

      const orderRes = await api().get(`/v1/admin/orders/${orderId}`).set('Cookie', adminCookie);
      expect(orderRes.body.data.status).toBe('SHIPPED');
    });

    it('admin marks order as DELIVERED', async () => {
      const res = await adminPatchStatus(orderId, 'DELIVERED');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('DELIVERED');
    });

    it('customer sees final order with invoice and shipment', async () => {
      const res = await api().get(`/v1/orders/${orderId}`).set('Cookie', customerACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('DELIVERED');
      expect(res.body.data.shipments).toHaveLength(1);
      expect(res.body.data.invoice).not.toBeNull();
      expect(res.body.data.invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    });
  });

  // ==========================================================================
  // SUITE 1b: Cancel and shipment contract (plan M, phase M1 - findings AD4, AD15)
  //   A shipment is the warehouse saying fulfilment started. From there the
  //   customer stops being able to cancel, the admin cancel cascades, and no
  //   shipment write lands on a closed order.
  // ==========================================================================

  describe('Cancel and shipment contract', () => {
    let orderId: string;
    let orderItemId: string;
    let shipmentId: string;

    async function freshOrder(): Promise<{ id: string; itemId: string }> {
      await addToCart(customerACookie, variantId, 1);
      const res = await placeOrder(customerACookie);
      expect(res.status).toBe(201);
      return { id: res.body.data.id, itemId: res.body.data.items[0].id };
    }

    function createShipment(id: string, itemId: string, qty = 1) {
      return api()
        .post(`/v1/admin/orders/${id}/shipments`)
        .set('Cookie', adminCookie)
        .send({ items: [{ orderItemId: itemId, quantity: qty }], carrier: 'DHL' });
    }

    beforeAll(async () => {
      const placed = await freshOrder();
      orderId = placed.id;
      orderItemId = placed.itemId;
      expect((await adminPatchStatus(orderId, 'CONFIRMED')).status).toBe(200);
    }, 60_000);

    it('reports cancellable true on a CONFIRMED order with no shipment', async () => {
      const res = await api().get(`/v1/orders/${orderId}`).set('Cookie', customerACookie);
      expect(res.status).toBe(200);
      expect(res.body.data.cancellable).toBe(true);
    });

    it('moves the order to PROCESSING when its first shipment is created', async () => {
      const res = await createShipment(orderId, orderItemId);
      expect(res.status).toBe(201);
      shipmentId = res.body.data.id;

      const after = await api().get(`/v1/admin/orders/${orderId}`).set('Cookie', adminCookie);
      expect(after.body.data.status).toBe('PROCESSING');
    });

    it('flips cancellable to false once the shipment exists', async () => {
      const res = await api().get(`/v1/orders/${orderId}`).set('Cookie', customerACookie);
      expect(res.status).toBe(200);
      expect(res.body.data.cancellable).toBe(false);
    });

    it('refuses the customer cancel with reason HAS_SHIPMENT', async () => {
      const res = await api().post(`/v1/orders/${orderId}/cancel`).set('Cookie', customerACookie);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_CANCEL_INELIGIBLE');
      expect(res.body.error.details.reason).toBe('HAS_SHIPMENT');
    });

    it('cascades the PROCESSING shipment to CANCELLED when the admin cancels', async () => {
      const stockBefore = await prisma.stockLevel.findUnique({
        where: { variantId_locationId: { variantId, locationId } },
      });

      const res = await adminPatchStatus(orderId, 'CANCELLED');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');

      const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
      expect(shipment!.status).toBe('CANCELLED');

      // The restore runs exactly once, inside updateStatus, and the cascade
      // does not double it.
      const stockAfter = await prisma.stockLevel.findUnique({
        where: { variantId_locationId: { variantId, locationId } },
      });
      expect(stockAfter!.onHand).toBe(stockBefore!.onHand + 1);
    });

    it('refuses a new shipment on the cancelled order', async () => {
      const res = await createShipment(orderId, orderItemId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_SHIPMENT_ORDER_CLOSED');
    });

    it('refuses to cancel a live shipment through the shipment route', async () => {
      // CANCELLED is not in `UpdateShipmentDto`'s allowed values, so the
      // validation pipe rejects it before the service sees it. Cancelling a
      // shipment on its own would strand it terminal while its order stayed
      // live and its stock stayed decremented.
      const placed = await freshOrder();
      expect((await adminPatchStatus(placed.id, 'CONFIRMED')).status).toBe(200);
      const created = await createShipment(placed.id, placed.itemId);
      expect(created.status).toBe(201);

      const res = await api()
        .patch(`/v1/admin/orders/${placed.id}/shipments/${created.body.data.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'CANCELLED' });

      expect(res.status).toBe(400);

      const row = await prisma.shipment.findUnique({ where: { id: created.body.data.id } });
      expect(row!.status).toBe('PROCESSING');
    });

    it('refuses a status write on the cancelled shipment', async () => {
      const res = await api()
        .patch(`/v1/admin/orders/${orderId}/shipments/${shipmentId}`)
        .set('Cookie', adminCookie)
        .send({ status: 'SHIPPED' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_SHIPMENT_ORDER_CLOSED');
    });

    it('refuses an admin cancel while one parcel is in transit, and restores no stock', async () => {
      // Two parcels: one gone, one still being packed. The order is therefore
      // still PROCESSING, which is exactly the window where the cancel route is
      // reachable and where cancelling would restore stock already shipped.
      await addToCart(customerACookie, variantId, 2);
      const placed = await placeOrder(customerACookie);
      expect(placed.status).toBe(201);
      const twoParcelId = placed.body.data.id as string;
      const twoParcelItemId = placed.body.data.items[0].id as string;

      expect((await adminPatchStatus(twoParcelId, 'CONFIRMED')).status).toBe(200);
      const first = await createShipment(twoParcelId, twoParcelItemId, 1);
      expect(first.status).toBe(201);
      const second = await createShipment(twoParcelId, twoParcelItemId, 1);
      expect(second.status).toBe(201);

      const shipped = await api()
        .patch(`/v1/admin/orders/${twoParcelId}/shipments/${first.body.data.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'SHIPPED' });
      expect(shipped.status).toBe(200);

      // The roll-up holds the order back while its sibling is still preparing.
      const midway = await api().get(`/v1/admin/orders/${twoParcelId}`).set('Cookie', adminCookie);
      expect(midway.body.data.status).toBe('PROCESSING');

      const stockBefore = await prisma.stockLevel.findUnique({
        where: { variantId_locationId: { variantId, locationId } },
      });

      const res = await adminPatchStatus(twoParcelId, 'CANCELLED');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_CANCEL_SHIPMENT_IN_TRANSIT');

      const stockAfter = await prisma.stockLevel.findUnique({
        where: { variantId_locationId: { variantId, locationId } },
      });
      expect(stockAfter!.onHand).toBe(stockBefore!.onHand);

      const still = await api().get(`/v1/admin/orders/${twoParcelId}`).set('Cookie', adminCookie);
      expect(still.body.data.status).toBe('PROCESSING');
    }, 60_000);

    it('ships the order from the shipment lane and logs the order.shipped mail', async () => {
      // AD15. Judged on NotificationLog, the mail engine's own receipt table,
      // never on a mocked mailer. The template's carrier and trackingNumber
      // variables come from `resolveOrder`, which reads the newest shipment
      // row, so firing the event at all is the whole fix.
      const recipient = `shipmail-${randomUUID()}${TEST_SUFFIX}`;
      const shipCookie = await signUpCustomer(prisma, recipient, TEST_PASSWORD, {
        firstName: 'Ship',
        lastName: 'Mail',
      });
      await addToCart(shipCookie, variantId, 1);
      const placed = await placeOrder(shipCookie);
      expect(placed.status).toBe(201);
      const placedId = placed.body.data.id as string;

      expect((await adminPatchStatus(placedId, 'CONFIRMED')).status).toBe(200);
      const created = await createShipment(placedId, placed.body.data.items[0].id);
      expect(created.status).toBe(201);

      const res = await api()
        .patch(`/v1/admin/orders/${placedId}/shipments/${created.body.data.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'SHIPPED', trackingNumber: 'DHL-M1-SHIPPED' });
      expect(res.status).toBe(200);

      const after = await api().get(`/v1/admin/orders/${placedId}`).set('Cookie', adminCookie);
      expect(after.body.data.status).toBe('SHIPPED');

      let log: { status: string } | null = null;
      for (let attempt = 0; attempt < 40 && !log; attempt += 1) {
        log = await prisma.notificationLog.findFirst({
          where: { templateCode: 'order.shipped', recipient },
          orderBy: { sentAt: 'desc' },
          select: { status: true },
        });
        if (!log) await new Promise((r) => setTimeout(r, 250));
      }

      expect(log).not.toBeNull();
    }, 90_000);
  });

  // ==========================================================================
  // SUITE 1c: Order status history (plan M, phase M2 - finding AD6)
  //   The customer timeline is a persisted record of every transition, not the
  //   placed-at timestamp repeated under whatever status the order holds now.
  // ==========================================================================

  describe('Order status history', () => {
    it('records every transition, in order, with its own timestamp', async () => {
      await addToCart(customerACookie, variantId, 1);
      const placed = await placeOrder(customerACookie);
      expect(placed.status).toBe(201);
      const id = placed.body.data.id as string;

      // The birth row ships with the create response, before any transition.
      expect(placed.body.data.statusHistory).toEqual([
        expect.objectContaining({ status: 'PENDING' }),
      ]);

      expect((await adminPatchStatus(id, 'CONFIRMED')).status).toBe(200);
      expect((await adminPatchStatus(id, 'CANCELLED')).status).toBe(200);

      const res = await api().get(`/v1/orders/${id}`).set('Cookie', customerACookie);
      expect(res.status).toBe(200);

      const history = res.body.data.statusHistory as Array<{ status: string; at: string }>;
      expect(history.map((e) => e.status)).toEqual(['PENDING', 'CONFIRMED', 'CANCELLED']);

      // Three distinct stamps, ascending. The bug this replaces showed one row
      // stamped with the placed time.
      const times = history.map((e) => new Date(e.at).getTime());
      expect(new Set(times).size).toBe(3);
      expect([...times]).toEqual([...times].sort((a, b) => a - b));

      // Only the two fields the timeline renders cross the wire.
      for (const entry of history) {
        expect(Object.keys(entry).sort()).toEqual(['at', 'status']);
      }
    });

    it('writes the row in the same transaction as the status it records', async () => {
      // A refused transition must leave no trace. SHIPPED is not reachable from
      // PENDING, so this one is rejected by the transition map.
      await addToCart(customerACookie, variantId, 1);
      const placed = await placeOrder(customerACookie);
      const id = placed.body.data.id as string;

      const refused = await adminPatchStatus(id, 'SHIPPED');
      expect(refused.status).toBe(400);

      const rows = await prisma.orderStatusHistory.findMany({ where: { orderId: id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].toStatus).toBe('PENDING');
    });

    it('gives a seeded order that predates the table a backfilled timeline', async () => {
      // The backfill is what every existing order relies on, and `db push` runs
      // no migration body, so it is the script that has to have run.
      const seeded = await prisma.order.findFirst({
        where: { orderNumber: { startsWith: 'ORD-' }, status: { not: 'PENDING' } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, createdAt: true },
      });
      // The seed plants four orders, three of them past PENDING.
      expect(seeded).not.toBeNull();

      const rows = await prisma.orderStatusHistory.findMany({
        where: { orderId: seeded!.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].toStatus).toBe('PENDING');
      expect(rows[0].fromStatus).toBeNull();
      expect(rows[rows.length - 1].toStatus).toBe(seeded!.status);
      // Never before the order existed.
      expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(seeded!.createdAt.getTime());
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 2: Stock Atomicity
  //   onHand decremented by ordered quantity; SALE movement recorded
  // ══════════════════════════════════════════════════════════════════════════

  describe('Stock atomicity', () => {
    let stockBefore: number;
    let placedOrderId: string;

    it('records onHand before order', async () => {
      const stock = await prisma.stockLevel.findFirst({
        where: { variantId, locationId },
      });
      expect(stock).not.toBeNull();
      stockBefore = stock!.onHand;
    });

    it('adds 3 units to cart and places order', async () => {
      await addToCart(customerACookie, variantId, 3);
      const res = await placeOrder(customerACookie);

      expect(res.status).toBe(201);
      placedOrderId = res.body.data.id;
    });

    it('StockLevel.onHand decremented by 3', async () => {
      const stock = await prisma.stockLevel.findFirst({
        where: { variantId, locationId },
      });
      expect(stock!.onHand).toBe(stockBefore - 3);
    });

    it('InventoryMovement with type=SALE and quantity=-3 recorded', async () => {
      const movement = await prisma.inventoryMovement.findFirst({
        where: { variantId, type: 'SALE', referenceType: 'Order' },
        orderBy: { createdAt: 'desc' },
      });

      expect(movement).not.toBeNull();
      expect(movement!.quantity).toBe(-3);
    });

    // Clean up so later suites have predictable stock
    afterAll(async () => {
      await adminPatchStatus(placedOrderId, 'CONFIRMED');
      // Leave at CONFIRMED (no stock restore) — stock levels already recorded
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 3: Idempotency
  //   Same X-Idempotency-Key returns same order — no duplicate in DB
  // ══════════════════════════════════════════════════════════════════════════

  describe('Idempotency', () => {
    const sharedKey = idemKey();
    let firstOrderId: string;

    it('places first order with sharedKey', async () => {
      await addToCart(customerACookie, variantId, 1);
      const res = await placeOrder(customerACookie, sharedKey);

      expect(res.status).toBe(201);
      firstOrderId = res.body.data.id;
    });

    it('retry with same key returns identical order ID (no cart needed)', async () => {
      // Cart was cleared after first order — idempotency must fire before cart validation
      const res = await placeOrder(customerACookie, sharedKey);

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(firstOrderId);
    });

    it('no duplicate order row in the database', async () => {
      const count = await prisma.order.count({ where: { idempotencyKey: sharedKey } });
      expect(count).toBe(1);
    });

    it('different key creates a new order', async () => {
      await addToCart(customerACookie, variantId, 1);
      const res = await placeOrder(customerACookie, idemKey());

      expect(res.status).toBe(201);
      expect(res.body.data.id).not.toBe(firstOrderId);
    });

    it('same key + different body → 409 IDEMPOTENCY_KEY_CONFLICT (audit §1.12)', async () => {
      // First request seeds the cache with a known body for this key.
      const key = idemKey();
      await addToCart(customerACookie, variantId, 1);
      const first = await placeOrder(customerACookie, key);
      expect(first.status).toBe(201);

      // Second request reuses the key but ships a different body — same
      // caller, fingerprint mismatch — must reject with 409, not return
      // the cached order.
      const res = await api()
        .post('/v1/orders')
        .set('Cookie', customerACookie)
        .set('X-Idempotency-Key', key)
        .send({
          shippingAddress: { ...SHIPPING_ADDRESS, city: 'Sousse' },
          billingAddress: SHIPPING_ADDRESS,
        });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    });

    it('same key + different caller → 403 IDEMPOTENCY_KEY_FORBIDDEN (audit §1.12)', async () => {
      // Customer A claims the key.
      const key = idemKey();
      await addToCart(customerACookie, variantId, 1);
      const first = await placeOrder(customerACookie, key);
      expect(first.status).toBe(201);

      // Customer B retries with the same key — must NOT receive A's order
      // and must NOT proceed with a fresh creation under A's key.
      await addToCart(customerBCookie, variantId, 1);
      const res = await placeOrder(customerBCookie, key);

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_FORBIDDEN');
    });

    it('malformed X-Idempotency-Key → 400 IDEMPOTENCY_KEY_MALFORMED', async () => {
      const res = await api()
        .post('/v1/orders')
        .set('Cookie', customerACookie)
        .set('X-Idempotency-Key', 'not-a-uuid')
        .send({ shippingAddress: SHIPPING_ADDRESS, billingAddress: SHIPPING_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_MALFORMED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 4: Cancellation — stock restored
  //   place → cancel → onHand back to pre-order level
  //   InventoryMovement type=ADJUSTMENT reason=RETURN_RESTOCK recorded
  // ══════════════════════════════════════════════════════════════════════════

  describe('Cancellation — stock restored', () => {
    let orderId: string;
    let stockBeforeOrder: number;
    let stockAfterOrder: number;

    it('records stock, adds 2 units, places order', async () => {
      const stock = await prisma.stockLevel.findFirst({ where: { variantId, locationId } });
      stockBeforeOrder = stock!.onHand;

      await addToCart(customerACookie, variantId, 2);
      const res = await placeOrder(customerACookie);

      expect(res.status).toBe(201);
      orderId = res.body.data.id;

      const stockNow = await prisma.stockLevel.findFirst({ where: { variantId, locationId } });
      stockAfterOrder = stockNow!.onHand;
      expect(stockAfterOrder).toBe(stockBeforeOrder - 2);
    });

    it('customer cancels PENDING order', async () => {
      const res = await api().post(`/v1/orders/${orderId}/cancel`).set('Cookie', customerACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('StockLevel.onHand restored after cancellation', async () => {
      const stock = await prisma.stockLevel.findFirst({ where: { variantId, locationId } });
      expect(stock!.onHand).toBe(stockAfterOrder + 2);
    });

    it('InventoryMovement type=ADJUSTMENT reason=CORRECTION recorded', async () => {
      const movement = await prisma.inventoryMovement.findFirst({
        where: {
          variantId,
          type: 'ADJUSTMENT',
          reason: 'CORRECTION',
          referenceType: 'OrderCancellation',
          referenceId: orderId,
        },
      });

      expect(movement).not.toBeNull();
      expect(movement!.quantity).toBe(2); // positive = stock back in
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 5: Pre-fulfillment edit — totals recalculated
  //   PENDING order + admin adds item → subtotal/total increase
  // ══════════════════════════════════════════════════════════════════════════

  describe('Pre-fulfillment edit — totals recalculated', () => {
    let orderId: string;
    let subtotalBefore: number;
    let totalBefore: number;

    it('places order with 1 unit of variantId (price=100)', async () => {
      await addToCart(customerACookie, variantId, 1);
      const res = await placeOrder(customerACookie);

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING');

      orderId = res.body.data.id;
      subtotalBefore = Number(res.body.data.subtotal);
      totalBefore = Number(res.body.data.total);
      expect(subtotalBefore).toBe(100);
    });

    it('admin adds 1 unit of variant2 (price=50) to PENDING order', async () => {
      const res = await api()
        .patch(`/v1/admin/orders/${orderId}`)
        .set('Cookie', adminCookie)
        .send({ addItems: [{ variantId: variant2Id, quantity: 1 }] });

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(2);
    });

    it('order subtotal increased by variant2 price (50)', async () => {
      const res = await api().get(`/v1/admin/orders/${orderId}`).set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      const subtotalAfter = Number(res.body.data.subtotal);
      const totalAfter = Number(res.body.data.total);

      expect(subtotalAfter).toBe(subtotalBefore + 50); // 100 + 50
      expect(totalAfter).toBeGreaterThan(totalBefore);
    });

    it('audit log records before/after snapshot', async () => {
      const log = await prisma.auditLogEntry.findFirst({
        where: { entityType: 'Order', entityId: orderId },
        orderBy: { createdAt: 'desc' },
      });

      expect(log).not.toBeNull();
      const changes = log!.changes as Record<string, unknown>;
      expect(changes).toHaveProperty('before');
      expect(changes).toHaveProperty('after');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 6: Customer isolation
  //   Customer B cannot read, cancel, or modify Customer A's orders
  // ══════════════════════════════════════════════════════════════════════════

  describe('Customer isolation', () => {
    let orderAId: string;

    it('customer A places an order', async () => {
      await addToCart(customerACookie, variantId, 1);
      const res = await placeOrder(customerACookie);

      expect(res.status).toBe(201);
      orderAId = res.body.data.id;
    });

    it('customer B GET /v1/orders/:id returns 403', async () => {
      const res = await api().get(`/v1/orders/${orderAId}`).set('Cookie', customerBCookie);

      expect(res.status).toBe(403);
    });

    it('customer B POST /v1/orders/:id/cancel returns 403', async () => {
      const res = await api().post(`/v1/orders/${orderAId}/cancel`).set('Cookie', customerBCookie);

      expect(res.status).toBe(403);
    });

    it('customer B GET /v1/orders — does NOT include customer A orders', async () => {
      const res = await api().get('/v1/orders').set('Cookie', customerBCookie);

      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((o) => o.id);
      expect(ids).not.toContain(orderAId);
    });

    it('admin can access customer A order via admin endpoint', async () => {
      const res = await api().get(`/v1/admin/orders/${orderAId}`).set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(orderAId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 7: API coverage
  //   Covers auth guards, validation, and remaining endpoints
  // ══════════════════════════════════════════════════════════════════════════

  describe('API coverage', () => {
    it('POST /v1/orders — 400 IDEMPOTENCY_KEY_REQUIRED when header is missing', async () => {
      const res = await api()
        .post('/v1/orders')
        .set('Cookie', customerACookie)
        .send({ shippingAddress: SHIPPING_ADDRESS });

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('GET /v1/admin/orders — 401 without auth token', async () => {
      const res = await api().get('/v1/admin/orders');
      expect(res.status).toBe(401);
    });

    it('GET /v1/admin/orders — lists all orders with pagination meta', async () => {
      const res = await api().get('/v1/admin/orders').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toHaveProperty('total');
      expect(res.body.meta).toHaveProperty('page');
      expect(res.body.meta).toHaveProperty('pageSize');
    });

    it('GET /v1/admin/orders?status=CANCELLED — returns only CANCELLED orders', async () => {
      const res = await api().get('/v1/admin/orders?status=CANCELLED').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      for (const order of res.body.data as { status: string }[]) {
        expect(order.status).toBe('CANCELLED');
      }
    });

    it('GET /v1/admin/orders/stats — returns summary fields', async () => {
      const res = await api().get('/v1/admin/orders/stats').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('totalOrders');
      expect(res.body.data).toHaveProperty('totalRevenue');
      expect(res.body.data).toHaveProperty('averageOrderValue');
    });

    it('GET /v1/admin/orders/export — returns CSV with header row', async () => {
      const res = await api().get('/v1/admin/orders/export').set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Order Number');
    });

    it('GET /v1/orders — lists authenticated customer orders', async () => {
      const res = await api().get('/v1/orders').set('Cookie', customerACookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toHaveProperty('total');
    });

    // ── Order numbering (finding AD13) ────────────────────────────────────
    //
    // The seed used to write four-digit numbers while the generator issued six,
    // so seeded and generated orders lived in different namespaces and the two
    // formats went unnoticed. They share one namespace now, which makes the
    // seed's sequence reservation load-bearing: without it the first order
    // placed on a freshly seeded database is handed a number that already
    // exists and dies on the unique index.
    //
    // Asserted as "past the seeded block" rather than as a literal
    // `ORD-YYYY-000005`. This database is long-lived and its sequence is
    // already far ahead; a literal would only be true on the first run after a
    // fresh seed and would then be a test that fails for being right.

    it('issues a number in the same format the seed writes', async () => {
      await addToCart(customerACookie, variantId, 1);
      const res = await placeOrder(customerACookie);
      expect(res.status).toBe(201);
      expect(res.body.data.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);
    });

    it('never reissues a number the seed already used', async () => {
      const SEEDED_THROUGH = 4;

      await addToCart(customerACookie, variantId, 1);
      const res = await placeOrder(customerACookie);
      expect(res.status).toBe(201);

      const orderNumber = res.body.data.orderNumber as string;
      const [, year, seq] = /^ORD-(\d{4})-(\d{6})$/.exec(orderNumber) ?? [];
      expect(year).toBe(String(new Date().getFullYear()));
      // Past the seeded block, so the two can never collide.
      expect(Number(seq)).toBeGreaterThan(SEEDED_THROUGH);
    });

    // ── POST /v1/orders/track ─────────────────────────────────────────────
    //
    // The lookup moved off `GET :orderNumber/track?email=` at plan M phase M3
    // (finding K10): the email is the shared secret that authorises this read
    // and a query string writes it to the access log, the `Referer` and the
    // browser history. The DTO now validates both halves.

    it('POST /v1/orders/track — 404 for a non-existent order number', async () => {
      const res = await api()
        .post('/v1/orders/track')
        .send({ orderNumber: 'AKL-NONEXISTENT', email: 'nobody@example.com' });
      expect(res.status).toBe(404);
    });

    it('POST /v1/orders/track — 200 with shipments and a real timeline', async () => {
      // Place a fresh order, then call the public track endpoint with the
      // owning customer's email. No bearer required (route is @Public()).
      await addToCart(customerACookie, variantId, 1);
      const placeRes = await placeOrder(customerACookie);
      expect(placeRes.status).toBe(201);
      const orderNumber = placeRes.body.data.orderNumber as string;
      expect(orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);

      // Better Auth normalises email to lowercase on sign-up; pass the same
      // normalised form so the service's exact-match comparison succeeds.
      const res = await api()
        .post('/v1/orders/track')
        .send({ orderNumber, email: `customera${TEST_SUFFIX}` });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('orderNumber', orderNumber);
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data.shipments).toBeInstanceOf(Array);
      // Finding K11 / AD6: the birth row is written with the order itself, so a
      // just-placed order already has one hop, not an empty list.
      expect(res.body.data.timeline).toBeInstanceOf(Array);
      expect(res.body.data.timeline.length).toBeGreaterThan(0);
      expect(res.body.data.timeline[0]).toEqual({
        status: 'PENDING',
        at: expect.any(String),
      });
      // The response must not echo the credential back, nor carry the internal
      // history columns.
      expect(JSON.stringify(res.body.data)).not.toContain(`customera${TEST_SUFFIX}`);
      expect(res.body.data.timeline[0]).not.toHaveProperty('fromStatus');
      expect(res.body.data.timeline[0]).not.toHaveProperty('orderId');
    });

    it('POST /v1/orders/track — 404 for an existing order with a wrong email', async () => {
      // No oracle: the same NotFound is returned for "no such order" and for
      // "wrong email", collapsed behind a single NotFoundException to defend
      // against enumeration per constitution §3.7.
      await addToCart(customerACookie, variantId, 1);
      const placeRes = await placeOrder(customerACookie);
      expect(placeRes.status).toBe(201);
      const orderNumber = placeRes.body.data.orderNumber as string;

      const res = await api()
        .post('/v1/orders/track')
        .send({ orderNumber, email: 'wrong@example.com' });
      expect(res.status).toBe(404);
    });

    it('GET /v1/orders/:orderNumber/track — the retired route is gone', async () => {
      // Not merely unused: leaving it mounted would keep writing customer
      // emails into the access log for anyone still calling it.
      const res = await api().get('/v1/orders/AKL-VALIDATE/track?email=nobody@example.com');
      expect(res.status).toBe(404);
    });

    // ── TrackOrderDto validation contract ─────────────────────────────────

    it.each([
      ['malformed email', { orderNumber: 'AKL-VALIDATE', email: 'not-an-email' }, 'email'],
      ['empty email', { orderNumber: 'AKL-VALIDATE', email: '' }, 'email'],
      ['missing email', { orderNumber: 'AKL-VALIDATE' }, 'email'],
      [
        'over-length email',
        { orderNumber: 'AKL-VALIDATE', email: `${'a'.repeat(246)}@e2e.test` },
        'email',
      ],
      ['missing order number', { email: 'nobody@example.com' }, 'orderNumber'],
      ['empty order number', { orderNumber: '', email: 'nobody@example.com' }, 'orderNumber'],
      [
        'lowercase order number',
        { orderNumber: 'akl-validate', email: 'nobody@example.com' },
        'orderNumber',
      ],
      [
        'order number with a quote',
        { orderNumber: "AKL'--", email: 'nobody@example.com' },
        'orderNumber',
      ],
      [
        'over-length order number',
        { orderNumber: 'O'.repeat(33), email: 'nobody@example.com' },
        'orderNumber',
      ],
    ])('POST /v1/orders/track — 400 VALIDATION_ERROR for %s', async (_name, body, field) => {
      const res = await api().post('/v1/orders/track').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
      expect(res.body.error?.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    });

    // ── GET /v1/orders/:id/invoice (storefront) ─────────────────────────────
    //
    // Validates the customer-facing invoice download. The endpoint requires
    // the order to be CONFIRMED (or later) so the invoice row exists; the
    // happy-path test confirms an order via the admin transition before
    // hitting the endpoint.
    describe('GET /v1/orders/:id/invoice', () => {
      let confirmedOrderId: string;
      let pendingOrderId: string;

      beforeAll(async () => {
        // Confirmed order — invoice should be auto-generated on transition.
        await addToCart(customerACookie, variantId, 1);
        const confirmedRes = await placeOrder(customerACookie);
        expect(confirmedRes.status).toBe(201);
        confirmedOrderId = confirmedRes.body.data.id;

        const transitionRes = await adminPatchStatus(confirmedOrderId, 'CONFIRMED');
        expect(transitionRes.status).toBe(200);

        // Pending order — invoice not yet generated, expect 404 on invoice GET.
        await addToCart(customerACookie, variantId, 1);
        const pendingRes = await placeOrder(customerACookie);
        expect(pendingRes.status).toBe(201);
        pendingOrderId = pendingRes.body.data.id;
      });

      it('200 — owner downloads the invoice for a CONFIRMED order', async () => {
        const res = await api()
          .get(`/v1/orders/${confirmedOrderId}/invoice`)
          .set('Cookie', customerACookie);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('invoiceNumber');
        expect(res.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
      });

      it('401 — anonymous request rejected by the auth guard', async () => {
        const res = await api().get(`/v1/orders/${confirmedOrderId}/invoice`);
        expect(res.status).toBe(401);
      });

      it('403 — non-owner authenticated request rejected by OwnerGuard', async () => {
        const res = await api()
          .get(`/v1/orders/${confirmedOrderId}/invoice`)
          .set('Cookie', customerBCookie);
        expect(res.status).toBe(403);
      });

      it('404 + ORDER_INVOICE_NOT_READY — owner GET on a PENDING order', async () => {
        const res = await api()
          .get(`/v1/orders/${pendingOrderId}/invoice`)
          .set('Cookie', customerACookie);
        expect(res.status).toBe(404);
        // B2 row #19: typed code disambiguates "invoice not yet generated"
        // from a generic "order not found" 404.
        expect(res.body.error?.code).toBe('ORDER_INVOICE_NOT_READY');
      });
    });

    // ── GET /v1/orders/:id/invoice/pdf + the admin twin ─────────────────────
    //
    // The bytes a customer actually receives. The JSON route above only proves
    // the invoice ROW exists; the PDF route renders it, caches it under a
    // locale-scoped private key, and re-checks ownership per download. Neither
    // route had e2e coverage here, and the admin twin had none anywhere.

    describe('GET /v1/orders/:id/invoice/pdf', () => {
      let pdfOrderId: string;
      let pendingPdfOrderId: string;
      let ordersStaffCookie: string;
      let otherStaffCookie: string;

      beforeAll(async () => {
        await createUserWithRole(prisma, {
          email: ORDERS_STAFF_EMAIL,
          password: TEST_PASSWORD,
          role: 'MANAGER',
          permissions: ['orders:view'],
          firstName: 'Orders',
          lastName: 'Staff',
        });
        ordersStaffCookie = await loginAs(ORDERS_STAFF_EMAIL, TEST_PASSWORD);

        await createUserWithRole(prisma, {
          email: OTHER_STAFF_EMAIL,
          password: TEST_PASSWORD,
          role: 'MANAGER',
          permissions: ['products:view'],
          firstName: 'Other',
          lastName: 'Staff',
        });
        otherStaffCookie = await loginAs(OTHER_STAFF_EMAIL, TEST_PASSWORD);

        await addToCart(customerACookie, variantId, 1);
        const placed = await placeOrder(customerACookie);
        expect(placed.status).toBe(201);
        pdfOrderId = placed.body.data.id;
        // CONFIRMED is what materialises the Invoice row the PDF renders from.
        expect((await adminPatchStatus(pdfOrderId, 'CONFIRMED')).status).toBe(200);

        await addToCart(customerACookie, variantId, 1);
        const pending = await placeOrder(customerACookie);
        expect(pending.status).toBe(201);
        pendingPdfOrderId = pending.body.data.id;
      });

      it.each(['fr', 'en'])('200 — owner downloads a real PDF (%s)', async (locale) => {
        const res = await api()
          .get(`/v1/orders/${pdfOrderId}/invoice/pdf`)
          .set('Cookie', customerACookie)
          .set('Accept-Language', locale)
          .buffer(true)
          .parse(binaryParser);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.headers['content-disposition']).toMatch(/INV-\d{4}-\d{6}\.pdf/);
        // Invoices are PII — no intermediary may hold them (§3.15-A).
        expect(res.headers['cache-control']).toContain('no-store');

        const buf = res.body as Buffer;
        expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(buf.length).toBeGreaterThan(3000);
      });

      it('200 — the cached object is served on a second download', async () => {
        const res = await api()
          .get(`/v1/orders/${pdfOrderId}/invoice/pdf`)
          .set('Cookie', customerACookie)
          .buffer(true)
          .parse(binaryParser);
        expect(res.status).toBe(200);
        expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      });

      it('403 — a different customer cannot download this order invoice', async () => {
        const res = await api()
          .get(`/v1/orders/${pdfOrderId}/invoice/pdf`)
          .set('Cookie', customerBCookie);
        expect(res.status).toBe(403);
      });

      it('404 + ORDER_INVOICE_NOT_READY — the order has no invoice yet', async () => {
        const res = await api()
          .get(`/v1/orders/${pendingPdfOrderId}/invoice/pdf`)
          .set('Cookie', customerACookie);
        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe('ORDER_INVOICE_NOT_READY');
      });

      it('401 — anonymous request on the customer route', async () => {
        const res = await api().get(`/v1/orders/${pdfOrderId}/invoice/pdf`);
        expect(res.status).toBe(401);
      });

      it('200 — the admin twin streams the PDF for staff carrying orders:view', async () => {
        const res = await api()
          .get(`/v1/admin/orders/${pdfOrderId}/invoice/pdf`)
          .set('Cookie', ordersStaffCookie)
          .buffer(true)
          .parse(binaryParser);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      });

      it('403 — the admin twin rejects staff without orders:view', async () => {
        const res = await api()
          .get(`/v1/admin/orders/${pdfOrderId}/invoice/pdf`)
          .set('Cookie', otherStaffCookie);
        expect(res.status).toBe(403);

        const customer = await api()
          .get(`/v1/admin/orders/${pdfOrderId}/invoice/pdf`)
          .set('Cookie', customerACookie);
        expect(customer.status).toBe(403);
      });

      it('401 — anonymous request on the admin route', async () => {
        const res = await api().get(`/v1/admin/orders/${pdfOrderId}/invoice/pdf`);
        expect(res.status).toBe(401);
      });

      it('404 + ORDER_INVOICE_NOT_READY — the admin twin on an order with no invoice', async () => {
        const res = await api()
          .get(`/v1/admin/orders/${pendingPdfOrderId}/invoice/pdf`)
          .set('Cookie', ordersStaffCookie);
        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe('ORDER_INVOICE_NOT_READY');
      });

      it('404 — the admin twin on an unknown order id', async () => {
        const res = await api()
          .get(`/v1/admin/orders/${randomUUID()}/invoice/pdf`)
          .set('Cookie', ordersStaffCookie);
        expect(res.status).toBe(404);
      });
    });

    it('PATCH /v1/admin/orders/:id/status — 400 for invalid status transition', async () => {
      // Place a PENDING order then try to go directly to DELIVERED (invalid)
      await addToCart(customerACookie, variantId, 1);
      const orderRes = await placeOrder(customerACookie);
      expect(orderRes.status).toBe(201);
      const oid = orderRes.body.data.id;

      const res = await adminPatchStatus(oid, 'DELIVERED');
      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE: Storefront error-contract (Full-Stack Audit plan §1.1 rows #6-8)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Storefront error contract', () => {
    it('POST /v1/orders on empty cart returns 400 + ORDER_CART_EMPTY', async () => {
      // CustomerB has no cart from prior tests (or it is empty after cleanup).
      // Ensure no items: place a unique idempotency key against an empty cart.
      // The validation gate at orders.service.ts:117 rejects before stock /
      // address resolution, so the cart-empty path is deterministic.
      // Better Auth normalises email to lowercase — use the normalised form for
      // Prisma queries so the WHERE clause matches the stored row.
      await prisma.cartItem.deleteMany({
        where: { cart: { user: { email: `customerb${TEST_SUFFIX}` } } },
      });

      const res = await placeOrder(customerBCookie);

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('ORDER_CART_EMPTY');
    });

    it('POST /v1/orders on out-of-stock cart returns 409 + ORDER_INSUFFICIENT_STOCK', async () => {
      // Force the variant out of stock so the pre-flight filter at
      // orders.service.ts:139 trips. cart.getCart() live-checks stock.available
      // from StockLevel.onHand — setting cartItem.inStock in the DB has no
      // effect because the service always recomputes from StockLevel.
      await addToCart(customerBCookie, variantId, 1);
      await prisma.stockLevel.updateMany({
        where: { variantId, locationId },
        data: { onHand: 0 },
      });

      const res = await placeOrder(customerBCookie);

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('ORDER_INSUFFICIENT_STOCK');

      // Restore stock for any later tests.
      await prisma.stockLevel.updateMany({
        where: { variantId, locationId },
        data: { onHand: 1000 },
      });
    });

    it('POST /v1/orders/:id/cancel on SHIPPED order returns 409 + ORDER_CANCEL_INELIGIBLE', async () => {
      // Place a fresh order then advance it past customer-cancellable states
      // via the admin status path. After SHIPPED, the customer cancel call
      // must trip the typed 409 (B2 row #18 — also flips the prior 400 status).
      // Better Auth normalises email to lowercase.
      await prisma.cartItem.updateMany({
        where: { cart: { user: { email: `customera${TEST_SUFFIX}` } }, variantId },
        data: { inStock: true },
      });
      await addToCart(customerACookie, variantId, 1);
      const placed = await placeOrder(customerACookie);
      expect(placed.status).toBe(201);
      const oid = placed.body.data.id;

      // Walk PENDING → CONFIRMED → PROCESSING → SHIPPED so the cancel endpoint
      // rejects on the customer-cancellable check.
      await adminPatchStatus(oid, 'CONFIRMED');
      await adminPatchStatus(oid, 'PROCESSING');
      await adminPatchStatus(oid, 'SHIPPED');

      const res = await api().post(`/v1/orders/${oid}/cancel`).set('Cookie', customerACookie);

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('ORDER_CANCEL_INELIGIBLE');
    });

    it('POST /v1/orders concurrent same key returns 201 + (cached-201 OR in-flight-409)', async () => {
      // Fire two POSTs in flight with the same idempotency key. The atomic
      // SET NX in IdempotencyService.beginRequest guarantees exactly one
      // wins. The other observes either the in-flight sentinel (409 with
      // code ORDER_IDEMPOTENCY_IN_PROGRESS) or the completed cache (201
      // with the same order id) depending on which raced past the
      // completeRequest write.
      await addToCart(customerACookie, variantId, 1);
      const sharedKey = idemKey();
      const [first, second] = await Promise.all([
        placeOrder(customerACookie, sharedKey),
        placeOrder(customerACookie, sharedKey),
      ]);

      // Deterministic: at least one POST must succeed (the winner).
      const successes = [first, second].filter((r) => r.status === 201);
      expect(successes.length).toBeGreaterThanOrEqual(1);
      const winnerOrderId = successes[0]!.body.data.id as string;
      expect(typeof winnerOrderId).toBe('string');

      const loser = [first, second].find((r) => r !== successes[0])!;
      // The loser is either a 409 in-flight or a 201 cached hit with the
      // SAME order id. No other shape is acceptable.
      if (loser.status === 409) {
        expect(loser.body.error?.code).toBe('ORDER_IDEMPOTENCY_IN_PROGRESS');
      } else {
        expect(loser.status).toBe(201);
        expect(loser.body.data.id).toBe(winnerOrderId);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE: Promotions usage — recordUsage FOR UPDATE lock contract
  //   Audit plan §1.11 + carry-forward gap from B2 / E1 phase logs.
  //   Pins the canonical promotion-usage path: order placement with a coupon
  //   creates exactly one PromotionUsage row under the pessimistic-lock guard
  //   at promotions.service.ts:314-358. The HTTP-visible failure when the
  //   usage limit is reached collapses to the COUPON_INVALID family code per
  //   §8.1 enumeration-mask (the underlying 'usage limit reached' message is
  //   not customer-facing). See DR-18.
  // ══════════════════════════════════════════════════════════════════════════

  describe('Promotions recordUsage lock contract', () => {
    let promotionId: string;
    const COUPON_CODE = `E2E-USAGE-${Date.now()}`;

    beforeAll(async () => {
      const promo = await prisma.promotion.create({
        data: {
          name: { default: 'E2E usage probe', fr: 'E2E usage probe', en: 'E2E usage probe' },
          type: 'PERCENTAGE',
          value: 10,
          couponCode: COUPON_CODE,
          applicationMethod: 'COUPON',
          minimumOrderAmount: 0,
          isActive: true,
          startsAt: new Date(Date.now() - 3600_000),
          endsAt: new Date(Date.now() + 24 * 3600_000),
        },
      });
      promotionId = promo.id;
    });

    afterAll(async () => {
      await prisma.promotionUsage.deleteMany({ where: { promotionId } });
      await prisma.promotion.deleteMany({ where: { id: promotionId } });
    });

    it('places order with coupon and creates exactly one PromotionUsage row', async () => {
      // Ensure customerA has clean state for this probe.
      // Better Auth normalises email to lowercase.
      await prisma.cartItem.deleteMany({
        where: { cart: { user: { email: `customera${TEST_SUFFIX}` } } },
      });
      await prisma.cartItem.updateMany({
        where: { cart: { user: { email: `customera${TEST_SUFFIX}` } }, variantId },
        data: { inStock: true },
      });

      await addToCart(customerACookie, variantId, 1);

      const apply = await api()
        .post('/v1/cart/coupon')
        .set('Cookie', customerACookie)
        .send({ code: COUPON_CODE });
      expect(apply.status).toBe(200);

      const placed = await placeOrder(customerACookie);
      expect(placed.status).toBe(201);

      const usages = await prisma.promotionUsage.findMany({ where: { promotionId } });
      expect(usages).toHaveLength(1);
      expect(usages[0].orderId).toBe(placed.body.data.id);
      expect(Number(usages[0].discountAmount)).toBeGreaterThan(0);
    });

    it('rejects coupon application with COUPON_INVALID when usageLimit is reached', async () => {
      // Tighten the promotion to usageLimit=1; the row created above is the
      // single allowed usage. A second customer attempting to apply must hit
      // the limit gate inside applyCoupon (validateCoupon → usage-limit check).
      await prisma.promotion.update({
        where: { id: promotionId },
        data: { usageLimit: 1 },
      });

      // Reset customerB cart state so the next add-to-cart is clean.
      await prisma.cartItem.deleteMany({
        where: { cart: { user: { email: `customerB${TEST_SUFFIX}` } } },
      });
      await prisma.cartItem.updateMany({
        where: { cart: { user: { email: `customerB${TEST_SUFFIX}` } }, variantId },
        data: { inStock: true },
      });
      await addToCart(customerBCookie, variantId, 1);

      const apply = await api()
        .post('/v1/cart/coupon')
        .set('Cookie', customerBCookie)
        .send({ code: COUPON_CODE });

      // §8.1 enumeration-mask: not-found, expired, usage-exceeded, and
      // exclusive-collision all collapse to one wire code.
      expect(apply.status).toBe(400);
      expect(apply.body.error?.code).toBe('COUPON_INVALID');
    });
  });
});
