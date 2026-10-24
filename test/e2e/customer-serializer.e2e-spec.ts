/**
 * Customer-facing serializer hardening (plan J).
 *
 * Plant-and-read regression: an internal, admin-only value is written through
 * the admin surface, then every customer-facing response that carries the same
 * row is asserted to contain neither the field name nor the planted sentinel.
 * Assertions run over `JSON.stringify(body)` so a field that is renamed but
 * still serialized cannot pass, and so a value nested under a future `include`
 * is caught at any depth.
 *
 * Each describe is the seal for one phase of the plan:
 *   - J1: customer order detail, list, cancel, and the admin control read.
 *   - J2: the public product detail and the public product questions.
 *   - J3: the customer return detail and the shared /v1/users/me profile.
 *   - J5: the wishlist, which shipped the exact stock count the catalogue
 *     endpoints deliberately withhold.
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  flushRedisKeys,
  loginAs,
  signUpCustomer,
  ADMIN,
  STORE_ADDRESS,
  STORE_CURRENCY,
} from './helpers';

const RUN = crypto.randomUUID().slice(0, 8);
const CUSTOMER_EMAIL = `j-serializer-${RUN}@e2e.test`;
const CUSTOMER_PASSWORD = 'SerializerSeal1!';

/** Written by the admin, never allowed onto a customer response. */
const ORDER_NOTE_SENTINEL = `J1-SECRET-NOTE-${RUN}`;
/** `Order.idempotencyKey` is an audit mirror (schema.prisma), not a response field. */
const ORDER_IDEMPOTENCY_SENTINEL = `j1-idem-${RUN}`;

/** Any seeded product with variants — the public detail route reads by slug. */
const PRODUCT_SLUG = 'iphone-15-pro';
/** The merchant's purchase cost. Never public: it discloses the margin. */
const COST_PRICE_SENTINEL = 123.456;
/** The paid deliverable on a digital variant. Never readable without purchase. */
const LICENSE_KEY_SENTINEL = `J2-LICENSE-${RUN}`;
const BARCODE_SENTINEL = `J2-BARCODE-${RUN}`;

/** Where the reject flow stores its reason and operators keep processing notes. */
const RETURN_NOTE_SENTINEL = `J3-SECRET-NOTE-${RUN}`;

/** Resend webhook ops state plus the soft-delete column: internal plumbing. */
const PROFILE_INTERNAL_FIELDS = [
  'emailDeliverability',
  'emailBouncedAt',
  'emailComplainedAt',
  'deletedAt',
  'passwordHash',
];

const ADDRESS = { ...STORE_ADDRESS, fullName: 'Serializer Seal' };

