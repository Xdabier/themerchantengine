import { ProductStatus, AssetType, AssetStatus, PrismaClient } from '@prisma/client';
import {
  api,
  createTestPrisma,
  createUserWithRole,
  loginAs,
  STORE_DEFAULT_LOCALE,
  STORE_SECONDARY_LOCALE,
} from '../../../test/e2e/helpers';

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-products.test';
const TEST_PASSWORD = 'StrongPass1';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Products (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;

  // IDs set during tests
  let productId: string;
  let variantId: string;
  let assetId: string;
  let productSlug: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Clean up previous runs ────────────────────────────────────────────────
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E-Products-' } } });
    // Delete variants before products to satisfy FK constraints
    const staleProducts = await prisma.product.findMany({
      where: { slug: { startsWith: 'e2e-test-product' } },
      select: { id: true },
    });
    const staleIds = staleProducts.map((p) => p.id);
    if (staleIds.length) {
      await prisma.productAsset.deleteMany({ where: { productId: { in: staleIds } } });
      await prisma.productVariant.deleteMany({ where: { productId: { in: staleIds } } });
    }
    await prisma.product.deleteMany({ where: { slug: { startsWith: 'e2e-test-product' } } });

    // ── Create admin user with products permissions ───────────────────────────
    await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['products:view', 'products:create', 'products:update', 'products:delete'],
      firstName: 'Products',
      lastName: 'Admin',
    });

    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);

    // ── Create a stub asset for assignment tests ───────────────────────────────
    const asset = await prisma.asset.create({
      data: {
        url: 'https://cdn.example.com/e2e-products-test-asset.jpg',
        storagePath: 'e2e-products-test-asset.jpg',
        mimeType: 'image/jpeg',
        fileSize: 12345,
        type: AssetType.IMAGE,
        status: AssetStatus.READY,
      },
    });
    assetId = asset.id;
  });

  afterAll(async () => {
    // Cascade cleanup — delete children before parents to satisfy FK constraints
    const e2eProducts = await prisma.product.findMany({
      where: { slug: { startsWith: 'e2e-test-product' } },
      select: { id: true },
    });
    const e2eProductIds = e2eProducts.map((p) => p.id);
    if (e2eProductIds.length) {
      await prisma.productAsset.deleteMany({ where: { productId: { in: e2eProductIds } } });
      await prisma.productVariant.deleteMany({ where: { productId: { in: e2eProductIds } } });
    }
    await prisma.product.deleteMany({ where: { slug: { startsWith: 'e2e-test-product' } } });
    if (assetId) {
      await prisma.asset.delete({ where: { id: assetId } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E-Products-' } } });
    await prisma.$disconnect();
  });

  // ── 1. Create product with variants ───────────────────────────────────────

  describe('POST /v1/admin/products — create with variants', () => {
    it('returns 401 without auth', async () => {
      await api()
        .post('/v1/admin/products')
        .send({ name: { default: 'Unauth' } })
        .expect(401);
    });

    it('returns 400 when name.default is missing', async () => {
      await api()
        .post('/v1/admin/products')
        .set('Cookie', adminCookie)
        .send({ name: {} })
        .expect(400);
    });

    it('creates a product with a variant and returns 201', async () => {
      const res = await api()
        .post('/v1/admin/products')
        .set('Cookie', adminCookie)
        .send({
          // `default` stays English here: the slug is auto-derived from it and
          // the assertion below (plus the suite cleanup) matches on
          // `e2e-test-product`.
          name: { default: 'E2E Test Product', en: 'E2E Test Product' },
          description: {
            default: 'This product was created during E2E testing.',
            en: 'This product was created during E2E testing.',
          },
          status: ProductStatus.DRAFT,
          variants: [
            {
              sku: 'E2E-SKU-001',
              price: 49.99,
              weight: 1.2,
              isDefault: true,
            },
          ],
        })
        .expect(201);

      expect(res.body.data).toMatchObject({
        slug: expect.stringContaining('e2e-test-product'),
        status: ProductStatus.DRAFT,
      });

      productId = (res.body.data as { id: string }).id;
      productSlug = (res.body.data as { slug: string }).slug;
      variantId = (res.body.data as { variants: { id: string }[] }).variants[0].id;

      expect(productId).toBeDefined();
      expect(variantId).toBeDefined();
    });

    it('returns 409 when SKU already exists', async () => {
      await api()
        .post('/v1/admin/products')
        .set('Cookie', adminCookie)
        .send({
          name: { default: 'Another Product' },
          variants: [{ sku: 'E2E-SKU-001', price: 10 }],
        })
        .expect(409);
    });
  });

  // ── 2. Assign assets ──────────────────────────────────────────────────────

  describe('PATCH /v1/admin/products/:id/assets — assign assets', () => {
    it('returns 204 and assigns the asset as primary', async () => {
      await api()
        .patch(`/v1/admin/products/${productId}/assets`)
        .set('Cookie', adminCookie)
        .send({
          assets: [{ assetId, sortOrder: 0, isPrimary: true }],
        })
        .expect(204);
    });

    it('returns 400 when multiple primary assets provided', async () => {
      await api()
        .patch(`/v1/admin/products/${productId}/assets`)
        .set('Cookie', adminCookie)
        .send({
          assets: [
            { assetId, sortOrder: 0, isPrimary: true },
            { assetId, sortOrder: 1, isPrimary: true },
          ],
        })
        .expect(400);
    });

    it('asset is visible in admin product detail', async () => {
      const res = await api()
        .get(`/v1/admin/products/${productId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const assets = (res.body.data as { assets: { assetId: string; isPrimary: boolean }[] })
        .assets;
      expect(assets).toHaveLength(1);
      expect(assets[0].assetId).toBe(assetId);
      expect(assets[0].isPrimary).toBe(true);
    });
  });

  // ── 3. Query storefront (product not yet ACTIVE, should be hidden) ─────────

  describe('GET /v1/products — storefront listing', () => {
    it('does NOT return a DRAFT product', async () => {
      const res = await api().get('/v1/products').expect(200);
      const ids = (res.body.data as { id: string }[]).map((p) => p.id);
      expect(ids).not.toContain(productId);
    });

    it('returns the product once status is set to ACTIVE', async () => {
      // Activate the product
      await api()
        .patch(`/v1/admin/products/${productId}`)
        .set('Cookie', adminCookie)
        .send({ status: ProductStatus.ACTIVE })
        .expect(200);

      const res = await api().get(`/v1/products/${productSlug}`).expect(200);

      expect(res.body.data).toMatchObject({ id: productId, slug: productSlug });
    });

    it('returns full detail with assets and variants', async () => {
      const res = await api().get(`/v1/products/${productSlug}`).expect(200);

      const data = res.body.data as {
        assets: unknown[];
        variants: unknown[];
      };
      expect(data.assets).toHaveLength(1);
      expect(data.variants.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for unknown slug', async () => {
      await api().get('/v1/products/no-such-slug').expect(404);
    });
  });

  // ── 4. Archive (soft-delete) ──────────────────────────────────────────────

  describe('DELETE /v1/admin/products/:id — archive', () => {
    it('returns 204 and archives the product', async () => {
      await api().delete(`/v1/admin/products/${productId}`).set('Cookie', adminCookie).expect(204);
    });

    it('product no longer visible on storefront after archive', async () => {
      await api().get(`/v1/products/${productSlug}`).expect(404);
    });

    it('returns 404 when archiving an already-archived product (soft-deleted row is invisible)', async () => {
      await api().delete(`/v1/admin/products/${productId}`).set('Cookie', adminCookie).expect(404);
    });

    it('admin can still retrieve archived product by id', async () => {
      // The soft-delete middleware hides archived rows from list queries; the
      // admin detail endpoint explicitly falls back to the archived row.
      const res = await api()
        .get(`/v1/admin/products/${productId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.id).toBe(productId);
      expect(res.body.data.status).toBe(ProductStatus.ARCHIVED);
    });
  });

  // ── 5. Restore ─────────────────────────────────────────────────────────────

  describe('PATCH /v1/admin/products/:id/restore — restore', () => {
    it('returns 200 and restores the product to DRAFT', async () => {
      const res = await api()
        .patch(`/v1/admin/products/${productId}/restore`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: productId,
        status: ProductStatus.DRAFT,
      });
    });

    it('product is no longer on storefront (DRAFT status)', async () => {
      await api().get(`/v1/products/${productSlug}`).expect(404);
    });

    it('returns 404 when restoring a non-archived product', async () => {
      // Product is now DRAFT (not archived), restore should fail
      await api()
        .patch(`/v1/admin/products/${productId}/restore`)
        .set('Cookie', adminCookie)
        .expect(404);
    });
  });

  // ── Storefront — pagination & filtering ───────────────────────────────────

  describe('GET /v1/products — pagination', () => {
    it('returns paginated meta', async () => {
      const res = await api().get('/v1/products').query({ page: 1, pageSize: 5 }).expect(200);

      expect(res.body.meta).toMatchObject({
        page: 1,
        pageSize: 5,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
    });

    it('rejects invalid pageSize > 100', async () => {
      await api().get('/v1/products').query({ pageSize: 200 }).expect(400);
    });
  });

  // ── B3.2 products typed-code contract ────────────────────────────────
  //
  // Codifies the bare NotFound / Conflict / BadRequest throws across
  // `products.service.ts`. Each describe targets one code family.

  describe('B3.2 products typed-code contract', () => {
    it('GET /v1/admin/products/:id with unknown id emits PRODUCT_NOT_FOUND', async () => {
      const res = await api()
        .get('/v1/admin/products/00000000-0000-0000-0000-000000000000')
        .set('Cookie', adminCookie);
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('POST /v1/admin/products with duplicate slug emits PRODUCT_SLUG_TAKEN', async () => {
      const res = await api()
        .post('/v1/admin/products')
        .set('Cookie', adminCookie)
        .send({
          name: { default: 'Dup Slug Product', en: 'Dup Slug Product' },
          slug: productSlug,
          description: { default: 'dup', en: 'dup' },
          status: ProductStatus.ACTIVE,
          variants: [
            {
              sku: `DUP-SKU-${Date.now()}`,
              price: 99,
            },
          ],
        });
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('PRODUCT_SLUG_TAKEN');
    });

    it('DELETE /v1/admin/products/:variantId/variants/:id on the only active variant emits PRODUCT_VARIANT_LAST_ACTIVE or PRODUCT_NOT_FOUND', async () => {
      // This negative test uses a synthetic id that won't match — we only
      // assert the error envelope shape exists (either the not-found code or
      // the last-active code if the test product has one active variant).
      const res = await api()
        .delete(`/v1/admin/products/${productId}/variants/00000000-0000-0000-0000-000000000000`)
        .set('Cookie', adminCookie);
      expect([404, 409]).toContain(res.status);
      expect(res.body.error?.code).toMatch(/^PRODUCT_/);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Accept-Language matrix (§1.14 BLOCKER 6 — E5)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Closes the §1.14 BLOCKER 6 finding "Accept-Language e2e coverage missing on
// 5 core user-facing modules: products …". The matrix seeds a product with
// multi-locale Translatable name + description, then verifies the global
// `TranslatableInterceptor` resolves the response correctly per request header
// and surfaces the full object under the `X-Resolve-Locale: false` admin opt-out.
//
// Out-of-process: the API on :53001 already mounts ApiResponseInterceptor +
// TranslatableInterceptor globally, so the matrix exercises the live chain.

describe('Accept-Language matrix (E5 §1.14 BLOCKER 6)', () => {
  let matrixPrisma: PrismaClient;
  let matrixSlug: string;

  beforeAll(async () => {
    matrixPrisma = createTestPrisma();

    matrixSlug = `e2e-matrix-product-${Date.now()}`;
    // `default` and the store's SECONDARY locale carry the same value; the
    // store's DEFAULT locale carries a distinct one. A request for a locale
    // the store's own catalogue lacks (de) must fall through the store's
    // default rung, not a literal 'en' — which is only the default locale
    // under the demo fixture.
    await matrixPrisma.product.create({
      data: {
        slug: matrixSlug,
        name: {
          default: 'Matrix secondary-locale Name',
          [STORE_SECONDARY_LOCALE]: 'Matrix secondary-locale Name',
          [STORE_DEFAULT_LOCALE]: 'Matrix default-locale Name',
        },
        description: {
          default: 'A'.repeat(150),
          [STORE_SECONDARY_LOCALE]: 'A'.repeat(150),
          [STORE_DEFAULT_LOCALE]: 'B'.repeat(150),
        },
        shortDescription: {
          default: 'Court secondary',
          [STORE_SECONDARY_LOCALE]: 'Court secondary',
          [STORE_DEFAULT_LOCALE]: 'Short default',
        },
        status: ProductStatus.ACTIVE,
        publishedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await matrixPrisma.product.deleteMany({ where: { slug: matrixSlug } });
    await matrixPrisma.$disconnect();
  });

  it('resolves Translatable name to the store default locale', async () => {
    const res = await api()
      .get(`/v1/products/${matrixSlug}`)
      .set('Accept-Language', STORE_DEFAULT_LOCALE);
    expect(res.status).toBe(200);
    expect(res.body.data?.name).toBe('Matrix default-locale Name');
  });

  it('resolves Translatable name to the store secondary locale', async () => {
    const res = await api()
      .get(`/v1/products/${matrixSlug}`)
      .set('Accept-Language', STORE_SECONDARY_LOCALE);
    expect(res.status).toBe(200);
    expect(res.body.data?.name).toBe('Matrix secondary-locale Name');
  });

  it('returns full Translatable object when X-Resolve-Locale: false', async () => {
    const res = await api().get(`/v1/products/${matrixSlug}`).set('X-Resolve-Locale', 'false');
    expect(res.status).toBe(200);
    expect(res.body.data?.name).toEqual({
      default: 'Matrix secondary-locale Name',
      [STORE_SECONDARY_LOCALE]: 'Matrix secondary-locale Name',
      [STORE_DEFAULT_LOCALE]: 'Matrix default-locale Name',
    });
  });

  it('falls through to the store default rung when Accept-Language is unsupported (de)', async () => {
    const res = await api().get(`/v1/products/${matrixSlug}`).set('Accept-Language', 'de');
    expect(res.status).toBe(200);
    // `default` and the secondary locale carry the same value and the store's
    // default locale differs, so only the default rung can produce this
    // string. An unsupported locale must reach it.
    expect(res.body.data?.name).toBe('Matrix default-locale Name');
  });
});
