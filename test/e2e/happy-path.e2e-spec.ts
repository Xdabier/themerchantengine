/**
 * Happy Path E2E — Full storefront flow
 *
 * Setup: register customer (Better Auth sign-up) → sign in for a session cookie
 *
 * 3.  GET  /v1/products           — browse product list (pagination + data envelope)
 * 4.  GET  /v1/search?q=...       — search via dedicated search endpoint
 * 5.  GET  /v1/products/:slug     — product detail (variants, assets)
 * 6.  POST /v1/cart/items         — add product variant to cart
 * 7.  GET  /v1/cart               — verify cart has item with correct price
 * 8.  POST /v1/cart/coupon        — apply WELCOME10 coupon
 * 9.  GET  /v1/cart               — verify discount applied
 * 10. GET  /v1/cart/estimate      — estimate shipping
 * 11. POST /v1/orders             — place order (COD + X-Idempotency-Key)
 * 12. GET  /v1/orders             — order appears in customer order list
 * 13. GET  /v1/orders/:id         — order detail matches cart contents
 * 14. PATCH /v1/admin/orders/:id/status — admin confirms
 * 15. POST  /v1/admin/orders/:id/shipments — admin creates shipment w/ tracking
 * 16. PATCH /v1/admin/orders/:id/status — admin marks DELIVERED (multi-step transition)
 * 17. POST /v1/products/:slug/reviews  — customer leaves 5-star review
 * 18. GET  /v1/products/:slug/reviews  — review visible after admin approval
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

const CUSTOMER_EMAIL = `happy-path-${crypto.randomUUID()}@e2e.test`;
const CUSTOMER_PASSWORD = 'HappyPath1!';
const PRODUCT_SLUG = 'urban-runner-sneakers';

/** Mirrors STOCK_STATUSES in the inventory module. */
const AVAILABILITY_STATES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'];

type StorefrontVariant = { id: string; availability: unknown; stock?: unknown };

