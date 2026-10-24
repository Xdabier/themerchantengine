/**
 * S18 — WS2 references endpoint + DR-07 hard-delete blocking.
 *
 * Admin uploads (DB-creates) two assets, links one to a product, then:
 *  - GET /v1/admin/assets/:id/references — lists the FK reference rows
 *  - DELETE /v1/admin/assets/:id — 409 ASSET_REFERENCED while linked
 *  - DELETE — 204 once the link is removed
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, loginAs, signUpCustomer, createTestPrisma, ADMIN } from './helpers';

const TEST_TAG = `assets-refs-${Date.now()}`;
const PRODUCT_SLUG = `e2e-${TEST_TAG}-tee`;

const TEST_SUFFIX = `@e2e-${TEST_TAG}.test`;
const TEST_PASSWORD = 'StrongPass1!';

describe('Assets — references + DR-07 hard-delete (e2e)', () => {
  let prisma: PrismaClient;

  let adminCookie: string;
  let customerCookie: string;

  let referencedAssetId: string;
  let unreferencedAssetId: string;
  let productId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    // Customer with no admin permissions — used for the 403 check.
    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Cust',
      lastName: 'Omer',
    });

    // Resolve product type for product creation
    const typesRes = await api()
      .get('/v1/admin/product-types')
      .set('Cookie', adminCookie)
      .expect(200);
    const productTypeId = typesRes.body.data[0]?.id;

    // Two assets — one will be linked to a product, the other left orphaned
    const linked = await prisma.asset.create({
      data: {
        url: 'https://cdn.test.local/assets-refs-linked.jpg',
        type: 'IMAGE',
        mimeType: 'image/jpeg',
        fileSize: 2048,
        status: 'READY',
        storagePath: `e2e/${TEST_TAG}/linked-${crypto.randomUUID()}.jpg`,
      },
    });
    referencedAssetId = linked.id;

    const orphan = await prisma.asset.create({
      data: {
        url: 'https://cdn.test.local/assets-refs-orphan.jpg',
        type: 'IMAGE',
        mimeType: 'image/jpeg',
        fileSize: 1024,
        status: 'READY',
        storagePath: `e2e/${TEST_TAG}/orphan-${crypto.randomUUID()}.jpg`,
      },
    });
    unreferencedAssetId = orphan.id;

    // Product attached to the referenced asset
    const productRes = await api()
      .post('/v1/admin/products')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'Assets Refs Tee', en: 'Assets Refs Tee' },
        slug: PRODUCT_SLUG,
        description: { default: 'Test product.', en: 'Test product.' },
        productTypeId,
      })
      .expect(201);
    productId = productRes.body.data.id;

    await api()
      .patch(`/v1/admin/products/${productId}/assets`)
      .set('Cookie', adminCookie)
      .send({ assets: [{ assetId: referencedAssetId, sortOrder: 0, isPrimary: true }] })
      .expect(204);
  });

  afterAll(async () => {
    try {
      if (productId) {
        await api().delete(`/v1/admin/products/${productId}`).set('Cookie', adminCookie);
        // The product-soft-delete leaves the ProductAsset row intact —
        // sweep it directly so the asset row can be removed below.
        await prisma.productAsset.deleteMany({ where: { productId } });
      }
      await prisma.asset
        .deleteMany({ where: { id: { in: [referencedAssetId, unreferencedAssetId] } } })
        .catch(() => undefined);
      await prisma.refreshToken.deleteMany({
        where: { user: { email: { endsWith: TEST_SUFFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    } catch {
      // ignore — best-effort cleanup
    }
    await prisma.$disconnect();
  });

  // ── GET /v1/admin/assets/:id/references ─────────────────────────────────

  describe('GET /v1/admin/assets/:id/references', () => {
    it('200 — surfaces the product reference for a linked asset', async () => {
      const res = await api()
        .get(`/v1/admin/assets/${referencedAssetId}/references`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.data.total).toBe(1);
      expect(res.body.data.products).toHaveLength(1);
      expect(res.body.data.products[0]).toMatchObject({
        kind: 'product',
        id: productId,
        label: PRODUCT_SLUG,
        route: `/products/${productId}/edit`,
      });
      expect(res.body.data.variants).toEqual([]);
      expect(res.body.data.reviews).toEqual([]);
      expect(res.body.data.returns).toEqual([]);
      expect(res.body.data.categories).toEqual([]);
      expect(res.body.data.sections).toEqual([]);
    });

    it('200 — empty payload for an unreferenced asset', async () => {
      const res = await api()
        .get(`/v1/admin/assets/${unreferencedAssetId}/references`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.products).toEqual([]);
    });

    it('200 — type=category narrows results to a single empty kind', async () => {
      const res = await api()
        .get(`/v1/admin/assets/${referencedAssetId}/references?type=category`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.data.products).toEqual([]);
      expect(res.body.data.categories).toEqual([]);
      expect(res.body.data.total).toBe(0);
    });

    it('400 — rejects an unknown type filter value', () => {
      return api()
        .get(`/v1/admin/assets/${referencedAssetId}/references?type=garbage`)
        .set('Cookie', adminCookie)
        .expect(400);
    });

    it('401 — unauthenticated request is rejected', () => {
      return api().get(`/v1/admin/assets/${referencedAssetId}/references`).expect(401);
    });

    it('403 — customer session without assets:view is rejected', () => {
      return api()
        .get(`/v1/admin/assets/${referencedAssetId}/references`)
        .set('Cookie', customerCookie)
        .expect(403);
    });
  });

  // ── DELETE /v1/admin/assets/:id (DR-07) ─────────────────────────────────

  describe('DELETE /v1/admin/assets/:id (DR-07)', () => {
    it('409 ASSET_REFERENCED — referenced asset cannot be hard-deleted', async () => {
      const res = await api()
        .delete(`/v1/admin/assets/${referencedAssetId}`)
        .set('Cookie', adminCookie)
        .expect(409);

      expect(res.body.error.code).toBe('ASSET_REFERENCED');
      expect(res.body.error.details.references.total).toBe(1);
      expect(res.body.error.details.references.products[0].id).toBe(productId);
    });

    it('204 — unreferenced asset deletes successfully', async () => {
      await api()
        .delete(`/v1/admin/assets/${unreferencedAssetId}`)
        .set('Cookie', adminCookie)
        .expect(204);

      const remaining = await prisma.asset.findUnique({ where: { id: unreferencedAssetId } });
      expect(remaining).toBeNull();
    });

    it('204 — after dropping the reference, the same asset can be deleted', async () => {
      await prisma.productAsset.deleteMany({
        where: { productId, assetId: referencedAssetId },
      });
      await api()
        .delete(`/v1/admin/assets/${referencedAssetId}`)
        .set('Cookie', adminCookie)
        .expect(204);
    });
  });
});
