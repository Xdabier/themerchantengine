import { PrismaClient } from '@prisma/client';
import { api, signUpCustomer, createTestPrisma, STORE_CURRENCY } from '../../../test/e2e/helpers';
import { SESSION_COOKIE_NAME } from '../src/modules/cart/cart.constants';

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-cart.test';
const TEST_PASSWORD = 'StrongPass1!';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Cart (e2e)', () => {
  let prisma: PrismaClient;

  let customerCookie: string;
  let variantId: string;
  let variant2Id: string;
  let sessionCookie: string;
  let addedItemId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Cleanup previous runs ─────────────────────────────────────────────────
    // Delete cartItems referencing E2E variants first (covers both authed carts
    // and anonymous session carts that share the same E2E-SKU variants — the
    // anonymous carts have no user FK so the user-filter below misses them).
    await prisma.cartItem.deleteMany({
      where: { variant: { sku: { startsWith: 'E2E-CART-' } } },
    });
    await prisma.cartItem.deleteMany({
      where: { cart: { user: { email: { endsWith: TEST_SUFFIX } } } },
    });
    await prisma.cart.deleteMany({
      where: { user: { email: { endsWith: TEST_SUFFIX } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });

    // ── Seed: product + variant ───────────────────────────────────────────────
    const product = await prisma.product.create({
      data: {
        // Deliberately different per locale, with the French string as the
        // default. `addItem` snapshots `name.default`, so a fixture whose
        // three values are identical cannot tell a resolved name from a
        // snapshot and the locale test below would pass either way.
        name: { default: 'Bidule E2E', fr: 'Bidule E2E', en: 'E2E Widget' },
        slug: `e2e-widget-cart-${Date.now()}`,
        description: {
          default: 'Test product for cart E2E',
          fr: 'Test product for cart E2E',
          en: 'Test product for cart E2E',
        },
        status: 'ACTIVE',
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `E2E-CART-V1-${Date.now()}`,
        price: 50,
        weight: 0.5,
        isActive: true,
      },
    });
    variantId = variant.id;

    const variant2 = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `E2E-CART-V2-${Date.now()}`,
        price: 30,
        weight: 0.3,
        isActive: true,
      },
    });
    variant2Id = variant2.id;

    // Seed stock
    const location = await prisma.inventoryLocation.findFirst({ where: { isActive: true } });
    if (location) {
      await prisma.stockLevel.createMany({
        data: [
          { variantId: variant.id, locationId: location.id, onHand: 50, reserved: 0 },
          { variantId: variant2.id, locationId: location.id, onHand: 50, reserved: 0 },
        ],
        skipDuplicates: true,
      });
    }

    // ── Auth: customer session ────────────────────────────────────────────────
    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Cart',
      lastName: 'Tester',
    });
  });

  afterAll(async () => {
    // Cleanup: delete cartItems referencing E2E variants first to satisfy the
    // CartItem_variantId_fkey constraint — covers anonymous session carts whose
    // items are not reachable via the user-email filter below.
    await prisma.cartItem.deleteMany({
      where: { variant: { sku: { startsWith: 'E2E-CART-' } } },
    });
    await prisma.cartItem.deleteMany({
      where: { cart: { user: { email: { endsWith: TEST_SUFFIX } } } },
    });
    await prisma.cart.deleteMany({
      where: { user: { email: { endsWith: TEST_SUFFIX } } },
    });
    await prisma.productVariant.deleteMany({
      where: { sku: { startsWith: 'E2E-CART-' } },
    });
    await prisma.product.deleteMany({ where: { slug: { startsWith: 'e2e-widget-cart-' } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── Line names follow the request locale ─────────────────────────────────

  describe('line names follow the request locale', () => {
    let localeCookie: string;

    beforeAll(async () => {
      // Add under French, which is what a shopper browsing /fr does.
      const res = await api()
        .post('/v1/cart/items')
        .set('Accept-Language', 'fr')
        .send({ variantId, quantity: 1 });
      expect([200, 201]).toContain(res.status);
      const setCookieHeader = res.headers['set-cookie'] as string[] | string | undefined;
      const cookieHeader = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
      const match = cookieHeader?.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      localeCookie = match ? `${SESSION_COOKIE_NAME}=${match[1]}` : '';
      expect(localeCookie).toBeTruthy();
    });

    afterAll(async () => {
      await api().delete('/v1/cart').set('Cookie', localeCookie);
    });

    it('returns the French name under Accept-Language: fr', async () => {
      const res = await api()
        .get('/v1/cart')
        .set('Cookie', localeCookie)
        .set('Accept-Language', 'fr')
        .expect(200);
      expect(res.body.data.items[0].productName).toBe('Bidule E2E');
    });

    it('returns the English name under Accept-Language: en for the same cart', async () => {
      // `addItem` snapshots `name.default` into `CartItem.productName`, and
      // `getCart` used to return that snapshot verbatim. On a catalogue whose
      // default value is the French string, that meant /en showed French line
      // names for a product whose English name the API already had loaded.
      const res = await api()
        .get('/v1/cart')
        .set('Cookie', localeCookie)
        .set('Accept-Language', 'en')
        .expect(200);
      expect(res.body.data.items[0].productName).toBe('E2E Widget');
    });
  });

  // ── 1. GET /v1/cart — empty for new user ─────────────────────────────────

  it('1. GET /v1/cart returns empty cart for new user', async () => {
    const res = await api().get('/v1/cart').set('Cookie', customerCookie).expect(200);

    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.subtotal).toBe(0);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.couponCode).toBeNull();
  });

  // ── 2. POST /v1/cart/items — add item ────────────────────────────────────

  it('2. POST /v1/cart/items adds a variant to cart', async () => {
    const res = await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 2 })
      .expect(200);

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].variantId).toBe(variantId);
    expect(res.body.data.items[0].quantity).toBe(2);
    expect(res.body.data.subtotal).toBe(100); // 2 × 50
    addedItemId = res.body.data.items[0].id;
  });

  // ── 3. PATCH /v1/cart/items/:itemId — update quantity ────────────────────

  it('3. PATCH /v1/cart/items/:itemId updates quantity', async () => {
    const res = await api()
      .patch(`/v1/cart/items/${addedItemId}`)
      .set('Cookie', customerCookie)
      .send({ quantity: 3 })
      .expect(200);

    expect(res.body.data.items[0].quantity).toBe(3);
    expect(res.body.data.subtotal).toBe(150); // 3 × 50
  });

  // ── 4. POST /v1/cart/items — add second item ──────────────────────────────

  it('4. POST /v1/cart/items adds a second variant', async () => {
    const res = await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId: variant2Id, quantity: 1 })
      .expect(200);

    expect(res.body.data.items).toHaveLength(2);
    // subtotal = 3×50 + 1×30 = 180
    expect(res.body.data.subtotal).toBe(180);
  });

  // ── 5. Anonymous cart with session cookie ────────────────────────────────

  it('5. POST /v1/cart/items works without auth (anonymous session)', async () => {
    const res = await api().post('/v1/cart/items').send({ variantId, quantity: 1 }).expect(200);

    expect(res.body.data.items).toHaveLength(1);

    // Extract the session cookie
    const setCookieHeader = res.headers['set-cookie'] as string[] | string | undefined;
    const cookieHeader = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      sessionCookie = match ? `${SESSION_COOKIE_NAME}=${match[1]}` : '';
    }
  });

  // ── 6. Anonymous GET uses same session ────────────────────────────────────

  it('6. GET /v1/cart with session cookie returns the anonymous cart', async () => {
    if (!sessionCookie) return; // skip if cookie not captured

    const res = await api().get('/v1/cart').set('Cookie', sessionCookie).expect(200);

    expect(res.body.data.items).toHaveLength(1);
  });

  // ── 7. GET /v1/cart/estimate — shipping estimate ──────────────────────────

  it('7. GET /v1/cart/estimate returns rates (may be empty if no zone configured)', async () => {
    const res = await api()
      .get('/v1/cart/estimate')
      .set('Cookie', customerCookie)
      .query({ country: 'US' })
      .expect(200);

    expect(res.body.data).toHaveProperty('rates');
    expect(Array.isArray(res.body.data.rates)).toBe(true);
  });

  // ── 8. POST /v1/cart/gift-card — validate gift card ──────────────────────

  it('8. POST /v1/cart/gift-card with invalid code returns 400 + GIFT_CARD_INVALID', async () => {
    const res = await api()
      .post('/v1/cart/gift-card')
      .set('Cookie', customerCookie)
      .send({ code: 'AAAAAAAAAAAAAAAA' }); // valid format but non-existent

    expect(res.status).toBe(400);
    // Single typed code per §8.1 API6 enumeration-mask: not-found, inactive,
    // and expired all collapse to the same wire response.
    expect(res.body.error?.code).toBe('GIFT_CARD_INVALID');
  });

  // ── 8b. POST /v1/cart/gift-card — the happy path, which had none ──────────

  /**
   * Nothing exercised a valid apply before. The endpoint returned a balance
   * envelope while the storefront parsed it as a full cart, so every valid
   * card threw a schema error the shopper read as "this gift card is not
   * valid", and the e2e only ever asserted the 400 and the 204, both of which
   * the broken build satisfied.
   */
  describe('8b. applying a real gift card', () => {
    const CODES = ['E2ECARTBIG000001', 'E2ECARTSMALL0001'];

    afterAll(async () => {
      await prisma.giftCardTransaction.deleteMany({
        where: { giftCard: { code: { in: CODES } } },
      });
      await prisma.giftCard.deleteMany({ where: { code: { in: CODES } } });
    });

    async function seedCard(code: string, balance: number): Promise<void> {
      await prisma.giftCard.deleteMany({ where: { code } });
      await prisma.giftCard.create({
        data: {
          code,
          initialBalance: balance,
          currentBalance: balance,
          currency: STORE_CURRENCY,
          isActive: true,
        },
      });
    }

    it('answers with the cart and caps the applied amount at the cart total', async () => {
      await seedCard(CODES[0], 99999);

      const res = await api()
        .post('/v1/cart/gift-card')
        .set('Cookie', customerCookie)
        .send({ code: CODES[0] })
        .expect(200);

      // A balance envelope has neither of these. This is the assertion that
      // would have caught the contract mismatch.
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(typeof res.body.data.grandTotalTtc).toBe('number');
      expect(res.body.data.grandTotalTtc).toBeGreaterThan(0);

      expect(res.body.data.giftCard).toEqual({
        code: CODES[0],
        balanceApplied: res.body.data.grandTotalTtc,
      });
    });

    it('survives a reload, because the code is on the cart and not in the browser', async () => {
      const res = await api().get('/v1/cart').set('Cookie', customerCookie).expect(200);
      expect(res.body.data.giftCard?.code).toBe(CODES[0]);
    });

    it('reports the balance, not the cart total, when the card is worth less', async () => {
      await seedCard(CODES[1], 1);

      const res = await api()
        .post('/v1/cart/gift-card')
        .set('Cookie', customerCookie)
        .send({ code: CODES[1] })
        .expect(200);

      expect(res.body.data.grandTotalTtc).toBeGreaterThan(1);
      expect(res.body.data.giftCard).toEqual({ code: CODES[1], balanceApplied: 1 });
    });

    it('is gone after a remove, and the cart says so on the next read', async () => {
      await api().delete('/v1/cart/gift-card').set('Cookie', customerCookie).expect(204);

      const res = await api().get('/v1/cart').set('Cookie', customerCookie).expect(200);
      expect(res.body.data.giftCard).toBeNull();
    });
  });

  // ── 9. POST /v1/cart/coupon — invalid coupon ──────────────────────────────

  it('9. POST /v1/cart/coupon with invalid code returns 400 + COUPON_INVALID', async () => {
    const res = await api()
      .post('/v1/cart/coupon')
      .set('Cookie', customerCookie)
      .send({ code: 'FAKECOUPON' });

    expect(res.status).toBe(400);
    // Single typed code per §8.1 API6 enumeration-mask: not-found, expired,
    // usage-exceeded, and exclusive-collision all collapse to one response.
    expect(res.body.error?.code).toBe('COUPON_INVALID');
  });

  // ── 10. DELETE /v1/cart/coupon — no-op when no coupon ────────────────────

  it('10. DELETE /v1/cart/coupon returns cart (no coupon to remove)', async () => {
    const res = await api().delete('/v1/cart/coupon').set('Cookie', customerCookie).expect(200);

    expect(res.body.data.couponCode).toBeNull();
  });

  // ── 11. DELETE /v1/cart/gift-card — always 204 ───────────────────────────

  it('11. DELETE /v1/cart/gift-card returns 204', async () => {
    await api().delete('/v1/cart/gift-card').set('Cookie', customerCookie).expect(204);
  });

  // ── 12. DELETE /v1/cart/items/:itemId — remove item ──────────────────────

  it('12. DELETE /v1/cart/items/:itemId removes the item', async () => {
    const res = await api()
      .delete(`/v1/cart/items/${addedItemId}`)
      .set('Cookie', customerCookie)
      .expect(200);

    const remaining = res.body.data.items.filter((i: { id: string }) => i.id === addedItemId);
    expect(remaining).toHaveLength(0);
  });

  // ── 13. DELETE /v1/cart — clear cart ─────────────────────────────────────

  it('13. DELETE /v1/cart clears all items', async () => {
    await api().delete('/v1/cart').set('Cookie', customerCookie).expect(204);

    const check = await api().get('/v1/cart').set('Cookie', customerCookie).expect(200);

    expect(check.body.data.items).toHaveLength(0);
  });

  // ── 14. Validation — invalid variantId rejected ───────────────────────────

  it('14. POST /v1/cart/items rejects an unknown variantId', async () => {
    // Variant ids are opaque strings (cuid/seed ids), not UUIDs — an unknown
    // one resolves to a not-found variant, so 404 is the correct rejection.
    await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId: 'not-a-uuid', quantity: 1 })
      .expect(404);
  });

  // ── 15. Validation — zero quantity rejected ───────────────────────────────

  it('15. POST /v1/cart/items rejects quantity < 1', async () => {
    await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 0 })
      .expect(400);
  });

  // ── 16. Error contract — unknown variant ─────────────────────────────────

  it('16. POST /v1/cart/items rejects unknown variantId with CART_VARIANT_NOT_FOUND', async () => {
    // Stable code lets the storefront map this rejection to a localized
    // "variant unavailable" message in both EN + AR (Full-Stack Audit plan
    // §1.1 row #3).
    const res = await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId: '11111111-1111-4111-8111-111111111111', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('CART_VARIANT_NOT_FOUND');
  });

  // ── 17. Error contract — insufficient stock on add ───────────────────────

  it('17. POST /v1/cart/items rejects over-stock with CART_INSUFFICIENT_STOCK', async () => {
    // Seeded stock is 50 (see beforeAll). Requesting 999 triggers the
    // pre-add stock guard at `cart.service.ts:addItem`.
    const res = await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId: variant2Id, quantity: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('CART_INSUFFICIENT_STOCK');
  });

  // ── 18. Error contract — insufficient stock on quantity update ───────────

  it('18. PATCH /v1/cart/items/:itemId rejects over-stock with CART_INSUFFICIENT_STOCK', async () => {
    // Pre-seed a fresh line so the test does not depend on prior-test state.
    const add = await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 });
    const items = add.body.data.items as Array<{ id: string; variantId: string }>;
    const lineId = items.find((i) => i.variantId === variantId)?.id;
    if (!lineId) throw new Error('expected the freshly-added cart line to be discoverable');
    expect(lineId).toBeTruthy();

    const res = await api()
      .patch(`/v1/cart/items/${lineId}`)
      .set('Cookie', customerCookie)
      .send({ quantity: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('CART_INSUFFICIENT_STOCK');
  });
});