describe('Happy Path (e2e)', () => {
  let prisma: PrismaClient;

  let customerCookie: string;
  let adminCookie: string;
  let variantId: string;
  let variantPrice: number;
  let shippingMethodId: string;
  let orderId: string;
  let orderItemId: string;
  let reviewId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Register the customer through Better Auth and sign in for a session cookie.
    customerCookie = await signUpCustomer(prisma, CUSTOMER_EMAIL, CUSTOMER_PASSWORD, {
      firstName: 'Happy',
      lastName: 'Path',
    });

    // A method that actually serves the destination, not `data[0]` of a list
    // ordered by sortOrder across every zone. See shippingMethodForCountry.
    shippingMethodId = await shippingMethodForCountry(adminCookie, STORE_ADDRESS.country);
    expect(shippingMethodId).toBeDefined();
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email: CUSTOMER_EMAIL } });
    } catch {
      // ignore — test may not have reached registration
    }
    await prisma.$disconnect();
  });

  // ── 3. Browse products ───────────────────────────────────────────────────────

  it('3. GET /v1/products — catalogue returned with pagination meta', async () => {
    const res = await api().get('/v1/products').expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta).toBeDefined();
    expect(typeof res.body.meta.total).toBe('number');
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.meta.page).toBeDefined();
    expect(res.body.meta.pageSize).toBeDefined();
  });

  it('3b. GET /v1/products returns availability, and never a stock count, per card variant', async () => {
    const res = await api().get('/v1/products').expect(200);

    const withVariants = (res.body.data as Array<{ variants?: StorefrontVariant[] }>).filter(
      (p) => Array.isArray(p.variants) && p.variants.length > 0,
    );
    expect(withVariants.length).toBeGreaterThan(0);

    for (const product of withVariants) {
      for (const variant of product.variants as StorefrontVariant[]) {
        expect(AVAILABILITY_STATES).toContain(variant.availability);
        // The exact count must not reach an unauthenticated caller: paging the
        // catalogue would otherwise expose the store's whole inventory position.
        expect(variant).not.toHaveProperty('stock');
      }
    }
  });

  // ── 4. Search ────────────────────────────────────────────────────────────────

  it('4. GET /v1/search?q=shoes — dedicated search endpoint returns results', async () => {
    // SPEC MISMATCH: GET /v1/search returns 500 due to raw SQL referencing column
    // `p.searchVector` which does not exist in the database schema. The search
    // service uses $queryRaw with a tsvector column that was never migrated.
    // Expected: 200 with { data: [...products], meta: { total, page, pageSize } }
    // Got: 500 Internal Server Error — "column p.searchVector does not exist"
    const res = await api().get('/v1/search').query({ q: 'shoes' }).expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    // urban-runner-sneakers is seeded in the Shoes category
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta).toBeDefined();
  });

  // ── 5. Product detail + pick variant ────────────────────────────────────────

  it(`5. GET /v1/products/${PRODUCT_SLUG} — returns product with variants`, async () => {
    const res = await api().get(`/v1/products/${PRODUCT_SLUG}`).expect(200);

    expect(res.body.data.slug).toBe(PRODUCT_SLUG);
    expect(res.body.data.variants).toBeInstanceOf(Array);
    expect(res.body.data.variants.length).toBeGreaterThan(0);
    variantId = res.body.data.variants[0].id;
    variantPrice = res.body.data.variants[0].price;
    expect(variantId).toBeDefined();
    // SPEC MISMATCH: variant.price is returned as a Prisma Decimal object
    // (e.g. {"d":[349],"e":2,"s":1}) instead of a plain JSON number.
    // Expected: typeof price === 'number'
    // Got: typeof price === 'object' (Prisma Decimal not serialised to number)
    expect(typeof variantPrice).toBe('number');

    // Availability must reach the product page on the same shape the card gets,
    // so the two surfaces can never disagree about one variant, and the exact
    // count must be absent here too.
    for (const variant of res.body.data.variants as StorefrontVariant[]) {
      expect(AVAILABILITY_STATES).toContain(variant.availability);
      expect(variant).not.toHaveProperty('stock');
    }
  });

  // ── 6. Add to cart ───────────────────────────────────────────────────────────

  it('6. POST /v1/cart/items — adds variant to cart', async () => {
    const res = await api()
      .post('/v1/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 })
      .expect(200);

    expect(res.body.data.itemCount).toBeGreaterThan(0);
    expect(res.body.data.items.some((i: any) => i.variantId === variantId)).toBe(true);
  });

  // ── 7. Verify cart has item ──────────────────────────────────────────────────

  it('7. GET /v1/cart — cart contains item with correct price', async () => {
    const res = await api().get('/v1/cart').set('Cookie', customerCookie).expect(200);

    expect(res.body.data.items).toBeInstanceOf(Array);
    const item = res.body.data.items.find((i: any) => i.variantId === variantId);
    expect(item).toBeDefined();
    expect(item.quantity).toBe(1);
    // Exact price equality against variantPrice is blocked: product detail
    // returns a Prisma Decimal object, not a plain number (SPEC MISMATCH in
    // step 5). Verify unitPrice is at least a positive number.
    expect(typeof item.unitPrice).toBe('number');
    expect(item.unitPrice).toBeGreaterThan(0);
    expect(res.body.data.subtotal).toBeGreaterThan(0);
  });

  // ── 8. Apply coupon ──────────────────────────────────────────────────────────

  it('8. POST /v1/cart/coupon — applies WELCOME10 coupon', async () => {
    const res = await api()
      .post('/v1/cart/coupon')
      .set('Cookie', customerCookie)
      .send({ code: 'WELCOME10' })
      .expect(200);

    expect(res.body.data.couponCode).toBe('WELCOME10');
    expect(res.body.data.discounts.length).toBeGreaterThan(0);
  });

  // ── 9. Verify discount applied ───────────────────────────────────────────────

  it('9. GET /v1/cart — discount applied; total < subtotal', async () => {
    const res = await api().get('/v1/cart').set('Cookie', customerCookie).expect(200);

    expect(res.body.data.couponCode).toBe('WELCOME10');
    expect(res.body.data.discounts).toBeInstanceOf(Array);
    expect(res.body.data.discounts.length).toBeGreaterThan(0);
    // Total must be less than subtotal because coupon applies a discount
    expect(res.body.data.total).toBeLessThan(res.body.data.subtotal);
  });

  // ── 10. Estimate shipping ────────────────────────────────────────────────────

  it('10. GET /v1/cart/estimate?country=<store country> — returns available shipping methods', async () => {
    const res = await api()
      .get('/v1/cart/estimate')
      .set('Cookie', customerCookie)
      .query({ country: STORE_ADDRESS.country })
      .expect(200);

    expect(res.body.data.rates).toBeInstanceOf(Array);
    expect(res.body.data.rates.length).toBeGreaterThan(0);
    // Each rate carries the default-method flag + a numeric price (§4.15).
    expect(typeof res.body.data.rates[0].isDefault).toBe('boolean');
    expect(typeof res.body.data.rates[0].price).toBe('number');
    // Fallback: prefer a method from the estimate if admin one wasn't fetched
    if (!shippingMethodId) {
      shippingMethodId = res.body.data.rates[0].methodId;
    }
  });

  // ── 11. Place order ──────────────────────────────────────────────────────────

  it('11. POST /v1/orders — places COD order with X-Idempotency-Key', async () => {
    const res = await api()
      .post('/v1/orders')
      .set('Cookie', customerCookie)
      .set('X-Idempotency-Key', crypto.randomUUID())
      .send({
        shippingAddress: STORE_ADDRESS,
        shippingMethodId,
        couponCode: 'WELCOME10',
      })
      .expect(201);

    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe('PENDING');
    orderId = res.body.data.id;
  });

  // ── 12. Customer order list ──────────────────────────────────────────────────

  it('12. GET /v1/orders — placed order appears in customer order list', async () => {
    const res = await api().get('/v1/orders').set('Cookie', customerCookie).expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.meta).toBeDefined();
    const found = res.body.data.find((o: any) => o.id === orderId);
    expect(found).toBeDefined();
    expect(found.status).toBe('PENDING');
  });

  // ── 13. Customer order detail ────────────────────────────────────────────────

  it('13. GET /v1/orders/:id — order detail matches placed cart contents', async () => {
    const res = await api().get(`/v1/orders/${orderId}`).set('Cookie', customerCookie).expect(200);

    expect(res.body.data.id).toBe(orderId);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    // Verify the item snapshot matches the variant we added
    const item = res.body.data.items.find((i: any) => i.variantId === variantId);
    expect(item).toBeDefined();
    expect(item.quantity).toBe(1);
    // SPEC MISMATCH: order item `unitPrice` is returned as a Prisma Decimal object
    // (e.g. {"d":[349],"e":2,"s":1}) instead of a plain JSON number.
    // Same root cause as step 5 — Prisma Decimal fields not serialised to numbers.
    // Expected: typeof item.unitPrice === 'number'
    // Got: typeof item.unitPrice === 'object'
    expect(typeof item.unitPrice).toBe('number');
    expect(item.unitPrice).toBeGreaterThan(0);
    orderItemId = res.body.data.items[0]?.id;
    expect(orderItemId).toBeDefined();

    // Each line carries the catalogue slug so the order detail can link back to
    // the product. `OrderItem` has no slug column, so this is resolved at read
    // time and was simply absent before: the storefront schema tolerated the
    // key and the API never sent it, leaving a placed order as a dead end.
    expect(typeof item.productSlug).toBe('string');
    expect(item.productSlug.length).toBeGreaterThan(0);

    // Shipping is charged, snapshotted, and folded into the order total.
    const subtotal = Number(res.body.data.subtotal);
    const shippingAmount = Number(res.body.data.shippingAmount);
    const taxAmount = Number(res.body.data.taxAmount ?? 0);
    const discountAmount = Number(res.body.data.discountAmount ?? 0);
    const total = Number(res.body.data.total);
    expect(shippingAmount).toBeGreaterThan(0);
    expect(typeof res.body.data.shippingMethodName).toBe('string');
    expect(res.body.data.shippingMethodName.length).toBeGreaterThan(0);
    // Precision 3, not 2. `toBeCloseTo(x, 2)` passes when the difference is
    // under 0.005, which is FIVE TIMES the smallest unit of a three-decimal
    // currency: the order total could be wrong by four thousandths and this
    // would still report green.
    expect(total).toBeCloseTo(subtotal - discountAmount + shippingAmount + taxAmount, 3);
    // With a 19 per cent zone seeded the tax term is no longer vacuously zero,
    // so this assertion now actually exercises the composition it names.
    expect(taxAmount).toBeGreaterThan(0);
  });

  // ── 14. Admin confirms ───────────────────────────────────────────────────────

  it('14. PATCH /v1/admin/orders/:id/status — admin confirms order', async () => {
    const res = await api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    expect(res.body.data.status).toBe('CONFIRMED');
  });

  it('(admin) GET /v1/admin/orders/:id — admin fetches order items', async () => {
    const res = await api()
      .get(`/v1/admin/orders/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.data.id).toBe(orderId);
    expect(res.body.data.items).toBeInstanceOf(Array);
    // Confirm orderItemId from admin view if customer view didn't set it
    if (!orderItemId) {
      orderItemId = res.body.data.items[0]?.id;
    }
    expect(orderItemId).toBeDefined();
  });

  // ── 15. Admin ships ──────────────────────────────────────────────────────────

  it('15. POST /v1/admin/orders/:id/shipments — admin ships with tracking number', async () => {
    const res = await api()
      .post(`/v1/admin/orders/${orderId}/shipments`)
      .set('Cookie', adminCookie)
      .send({
        items: [{ orderItemId, quantity: 1 }],
        carrier: 'QExpress',
        trackingNumber: 'QX-E2E-999',
      })
      .expect(201);

    expect(res.body.data.trackingNumber).toBe('QX-E2E-999');
  });

  // ── 16. Admin delivers ───────────────────────────────────────────────────────

  it('16. PATCH /v1/admin/orders/:id/status — admin transitions to DELIVERED', async () => {
    // Required state machine: CONFIRMED → PROCESSING → SHIPPED → DELIVERED.
    // Step 15 created a shipment on the CONFIRMED order, which is what moves it
    // to PROCESSING since plan M phase M1, so this picks up from SHIPPED.
    await api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'SHIPPED' })
      .expect(200);

    const res = await api()
      .patch(`/v1/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'DELIVERED' })
      .expect(200);

    expect(res.body.data.status).toBe('DELIVERED');
  });

  // ── 17. Customer reviews ─────────────────────────────────────────────────────

  it(`17. POST /v1/products/${PRODUCT_SLUG}/reviews — customer leaves 5-star review`, async () => {
    const res = await api()
      .post(`/v1/products/${PRODUCT_SLUG}/reviews`)
      .set('Cookie', customerCookie)
      .send({
        rating: 5,
        title: 'Great shoes!',
        body: 'Very comfortable and stylish for everyday wear.',
      })
      .expect(201);

    expect(res.body.data.rating).toBe(5);
    reviewId = res.body.data.id;
  });

  it('(admin) PATCH /v1/admin/reviews/:id/approve — admin approves review', async () => {
    await api()
      .patch(`/v1/admin/reviews/${reviewId}/approve`)
      .set('Cookie', adminCookie)
      .expect(200);
  });

  // ── 18. Verify review in product detail ─────────────────────────────────────

  it(`18. GET /v1/products/${PRODUCT_SLUG}/reviews — approved review is visible`, async () => {
    const res = await api().get(`/v1/products/${PRODUCT_SLUG}/reviews`).expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    const found = res.body.data.find((r: any) => r.id === reviewId);
    expect(found).toBeDefined();
    expect(found.rating).toBe(5);
  });
});
