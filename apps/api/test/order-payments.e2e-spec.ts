/**
 * Order payment wiring end to end (DR-34, plan phase OS4).
 *
 * A COD checkout opens a payment session, the admin payment actions move the
 * status through the provider, and the inbound webhook door rejects an unknown
 * provider and an offline provider. A signed Stripe event moves the order once,
 * and a replay of the same event is deduped (OS5.9).
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import {
  api,
  createTestPrisma,
  signUpCustomer,
  loginAs,
  ADMIN,
  STORE_ADDRESS,
} from '../../../test/e2e/helpers';
import { E2E_STRIPE_WEBHOOK_SECRET } from '../../../test/e2e/env';

const TEST_SUFFIX = '@e2e-order-payments.test';
const TEST_PASSWORD = 'StrongPass1!';
const METHOD_CODE = 'e2e_os4_cod';
const STRIPE_METHOD_CODE = 'e2e_os5_stripe';
const EVENT_PREFIX = 'evt_e2e_os5_';
const SLUG_PREFIX = 'e2e-orderpay-';
const SHIPPING_ADDRESS = { ...STORE_ADDRESS, fullName: 'Test User' };

describe('Order payments (e2e)', () => {
  let prisma: PrismaClient;
  let customerCookie: string;
  let adminCookie: string;
  let variantId: string;

  async function cleanup() {
    const ownOrders = { order: { user: { email: { endsWith: TEST_SUFFIX } } } };
    await prisma.inventoryMovement.deleteMany({
      where: { variant: { product: { slug: { startsWith: SLUG_PREFIX } } } },
    });
    await prisma.orderItem.deleteMany({ where: ownOrders });
    await prisma.invoice.deleteMany({ where: ownOrders });
    await prisma.shipment.deleteMany({ where: ownOrders });
    await prisma.orderStatusHistory.deleteMany({ where: ownOrders });
    const orderIds = (
      await prisma.order.findMany({
        where: { user: { email: { endsWith: TEST_SUFFIX } } },
        select: { id: true },
      })
    ).map((o) => o.id);
    await prisma.auditLogEntry.deleteMany({
      where: { entityType: 'Order', entityId: { in: orderIds } },
    });
    await prisma.processedWebhook.deleteMany({
      where: { externalEventId: { startsWith: EVENT_PREFIX } },
    });
    await prisma.order.deleteMany({ where: { user: { email: { endsWith: TEST_SUFFIX } } } });
    await prisma.cartItem.deleteMany({
      where: { cart: { user: { email: { endsWith: TEST_SUFFIX } } } },
    });
    await prisma.cart.deleteMany({ where: { user: { email: { endsWith: TEST_SUFFIX } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.paymentMethod.deleteMany({
      where: { code: { in: [METHOD_CODE, STRIPE_METHOD_CODE] } },
    });
  }

  async function placeCodOrder(): Promise<{ id: string; paymentStatus: string }> {
    const cart = await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 });
    expect(cart.status).toBe(200);

    const res = await api()
      .post('/v1/orders')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', randomUUID())
      .send({
        shippingAddress: SHIPPING_ADDRESS,
        billingAddress: SHIPPING_ADDRESS,
        paymentMethodCode: METHOD_CODE,
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  function paymentAction(orderId: string, action: string, key?: string) {
    const req = api()
      .post(`/v1/admin/orders/${orderId}/payment/${action}`)
      .set('Cookie', adminCookie);
    return key ? req.set('X-Idempotency-Key', key) : req;
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanup();

    await prisma.paymentMethod.create({
      data: {
        code: METHOD_CODE,
        name: { default: 'Cash on delivery' },
        provider: 'cod',
        isActive: true,
        sortOrder: 0,
      },
    });

    let location = await prisma.inventoryLocation.findFirst({ where: { isActive: true } });
    if (!location) {
      location = await prisma.inventoryLocation.create({
        data: { name: 'Default', code: 'DEF-OPAY', isActive: true },
      });
    }

    const timestamp = Date.now();
    const product = await prisma.product.create({
      data: {
        name: { default: 'E2E Payment Widget', fr: 'E2E Payment Widget', en: 'E2E Payment Widget' },
        slug: `${SLUG_PREFIX}${timestamp}`,
        description: { default: 'Payments E2E product', fr: 'Payments E2E product', en: 'Payments E2E product' },
        status: 'ACTIVE',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `E2E-OPAY-${timestamp}`,
        price: 100,
        weight: 0.5,
        isActive: true,
      },
    });
    variantId = variant.id;
    await prisma.stockLevel.create({
      data: { variantId, locationId: location.id, onHand: 100, reserved: 0 },
    });

    customerCookie = await signUpCustomer(prisma, `payer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Pat',
      lastName: 'Payments',
    });
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('COD checkout', () => {
    it('opens a pending session and stores the provider reference', async () => {
      const order = await placeCodOrder();
      expect(order.paymentStatus).toBe('PENDING');

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { paymentMethodCode: true, paymentReference: true, paymentStatus: true },
      });
      expect(row.paymentMethodCode).toBe(METHOD_CODE);
      expect(row.paymentReference).toBe(`cod_${order.id}`);
      expect(row.paymentStatus).toBe('PENDING');
    });
  });

  describe('Admin payment actions', () => {
    let orderId: string;

    beforeAll(async () => {
      orderId = (await placeCodOrder()).id;
    });

    it('rejects a capture without an idempotency key', async () => {
      const res = await paymentAction(orderId, 'capture');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('refuses to refund a payment that was never captured', async () => {
      const res = await paymentAction(orderId, 'refund', randomUUID());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_TRANSITION_NOT_ALLOWED');
      expect(res.body.error.details).toMatchObject({ providerId: 'cod', from: 'PENDING' });
    });

    it('captures, then replays the same key without a second transition', async () => {
      const key = randomUUID();
      const first = await paymentAction(orderId, 'capture', key);
      expect(first.status).toBe(200);
      expect(first.body.data.paymentStatus).toBe('CAPTURED');

      const replay = await paymentAction(orderId, 'capture', key);
      expect(replay.status).toBe(200);
      expect(replay.body.data.paymentStatus).toBe('CAPTURED');
      expect(replay.body.data.id).toBe(orderId);
    });

    it('refuses a second capture under a new key', async () => {
      const res = await paymentAction(orderId, 'capture', randomUUID());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_TRANSITION_NOT_ALLOWED');
    });

    it('refunds the captured payment in full', async () => {
      const res = await paymentAction(orderId, 'refund', randomUUID());
      expect(res.status).toBe(200);
      expect(res.body.data.paymentStatus).toBe('REFUNDED');

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { paymentStatus: true },
      });
      expect(row.paymentStatus).toBe('REFUNDED');
    });

    it('cancels a pending payment', async () => {
      const pending = await placeCodOrder();
      const res = await paymentAction(pending.id, 'cancel', randomUUID());
      expect(res.status).toBe(200);
      expect(res.body.data.paymentStatus).toBe('CANCELLED');
    });

    it('returns 404 for an unknown order', async () => {
      const res = await paymentAction(randomUUID(), 'capture', randomUUID());
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('is admin only', async () => {
      const res = await api()
        .post(`/v1/admin/orders/${orderId}/payment/capture`)
        .set('Cookie', customerCookie)
        .set('X-Idempotency-Key', randomUUID());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_PERMISSION_INSUFFICIENT');
    });
  });

  describe('POST /v1/webhooks/payments/:providerId', () => {
    it('rejects a provider that is not registered', async () => {
      const res = await api()
        .post('/v1/webhooks/payments/paypal')
        .set('Content-Type', 'application/json')
        .send({ id: 'evt_1' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_PROVIDER_UNKNOWN');
    });

    it('rejects a webhook for an offline provider', async () => {
      const res = await api()
        .post('/v1/webhooks/payments/cod')
        .set('Content-Type', 'application/json')
        .send({ id: 'evt_1' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_WEBHOOK_UNSUPPORTED');
    });

    it('leaves the order untouched after a rejected webhook', async () => {
      const order = await placeCodOrder();
      const res = await api()
        .post('/v1/webhooks/payments/cod')
        .set('Content-Type', 'application/json')
        .send({ reference: `cod_${order.id}`, status: 'CAPTURED' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_WEBHOOK_UNSUPPORTED');

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { paymentStatus: true },
      });
      expect(row.paymentStatus).toBe('PENDING');
    });

    describe('signed Stripe event', () => {
      let orderId: string;
      let reference: string;

      function stripeEvent(eventId: string) {
        return JSON.stringify({
          id: eventId,
          object: 'event',
          type: 'payment_intent.amount_capturable_updated',
          data: { object: { id: reference, object: 'payment_intent' } },
        });
      }

      function postStripe(payload: string, signature: string) {
        return api()
          .post('/v1/webhooks/payments/stripe')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', signature)
          .send(payload);
      }

      const sign = (payload: string) =>
        Stripe.webhooks.generateTestHeaderString({ payload, secret: E2E_STRIPE_WEBHOOK_SECRET });

      async function paymentStatus() {
        const row = await prisma.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { paymentStatus: true },
        });
        return row.paymentStatus;
      }

      beforeAll(async () => {
        await prisma.paymentMethod.create({
          data: {
            code: STRIPE_METHOD_CODE,
            name: { default: 'Card' },
            provider: 'stripe',
            config: {},
            isActive: true,
            sortOrder: 1,
          },
        });
        orderId = (await placeCodOrder()).id;
        reference = `pi_e2e_${orderId}`;
        await prisma.order.update({
          where: { id: orderId },
          data: {
            paymentMethodCode: STRIPE_METHOD_CODE,
            paymentReference: reference,
            paymentStatus: 'PENDING',
          },
        });
      });

      it('rejects a bad signature and leaves the order untouched', async () => {
        const payload = stripeEvent(`${EVENT_PREFIX}${randomUUID()}`);
        const res = await postStripe(payload, 't=1,v1=deadbeef');
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('PAYMENT_WEBHOOK_SIGNATURE_INVALID');
        expect(await paymentStatus()).toBe('PENDING');
      });

      it('moves the order once and dedups a replay of the same event', async () => {
        const payload = stripeEvent(`${EVENT_PREFIX}${randomUUID()}`);

        const first = await postStripe(payload, sign(payload));
        expect(first.status).toBe(200);
        expect(first.body.data.replay).toBe(false);
        expect(await paymentStatus()).toBe('AUTHORIZED');

        const replay = await postStripe(payload, sign(payload));
        expect(replay.status).toBe(200);
        expect(replay.body.data.replay).toBe(true);
        expect(await paymentStatus()).toBe('AUTHORIZED');

        const audits = await prisma.auditLogEntry.count({
          where: { action: 'order.payment_webhook', entityType: 'Order', entityId: orderId },
        });
        expect(audits).toBe(1);
      });
    });
  });
});