describe('Customer-facing serializers — no admin or internal fields on the wire', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let customerCookie: string;
  let customerId: string;

  /** Read by the customer, never cancelled — covers detail and list. */
  let readOrderId: string;
  /** Cancelled by the customer — covers the cancel response. */
  let cancelOrderId: string;

  const seedOrder = async (suffix: string, variantId: string | null): Promise<string> => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-J1-${RUN}-${suffix}`,
        userId: customerId,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        shippingAddress: ADDRESS,
        billingAddress: ADDRESS,
        subtotal: 100,
        discountAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        total: 100,
        currency: STORE_CURRENCY,
        shippingMethodName: 'Standard',
        idempotencyKey: `${ORDER_IDEMPOTENCY_SENTINEL}-${suffix}`,
        items: {
          create: [
            {
              variantId,
              productName: { default: 'Serializer Seal Product' },
              sku: `J1-SKU-${RUN}-${suffix}`,
              unitPrice: 100,
              quantity: 1,
              total: 100,
            },
          ],
        },
      },
      select: { id: true },
    });
    return order.id;
  };

  beforeAll(async () => {
    prisma = createTestPrisma();

    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    customerCookie = await signUpCustomer(prisma, CUSTOMER_EMAIL, CUSTOMER_PASSWORD, {
      firstName: 'Serializer',
      lastName: 'Seal',
    });

    const customer = await prisma.user.findUniqueOrThrow({
      where: { email: CUSTOMER_EMAIL.toLowerCase() },
      select: { id: true },
    });
    customerId = customer.id;

    // A real variant so the cancel path's stock restore exercises its normal
    // branch rather than the empty-items short circuit.
    const variant = await prisma.productVariant.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    readOrderId = await seedOrder('read', variant?.id ?? null);
    cancelOrderId = await seedOrder('cancel', variant?.id ?? null);

    // The write path from the finding: the admin edit route persists the note.
    for (const id of [readOrderId, cancelOrderId]) {
      await api()
        .patch(`/v1/admin/orders/${id}`)
        .set('Cookie', adminCookie)
        .send({ internalNotes: ORDER_NOTE_SENTINEL })
        .expect(200);
    }
  });

  afterAll(async () => {
    try {
      const ids = [readOrderId, cancelOrderId].filter(Boolean);
      await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
      await prisma.order.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: CUSTOMER_EMAIL.toLowerCase() } });
    } catch {
      // best-effort
    }
    await prisma.$disconnect();
  });

  // ── J1 — orders ────────────────────────────────────────────────────────────

  describe('J1 — customer order responses (finding AD2)', () => {
    /** Fields the customer order shape must never carry (plan J K2). */
    const assertNoAdminOrderFields = (body: unknown) => {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(ORDER_NOTE_SENTINEL);
      expect(serialized).not.toContain(ORDER_IDEMPOTENCY_SENTINEL);
      expect(serialized).not.toContain('internalNotes');
      expect(serialized).not.toContain('idempotencyKey');
      expect(serialized).not.toContain('"user"');
      expect(serialized).not.toContain('userId');
    };

    it('GET /v1/orders/:id — carries the order but no admin fields', async () => {
      const res = await api()
        .get(`/v1/orders/${readOrderId}`)
        .set('Cookie', customerCookie)
        .expect(200);

      expect(res.body.data.orderNumber).toBe(`ORD-J1-${RUN}-read`);
      // Not asserted as an exact figure: the admin edit that plants the note
      // recalculates totals, and the seeded tax zone is real on this client.
      expect(res.body.data.total).toBeGreaterThan(0);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      assertNoAdminOrderFields(res.body);
    });

    it('GET /v1/orders — the list row carries no admin fields', async () => {
      const res = await api().get('/v1/orders').set('Cookie', customerCookie).expect(200);

      const row = res.body.data.find((o: { id: string }) => o.id === readOrderId);
      expect(row).toBeDefined();
      expect(row.orderNumber).toBe(`ORD-J1-${RUN}-read`);
      assertNoAdminOrderFields(res.body);
    });

    it('POST /v1/orders/:id/cancel — the cancel response carries no admin fields', async () => {
      const res = await api()
        .post(`/v1/orders/${cancelOrderId}/cancel`)
        .set('Cookie', customerCookie)
        .expect(200);

      expect(res.body.data.status).toBe('CANCELLED');
      assertNoAdminOrderFields(res.body);
    });

    it('GET /v1/admin/orders/:id — the admin surface still returns internalNotes', async () => {
      const res = await api()
        .get(`/v1/admin/orders/${readOrderId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.internalNotes).toBe(ORDER_NOTE_SENTINEL);
    });
  });

  // ── J2 — public catalogue ──────────────────────────────────────────────────

  describe('J2 — public product detail (sweep S1 / pass-2 P5)', () => {
    let variantId: string;

    beforeAll(async () => {
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { product: { slug: PRODUCT_SLUG }, isActive: true, deletedAt: null },
        select: { id: true },
      });
      variantId = variant.id;

      await prisma.productVariant.update({
        where: { id: variantId },
        data: {
          costPrice: COST_PRICE_SENTINEL,
          licenseKey: LICENSE_KEY_SENTINEL,
          barcode: BARCODE_SENTINEL,
          maxDownloads: 7,
          downloadExpiryDays: 3,
        },
      });

      // The detail payload is cached in Redis for 300 s. Without this flush the
      // assertion reads whatever an earlier spec left behind and the result
      // depends on test order, not on the serializer.
      await flushRedisKeys('products:detail*');
    });

    afterAll(async () => {
      try {
        await prisma.productVariant.update({
          where: { id: variantId },
          data: {
            costPrice: null,
            licenseKey: null,
            barcode: null,
            maxDownloads: null,
            downloadExpiryDays: null,
          },
        });
        await flushRedisKeys('products:detail*');
      } catch {
        // best-effort
      }
    });

    it('GET /v1/products/:slug — anonymous, no cost price, license key or barcode', async () => {
      const res = await api().get(`/v1/products/${PRODUCT_SLUG}`).expect(200);

      const variant = res.body.data.variants.find((v: { id: string }) => v.id === variantId);
      expect(variant).toBeDefined();
      expect(variant.price).toEqual(expect.any(Number));
      expect(variant.sku).toEqual(expect.any(String));
      expect(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).toContain(variant.availability);

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(LICENSE_KEY_SENTINEL);
      expect(serialized).not.toContain(BARCODE_SENTINEL);
      expect(serialized).not.toContain(String(COST_PRICE_SENTINEL));
      expect(serialized).not.toContain('costPrice');
      expect(serialized).not.toContain('licenseKey');
      expect(serialized).not.toContain('barcode');
      expect(serialized).not.toContain('maxDownloads');
      expect(serialized).not.toContain('downloadExpiryDays');
    });

    it('GET /v1/products/:slug — the variant carries exactly the public field set', async () => {
      const res = await api().get(`/v1/products/${PRODUCT_SLUG}`).expect(200);

      const variant = res.body.data.variants.find((v: { id: string }) => v.id === variantId);
      // Asserted as an exact set, not as absences: a column added to
      // ProductVariant later must show up here as a failure, not slip through.
      expect(Object.keys(variant).sort()).toEqual(
        ['id', 'productId', 'sku', 'price', 'compareAtPrice', 'isDefault', 'availability'].sort(),
      );
    });

    it('GET /v1/admin/products/:id — the admin surface still returns costPrice', async () => {
      const product = await prisma.product.findUniqueOrThrow({
        where: { slug: PRODUCT_SLUG },
        select: { id: true },
      });

      const res = await api()
        .get(`/v1/admin/products/${product.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const variant = res.body.data.variants.find((v: { id: string }) => v.id === variantId);
      expect(Number(variant.costPrice)).toBeCloseTo(COST_PRICE_SENTINEL, 3);
    });
  });

  describe('J2 — public product questions (sweep S2)', () => {
    let questionId: string;
    let adminUserId: string;

    beforeAll(async () => {
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: ADMIN.email },
        select: { id: true },
      });
      adminUserId = admin.id;

      const created = await api()
        .post(`/v1/products/${PRODUCT_SLUG}/questions`)
        .set('Cookie', customerCookie)
        .send({ question: `Serializer seal question ${RUN}?` })
        .expect(201);
      questionId = created.body.data.id;

      // The admin answer path is what writes `answeredBy`.
      await api()
        .post(`/v1/admin/questions/${questionId}/answer`)
        .set('Cookie', adminCookie)
        .send({ answer: `Serializer seal answer ${RUN}.`, isAdminAnswer: true })
        .expect(201);

      await api()
        .patch(`/v1/admin/questions/${questionId}/approve`)
        .set('Cookie', adminCookie)
        .expect(200);
    });

    afterAll(async () => {
      try {
        await prisma.productQuestion.deleteMany({ where: { id: questionId } });
      } catch {
        // best-effort
      }
    });

    it('GET /v1/products/:slug/questions — anonymous, answer present, no staff or asker ids', async () => {
      const res = await api().get(`/v1/products/${PRODUCT_SLUG}/questions`).expect(200);

      const row = res.body.data.find((q: { id: string }) => q.id === questionId);
      expect(row).toBeDefined();
      expect(JSON.stringify(row.answer)).toContain(`Serializer seal answer ${RUN}.`);
      expect(row.isAdminAnswer).toBe(true);

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('answeredBy');
      expect(serialized).not.toContain('askedById');
      expect(serialized).not.toContain(adminUserId);
      expect(serialized).not.toContain(customerId);
    });

    it('GET /v1/admin/questions — the admin list still carries answeredBy', async () => {
      const res = await api().get('/v1/admin/questions').set('Cookie', adminCookie).expect(200);

      const row = res.body.data.find((q: { id: string }) => q.id === questionId);
      expect(row).toBeDefined();
      expect(row.answeredBy).toBe(adminUserId);
    });
  });

  // ── J3 — returns and profile ───────────────────────────────────────────────

  describe('J3 — customer return responses (sweep S3)', () => {
    let returnId: string;

    beforeAll(async () => {
      const created = await prisma.return.create({
        data: {
          returnNumber: `RET-J3-${RUN}`,
          orderId: readOrderId,
          customerId,
          status: 'REQUESTED',
          reason: 'CHANGED_MIND',
          adminNotes: RETURN_NOTE_SENTINEL,
        },
        select: { id: true },
      });
      returnId = created.id;
    });

    afterAll(async () => {
      try {
        await prisma.return.deleteMany({ where: { id: returnId } });
      } catch {
        // best-effort
      }
    });

    it('GET /v1/returns/:id — the owner sees the return but not the admin notes', async () => {
      const res = await api()
        .get(`/v1/returns/${returnId}`)
        .set('Cookie', customerCookie)
        .expect(200);

      expect(res.body.data.returnNumber).toBe(`RET-J3-${RUN}`);
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(RETURN_NOTE_SENTINEL);
      expect(serialized).not.toContain('adminNotes');
    });

    it('GET /v1/admin/returns/:id — the admin surface still returns adminNotes', async () => {
      const res = await api()
        .get(`/v1/admin/returns/${returnId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.adminNotes).toBe(RETURN_NOTE_SENTINEL);
    });
  });

  describe('J3 — GET /v1/users/me (sweep S4)', () => {
    beforeAll(async () => {
      // Plant the mail-ops state a Resend webhook would write, so the
      // assertion covers populated values and not just absent columns.
      await prisma.user.update({
        where: { id: customerId },
        data: {
          emailDeliverability: 'bounced',
          emailBouncedAt: new Date(),
          emailComplainedAt: new Date(),
        },
      });
    });

    it('carries the customer profile and no mail-ops state', async () => {
      const res = await api().get('/v1/users/me').set('Cookie', customerCookie).expect(200);

      expect(res.body.data.email).toBe(CUSTOMER_EMAIL.toLowerCase());
      expect(Array.isArray(res.body.data.addresses)).toBe(true);
      for (const field of PROFILE_INTERNAL_FIELDS) {
        expect(JSON.stringify(res.body)).not.toContain(field);
      }
    });

    // The same endpoint feeds the admin dashboard session bootstrap, which
    // needs `roles` with permissions and `twoFactorEnabled` to build the
    // sidebar. Stripping too much here breaks the admin, not the storefront.
    it('keeps the admin bootstrap shape for an admin session', async () => {
      const res = await api().get('/v1/users/me').set('Cookie', adminCookie).expect(200);

      expect(res.body.data.email).toBe(ADMIN.email);
      expect(Array.isArray(res.body.data.roles)).toBe(true);
      expect(res.body.data).toHaveProperty('twoFactorEnabled');
      expect(res.body.data).toHaveProperty('isActive');
      for (const field of PROFILE_INTERNAL_FIELDS) {
        expect(JSON.stringify(res.body)).not.toContain(field);
      }
    });

    it('PATCH /v1/users/me — the update response is stripped the same way', async () => {
      const res = await api()
        .patch('/v1/users/me')
        .set('Cookie', customerCookie)
        .send({ firstName: 'Serializer' })
        .expect(200);

      expect(res.body.data.firstName).toBe('Serializer');
      for (const field of PROFILE_INTERNAL_FIELDS) {
        expect(JSON.stringify(res.body)).not.toContain(field);
      }
    });
  });

  // ── J5 — wishlist ──────────────────────────────────────────────────────────

  describe('J5 — GET /v1/wishlist (pass-2 W2, stock half)', () => {
    let productId: string;

    beforeAll(async () => {
      const product = await prisma.product.findUniqueOrThrow({
        where: { slug: PRODUCT_SLUG },
        select: { id: true },
      });
      productId = product.id;

      await api().post(`/v1/wishlist/${productId}`).set('Cookie', customerCookie).expect(201);
    });

    afterAll(async () => {
      try {
        await prisma.wishlistItem.deleteMany({ where: { userId: customerId } });
      } catch {
        // best-effort
      }
    });

    it('grades availability instead of shipping the exact count', async () => {
      const res = await api().get('/v1/wishlist').set('Cookie', customerCookie).expect(200);

      const row = res.body.data.find((i: { productId: string }) => i.productId === productId);
      expect(row).toBeDefined();
      expect(row.productSlug).toBe(PRODUCT_SLUG);
      expect(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).toContain(row.availability);
      expect(row).not.toHaveProperty('availableStock');
    });

    // The wishlist is owner-scoped, but an account holder can wishlist the
    // whole catalogue, so an exact count here reads off the inventory position
    // that the products and search endpoints refuse to give.
    it('puts no stock number anywhere in the body', async () => {
      const res = await api().get('/v1/wishlist').set('Cookie', customerCookie).expect(200);

      for (const row of res.body.data as Record<string, unknown>[]) {
        const numericStockKeys = Object.entries(row)
          .filter(([key, value]) => /stock/i.test(key) && typeof value === 'number')
          .map(([key]) => key);
        expect(numericStockKeys).toEqual([]);
      }
    });
  });
});
