import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, createTestPrisma, loginAs, signUpCustomer, ADMIN } from '../../../test/e2e/helpers';

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-wishlist.test';
const TEST_PASSWORD = 'StrongPass1!';

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Wishlist (e2e)', () => {
  let prisma: PrismaClient;

  let user1Cookie: string;
  let user2Cookie: string;
  let adminCookie: string;
  let product1Id: string;
  let product2Id: string;
  let productTypeId: string;

  // IDs for teardown
  let variant1Id: string;
  let variant2Id: string;

  // ── Setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Use seeded SUPER_ADMIN (bypasses all permission guards per §3.3) ──
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // ── Create users ─────────────────────────────────────────────────────
    user1Cookie = await signUpCustomer(prisma, `user1${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'User',
      lastName: 'One',
    });

    user2Cookie = await signUpCustomer(prisma, `user2${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'User',
      lastName: 'Two',
    });

    // ── Resolve inventory location via Prisma (seeded MAIN-WH always exists) ─
    const loc = await prisma.inventoryLocation.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true },
    });
    const locationId = loc.id;

    // ── Create products via API (exercises products:create permission path) ─
    const ts = Date.now();

    // Resolve or create a product type
    let pType = await prisma.productType.findFirst({ select: { id: true } });
    if (!pType) {
      pType = await prisma.productType.create({
        data: {
          name: { default: 'Wishlist Type', fr: 'Wishlist Type', en: 'Wishlist Type' },
          code: `wish-type-${ts}`,
        },
        select: { id: true },
      });
    }
    productTypeId = pType.id;

    const product1Res = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Wishlist Product 1' },
        slug: `wish-prod-1-${ts}`,
        description: { default: 'First wishlist test product' },
        variants: [{ sku: `WISH-SKU-1-${ts}`, price: 50 }],
      });
    product1Id = product1Res.body.data?.id;
    variant1Id = product1Res.body.data?.variants?.[0]?.id;

    const product2Res = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Wishlist Product 2' },
        slug: `wish-prod-2-${ts}`,
        description: { default: 'Second wishlist test product' },
        variants: [{ sku: `WISH-SKU-2-${ts}`, price: 75 }],
      });
    product2Id = product2Res.body.data?.id;
    variant2Id = product2Res.body.data?.variants?.[0]?.id;

    // ── Stock both variants via the correct adjust endpoint ───────────────
    for (const variantId of [variant1Id, variant2Id]) {
      if (!variantId) continue;
      await api()
        .patch('/v1/admin/inventory/adjust')
        .set('Cookie', adminCookie)
        .set('X-Idempotency-Key', randomUUID())
        .send({ variantId, locationId, quantity: 100, reason: 'RECEIVED' });
    }
  });

  afterAll(async () => {
    // Remove wishlist items first, then product data, then users
    const testUsers = await prisma.user.findMany({
      where: { email: { endsWith: TEST_SUFFIX } },
      select: { id: true },
    });
    if (testUsers.length) {
      const ids = testUsers.map((u) => u.id);
      await prisma.wishlistItem.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    // Clean up test products (soft-deleted via admin endpoint or direct Prisma)
    if (variant1Id)
      await prisma.stockLevel.deleteMany({ where: { variantId: variant1Id } }).catch(() => {});
    if (variant2Id)
      await prisma.stockLevel.deleteMany({ where: { variantId: variant2Id } }).catch(() => {});
    if (product1Id)
      await prisma.productVariant.deleteMany({ where: { productId: product1Id } }).catch(() => {});
    if (product2Id)
      await prisma.productVariant.deleteMany({ where: { productId: product2Id } }).catch(() => {});
    if (product1Id) await prisma.product.delete({ where: { id: product1Id } }).catch(() => {});
    if (product2Id) await prisma.product.delete({ where: { id: product2Id } }).catch(() => {});
    await prisma.$disconnect();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Suite 1 — Basic CRUD operations
  // ═══════════════════════════════════════════════════════════════════════

  describe('Wishlist CRUD', () => {
    it('GET /v1/wishlist — returns empty for new user', async () => {
      const res = await api().get('/v1/wishlist').set('Cookie', user1Cookie).expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('POST /v1/wishlist/:productId — adds product to wishlist', async () => {
      const res = await api()
        .post(`/v1/wishlist/${product1Id}`)
        .set('Cookie', user1Cookie)
        .expect(201);

      expect(res.body.data).toMatchObject({
        productId: product1Id,
        productSlug: expect.any(String),
      });
    });

    it('GET /v1/wishlist — returns item with enriched price and availability', async () => {
      const res = await api().get('/v1/wishlist').set('Cookie', user1Cookie).expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        productId: product1Id,
        productSlug: expect.any(String),
        // Storefront endpoint — the Translatable productName is locale-resolved.
        productName: expect.any(String),
        price: 50,
        // The graded state, never the count (plan J, pass-2 finding W2).
        availability: expect.stringMatching(/^(IN_STOCK|LOW_STOCK|OUT_OF_STOCK)$/),
        addedAt: expect.any(String),
      });
      expect(res.body.data[0]).not.toHaveProperty('availableStock');
      expect(res.body.meta.total).toBe(1);
    });

    it('POST /v1/wishlist/:productId — is idempotent (add same product twice)', async () => {
      await api().post(`/v1/wishlist/${product1Id}`).set('Cookie', user1Cookie).expect(201);

      const res = await api().get('/v1/wishlist').set('Cookie', user1Cookie).expect(200);

      expect(res.body.data).toHaveLength(1);
    });

    it('DELETE /v1/wishlist/:productId — removes product', async () => {
      await api().delete(`/v1/wishlist/${product1Id}`).set('Cookie', user1Cookie).expect(204);

      const res = await api().get('/v1/wishlist').set('Cookie', user1Cookie).expect(200);

      expect(res.body.data).toHaveLength(0);
    });

    it('DELETE /v1/wishlist/:productId — is idempotent (delete non-existent)', async () => {
      await api().delete(`/v1/wishlist/${product1Id}`).set('Cookie', user1Cookie).expect(204);

      const res = await api().get('/v1/wishlist').set('Cookie', user1Cookie).expect(200);

      expect(res.body.data).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Suite 2 — Multiple items and ownership
  // ═══════════════════════════════════════════════════════════════════════

  describe('Multiple items and ownership', () => {
    it('supports multiple products in one wishlist', async () => {
      await api().post(`/v1/wishlist/${product1Id}`).set('Cookie', user1Cookie);

      await api().post(`/v1/wishlist/${product2Id}`).set('Cookie', user1Cookie);

      const res = await api().get('/v1/wishlist').set('Cookie', user1Cookie).expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);
    });

    it('isolates wishlists between users', async () => {
      await api().post(`/v1/wishlist/${product1Id}`).set('Cookie', user2Cookie);

      const user1Res = await api().get('/v1/wishlist').set('Cookie', user1Cookie).expect(200);

      const user2Res = await api().get('/v1/wishlist').set('Cookie', user2Cookie).expect(200);

      expect(user1Res.body.data).toHaveLength(2);
      expect(user2Res.body.data).toHaveLength(1);
      expect(user2Res.body.data[0].productId).toBe(product1Id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Suite 3 — Pagination and sorting
  // ═══════════════════════════════════════════════════════════════════════

  describe('Pagination and sorting', () => {
    it('GET /v1/wishlist — respects page and pageSize', async () => {
      const res = await api()
        .get('/v1/wishlist?page=1&pageSize=1')
        .set('Cookie', user1Cookie)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.pageSize).toBe(1);
      expect(res.body.meta.total).toBe(2);
    });

    it('GET /v1/wishlist — respects sortOrder asc', async () => {
      const res = await api()
        .get('/v1/wishlist?sortBy=createdAt&sortOrder=asc')
        .set('Cookie', user1Cookie)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
    });

    it('GET /v1/wishlist — respects sortBy price', async () => {
      const res = await api()
        .get('/v1/wishlist?sortBy=price&sortOrder=asc')
        .set('Cookie', user1Cookie)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      if (res.body.data.length === 2) {
        expect(parseFloat(res.body.data[0].price)).toBeLessThanOrEqual(
          parseFloat(res.body.data[1].price),
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Suite 4 — Validation and error cases
  // ═══════════════════════════════════════════════════════════════════════

  describe('Validation and errors', () => {
    it('POST /v1/wishlist/:productId — requires auth (401)', async () => {
      await api().post(`/v1/wishlist/${product1Id}`).expect(401);
    });

    it('GET /v1/wishlist — requires auth (401)', async () => {
      await api().get('/v1/wishlist').expect(401);
    });

    it('DELETE /v1/wishlist/:productId — requires auth (401)', async () => {
      await api().delete(`/v1/wishlist/${product1Id}`).expect(401);
    });

    it('POST /v1/wishlist/:productId — 404 + WISHLIST_PRODUCT_NOT_FOUND on unknown product', async () => {
      const res = await api().post('/v1/wishlist/nonexistent-id').set('Cookie', user1Cookie);

      expect(res.status).toBe(404);
      // B2 row #22: typed code disambiguates the wishlist 404 from a generic
      // 404. Note: WISHLIST_ALREADY_ADDED is NOT wired — the addItem path uses
      // `prisma.wishlistItem.upsert` (silently idempotent), so duplicate adds
      // succeed with 200 by documented design (see the service docstring).
      expect(res.body.error?.code).toBe('WISHLIST_PRODUCT_NOT_FOUND');
    });

    it('DELETE /v1/wishlist/:productId — 404 + WISHLIST_PRODUCT_NOT_FOUND on unknown product', async () => {
      const res = await api().delete('/v1/wishlist/nonexistent-id').set('Cookie', user1Cookie);

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('WISHLIST_PRODUCT_NOT_FOUND');
    });
  });
});
