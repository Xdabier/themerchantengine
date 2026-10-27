/**
 * Guest order placement and access (plan F phase F3, finding K3).
 *
 * `guestCheckoutEnabled` was stored, round-tripped by the admin, and read by
 * nobody: no public endpoint exposed it, the storefront bounced every
 * anonymous visitor to login, and `POST /v1/orders` required a session. Guest
 * checkout was impossible at the API design level rather than merely
 * unimplemented, because `Order` had no way to say who a user-less order
 * belonged to.
 *
 * This spec drives the whole anonymous flow across the wire: seed a cart on the
 * `sessionId` cookie, place an order with an idempotency key, read it back from
 * the same cookie jar, fail to read it from another, and track it by number and
 * email. Real dockerized DB per constitution §3.8, no mocks.
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  api,
  createTestPrisma,
  extractCookie,
  signUpCustomer,
  STORE_ADDRESS,
  STORE_SECONDARY_LOCALE,
} from './helpers';

const GUEST_ADDRESS = { ...STORE_ADDRESS, fullName: 'Amel Guest' };

interface OrderBody {
  id: string;
  orderNumber: string;
  guestEmail?: string;
  total: number;
  paymentMethodCode?: string | null;
}

function bodyOf(res: request.Response): OrderBody {
  return (res.body.data ?? res.body) as OrderBody;
}

/**
 * `IdempotencyKeyPipe` requires a UUID v4, so a descriptive string is rejected
 * with `IDEMPOTENCY_KEY_MALFORMED` before the handler ever runs.
 */
function idemKey(): string {
  return randomUUID();
}

function guestEmail(tag: string): string {
  return `f3-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
}

describe('guest checkout', () => {
  let prisma: PrismaClient;
  let variantIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    const rows = await prisma.productVariant.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        product: { status: 'ACTIVE', deletedAt: null },
        stockLevels: { some: { onHand: { gt: 5 } } },
      },
      select: { id: true },
      take: 10,
    });
    variantIds = rows.map((r) => r.id);
    if (variantIds.length === 0) {
      throw new Error('seeded catalogue must expose an in-stock variant');
    }
    await setGuestCheckout(true);
  });

  afterAll(async () => {
    await setGuestCheckout(true);
    if (createdOrderIds.length) {
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    await prisma.$disconnect();
  });

  /**
   * Flip the operator setting directly. The admin PATCH would need a staff
   * session and this is setup, not the thing under test.
   */
  async function setGuestCheckout(enabled: boolean): Promise<void> {
    await prisma.storeSetting.upsert({
      where: { group_key: { group: 'checkout', key: 'guestCheckoutEnabled' } },
      create: { group: 'checkout', key: 'guestCheckoutEnabled', value: enabled },
      update: { value: enabled },
    });
  }

  /**
   * One addable variant, resolved once.
   *
   * `POST /v1/cart/items` is `@RateLimit.StorefrontWrite()` — 30 requests a
   * minute — and the backend e2e runs with throttling ON. Probing ten variants
   * on every call burned that budget within a couple of tests, and the refusals
   * then read as "nothing is in stock", which is a much more alarming diagnosis
   * than the true one.
   */
  let addableVariantId: string | null = null;

  async function resolveAddableVariant(): Promise<string> {
    if (addableVariantId) return addableVariantId;
    for (const variantId of variantIds) {
      const res = await api().post('/v1/cart/items').send({ variantId, quantity: 1 });
      if ([200, 201].includes(res.status)) {
        addableVariantId = variantId;
        return variantId;
      }
    }
    throw new Error('no seeded variant could be added to an anonymous cart');
  }

  /** One add, with a single retry when the shared write budget is exhausted. */
  async function addOnce(variantId: string) {
    let res = await api().post('/v1/cart/items').send({ variantId, quantity: 1 });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      res = await api().post('/v1/cart/items').send({ variantId, quantity: 1 });
    }
    return res;
  }

  /** An anonymous cart holding one line, returning its `sessionId` cookie. */
  async function guestCart(): Promise<string> {
    const variantId = await resolveAddableVariant();
    const res = await addOnce(variantId);
    if (![200, 201].includes(res.status)) {
      throw new Error(`anonymous add failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const sessionId = extractCookie(res, 'sessionId');
    if (!sessionId) throw new Error('anonymous add must mint the sessionId cookie');
    return `sessionId=${sessionId}`;
  }

  async function placeGuestOrder(cookie: string, email: string): Promise<request.Response> {
    const res = await api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', idemKey())
      .set('Accept-Language', STORE_SECONDARY_LOCALE)
      .send({ guestEmail: email, shippingAddress: GUEST_ADDRESS });
    if (res.status === 201) createdOrderIds.push(bodyOf(res).id);
    return res;
  }

  // ── Placement ────────────────────────────────────────────────────────────

  it('lets an anonymous visitor place an order', async () => {
    const cookie = await guestCart();
    const email = guestEmail('place');
    const res = await placeGuestOrder(cookie, email);

    expect(res.status).toBe(201);
    const order = bodyOf(res);
    expect(order.orderNumber).toBeTruthy();
    expect(order.guestEmail).toBe(email);
  });

  /**
   * Plan F phase F5, findings K2 (payment half) and D2. The payment-methods
   * module was admin-only config nothing consumed, and the order row had no
   * column to record what the customer chose, so every order was an implicit
   * cash-on-delivery one whatever the operator had enabled.
   */
  it('snapshots the chosen payment method on the order', async () => {
    const enabled = await api()
      .get('/v1/checkout/settings')
      .set('Accept-Language', STORE_SECONDARY_LOCALE);
    expect(enabled.status).toBe(200);
    const methods = enabled.body.data.paymentMethods as { code: string; name: string }[];
    // The seed plants cash on delivery; without a tender the store cannot
    // take an order at all, which is the D2 rule this suite also pins below.
    expect(methods.length).toBeGreaterThan(0);

    const cookie = await guestCart();
    const res = await api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', idemKey())
      .set('Accept-Language', STORE_SECONDARY_LOCALE)
      .send({
        guestEmail: guestEmail('payment'),
        shippingAddress: GUEST_ADDRESS,
        paymentMethodCode: methods[0].code,
      });
    expect(res.status).toBe(201);
    createdOrderIds.push(bodyOf(res).id);

    const row = await prisma.order.findUnique({
      where: { id: bodyOf(res).id },
      select: { paymentMethodCode: true, paymentMethodName: true, paymentStatus: true },
    });
    expect(row?.paymentMethodCode).toBe(methods[0].code);
    // Resolved text, not a Translatable object: the column is plain text.
    expect(typeof row?.paymentMethodName).toBe('string');
    expect(row?.paymentMethodName).toBe(methods[0].name);
    // Reflecting a tender is not capturing one.
    expect(row?.paymentStatus).toBe('PENDING');
  });

  it('refuses a payment method the operator has not enabled', async () => {
    const cookie = await guestCart();
    const res = await api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', idemKey())
      .send({
        guestEmail: guestEmail('badpayment'),
        shippingAddress: GUEST_ADDRESS,
        paymentMethodCode: 'not-a-configured-tender',
      });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('ORDER_PAYMENT_METHOD_INVALID');
  });

  it('records the guest identity on the row and leaves userId null', async () => {
    const cookie = await guestCart();
    const email = guestEmail('identity');
    const res = await placeGuestOrder(cookie, email);
    expect(res.status).toBe(201);

    const row = await prisma.order.findUnique({
      where: { id: bodyOf(res).id },
      select: { userId: true, guestEmail: true, guestSessionId: true, guestLocale: true },
    });
    expect(row?.userId).toBeNull();
    expect(row?.guestEmail).toBe(email);
    expect(row?.guestSessionId).toBe(cookie.split('=')[1]);
    expect(row?.guestLocale).toBe(STORE_SECONDARY_LOCALE);
  });

  it('never puts the session id in the response body', async () => {
    // It is the bearer credential for the order: anything holding it can read
    // the order back.
    const cookie = await guestCart();
    const res = await placeGuestOrder(cookie, guestEmail('secret'));
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain(cookie.split('=')[1]);
    expect(bodyOf(res)).not.toHaveProperty('guestSessionId');
  });

  it('clears the guest cart, so the next visit does not re-buy it', async () => {
    const cookie = await guestCart();
    const res = await placeGuestOrder(cookie, guestEmail('clear'));
    expect(res.status).toBe(201);

    const cart = await api().get('/v1/cart').set('Cookie', cookie).expect(200);
    expect((cart.body.data ?? cart.body).itemCount).toBe(0);
  });

  it('replays an idempotency key to the same order rather than billing twice', async () => {
    const cookie = await guestCart();
    const key = idemKey();
    const payload = { guestEmail: guestEmail('replay'), shippingAddress: GUEST_ADDRESS };

    const first = await api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', key)
      .send(payload);
    expect(first.status).toBe(201);
    createdOrderIds.push(bodyOf(first).id);

    const second = await api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', key)
      .send(payload);
    expect(second.status).toBe(201);
    expect(bodyOf(second).id).toBe(bodyOf(first).id);
  });

  // ── Refusals ─────────────────────────────────────────────────────────────

  it('refuses an anonymous order with no contact email', async () => {
    const cookie = await guestCart();
    const res = await api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', idemKey())
      .send({ shippingAddress: GUEST_ADDRESS });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORDER_GUEST_EMAIL_REQUIRED');
  });

  it('refuses an anonymous order with no inline address', async () => {
    const cookie = await guestCart();
    const res = await api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', idemKey())
      .send({ guestEmail: guestEmail('noaddr'), shippingAddressId: 'someone-elses-address' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORDER_GUEST_ADDRESS_REQUIRED');
  });

  it('refuses an anonymous order while the operator has guest checkout off', async () => {
    const cookie = await guestCart();
    await setGuestCheckout(false);
    try {
      const res = await api()
        .post('/v1/orders')
        .set('Cookie', cookie)
        .set('X-Idempotency-Key', idemKey())
        .send({ guestEmail: guestEmail('flagoff'), shippingAddress: GUEST_ADDRESS });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORDER_GUEST_CHECKOUT_DISABLED');
    } finally {
      await setGuestCheckout(true);
    }
  });

  it('still lets a signed-in customer order while guest checkout is off', async () => {
    // The flag gates guests only. This is the regression that matters most:
    // an operator turning guest checkout off must not close the shop.
    await setGuestCheckout(false);
    try {
      const auth = await signUpCustomer(prisma, guestEmail('authed-flagoff'), 'Atlas-Test-123!', {
        firstName: 'Flag',
        lastName: 'Off',
      });
      const variantId = await resolveAddableVariant();
      await api().post('/v1/cart/items').set('Cookie', auth).send({ variantId, quantity: 1 });
      const res = await api()
        .post('/v1/orders')
        .set('Cookie', auth)
        .set('X-Idempotency-Key', idemKey())
        .send({ shippingAddress: GUEST_ADDRESS });
      expect(res.status).toBe(201);
      createdOrderIds.push(bodyOf(res).id);
    } finally {
      await setGuestCheckout(true);
    }
  });

  // ── Access ───────────────────────────────────────────────────────────────

  it('lets the same browser read the order back', async () => {
    const cookie = await guestCart();
    const res = await placeGuestOrder(cookie, guestEmail('read'));
    expect(res.status).toBe(201);

    const detail = await api()
      .get(`/v1/orders/${bodyOf(res).id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(bodyOf(detail).orderNumber).toBe(bodyOf(res).orderNumber);
  });

  it('refuses a cookieless reader', async () => {
    const cookie = await guestCart();
    const res = await placeGuestOrder(cookie, guestEmail('nocookie'));
    expect(res.status).toBe(201);

    const detail = await api().get(`/v1/orders/${bodyOf(res).id}`);
    expect(detail.status).toBeGreaterThanOrEqual(400);
    expect(detail.status).toBeLessThan(500);
  });

  it('refuses a different browser', async () => {
    const cookie = await guestCart();
    const res = await placeGuestOrder(cookie, guestEmail('othercookie'));
    expect(res.status).toBe(201);

    const other = await guestCart();
    const detail = await api()
      .get(`/v1/orders/${bodyOf(res).id}`)
      .set('Cookie', other);
    expect(detail.status).toBeGreaterThanOrEqual(400);
    expect(detail.status).toBeLessThan(500);
  });

  it('refuses a signed-in customer reading a guest order they did not place', async () => {
    const cookie = await guestCart();
    const res = await placeGuestOrder(cookie, guestEmail('notyours'));
    expect(res.status).toBe(201);

    const auth = await signUpCustomer(prisma, guestEmail('snooper'), 'Atlas-Test-123!', {
      firstName: 'Snoop',
      lastName: 'Er',
    });
    const detail = await api()
      .get(`/v1/orders/${bodyOf(res).id}`)
      .set('Cookie', auth);
    expect(detail.status).toBeGreaterThanOrEqual(400);
    expect(detail.status).toBeLessThan(500);
  });

  // ── Claiming on sign-in ──────────────────────────────────────────────────

  it('moves the guest order onto the account when the guest signs in', async () => {
    // The canonical flow, and the one that used to destroy the customer's
    // access: pay as a guest, then make an account to follow the order. The
    // merge clears the `sessionId` cookie, which is the only key to that order.
    const cookie = await guestCart();
    const placed = await placeGuestOrder(cookie, guestEmail('claim'));
    expect(placed.status).toBe(201);
    const orderId = bodyOf(placed).id;

    const auth = await signUpCustomer(prisma, guestEmail('claimer'), 'Atlas-Test-123!', {
      firstName: 'Claim',
      lastName: 'Er',
    });

    await api().post('/v1/cart/merge').set('Cookie', `${auth}; ${cookie}`).expect(200);

    // Readable as the account, with no cart cookie in play at all.
    const detail = await api().get(`/v1/orders/${orderId}`).set('Cookie', auth).expect(200);
    expect(bodyOf(detail).orderNumber).toBe(bodyOf(placed).orderNumber);

    // And it is in their order list, which a guest order never was.
    const list = await api().get('/v1/orders').set('Cookie', auth).expect(200);
    const ids = ((list.body.data ?? []) as { id: string }[]).map((o) => o.id);
    expect(ids).toContain(orderId);

    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { guestSessionId: true, guestEmail: true },
    });
    // The credential is spent, the contact address is kept.
    expect(row?.guestSessionId).toBeNull();
    expect(row?.guestEmail).toBeTruthy();
  });

  it('never lets a sign-in adopt an order placed in a different session', async () => {
    const victimCookie = await guestCart();
    const victim = await placeGuestOrder(victimCookie, guestEmail('victim'));
    expect(victim.status).toBe(201);

    const attackerCookie = await guestCart();
    const auth = await signUpCustomer(prisma, guestEmail('attacker'), 'Atlas-Test-123!', {
      firstName: 'Att',
      lastName: 'Acker',
    });
    await api().post('/v1/cart/merge').set('Cookie', `${auth}; ${attackerCookie}`).expect(200);

    const detail = await api()
      .get(`/v1/orders/${bodyOf(victim).id}`)
      .set('Cookie', auth);
    expect(detail.status).toBe(404);

    const row = await prisma.order.findUnique({
      where: { id: bodyOf(victim).id },
      select: { userId: true },
    });
    expect(row?.userId).toBeNull();
  });

  // ── Credential hygiene ───────────────────────────────────────────────────

  it('mints a session id that is not guessable from the clock', async () => {
    // It is the only key to a placed order. It used to be
    // `sess_${Date.now()}_${Math.random()}`.
    const first = (await guestCart()).split('=')[1];
    const second = (await guestCart()).split('=')[1];
    expect(first).not.toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(first).not.toContain(String(Date.now()).slice(0, 8));

    let shared = 0;
    while (shared < first.length && first[shared] === second[shared]) shared++;
    expect(shared).toBeLessThan(4);
  });

  // ── Tracking ─────────────────────────────────────────────────────────────

  it('tracks a guest order by number and email', async () => {
    const cookie = await guestCart();
    const email = guestEmail('track');
    const res = await placeGuestOrder(cookie, email);
    expect(res.status).toBe(201);

    // A POST body, not a query string: the email is the shared secret that
    // authorises this read (plan M phase M3, finding K10).
    const tracked = await api()
      .post('/v1/orders/track')
      .send({ orderNumber: bodyOf(res).orderNumber, email })
      .expect(200);
    expect((tracked.body.data ?? tracked.body).orderNumber).toBe(bodyOf(res).orderNumber);
  });

  it('matches the track email case-insensitively', async () => {
    const cookie = await guestCart();
    const email = guestEmail('trackcase');
    const res = await placeGuestOrder(cookie, email);
    expect(res.status).toBe(201);

    await api()
      .post('/v1/orders/track')
      .send({ orderNumber: bodyOf(res).orderNumber, email: email.toUpperCase() })
      .expect(200);
  });

  it('refuses tracking with the wrong email', async () => {
    const cookie = await guestCart();
    const res = await placeGuestOrder(cookie, guestEmail('trackwrong'));
    expect(res.status).toBe(201);

    const tracked = await api()
      .post('/v1/orders/track')
      .send({ orderNumber: bodyOf(res).orderNumber, email: 'someone@else.test' });
    expect(tracked.status).toBe(404);
  });
});
