/**
 * Wishlist read surface (plan E, phase E1).
 *
 * The module had no backend e2e coverage at all. `GET /v1/wishlist` shipped a
 * flat row with no asset and no variant id, so every wishlist row rendered the
 * branded no-image placeholder and its Add-to-cart button errored client-side
 * before any request. This spec seals the additive read model and the new
 * membership endpoint that hydrates the heart toggles.
 *
 * Real dockerized DB per constitution §3.8. Expectations are derived from the
 * seeded rows rather than hardcoded, so a reseed cannot turn an assertion into
 * a tautology.
 */
import * as crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { api, createTestPrisma, signUpCustomer } from './helpers';

const RUN = crypto.randomUUID().slice(0, 8);
const CUSTOMER_EMAIL = `e-wishlist-${RUN}@e2e.test`;
const CUSTOMER_PASSWORD = 'WishlistSeal1!';

interface WishlistRow {
  productId: string;
  productSlug: string;
  price: string | null;
  availability: string;
  variantId: string | null;
  primaryAsset: {
    id: string;
    assetId: string;
    url: string;
    assetVariants: unknown[];
  } | null;
  addedAt: string;
}

describe('Wishlist read surface', () => {
  let prisma: PrismaClient;
  let cookie: string;
  let userId: string;

  /** An ACTIVE product carrying a primary asset that finished processing. */
  let withAssetId: string;
  let withAssetSlug: string;
  let withAssetDefaultVariantId: string;
  /** An ACTIVE product with no asset rows at all. */
  let withoutAssetId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // Selects for what the assertions below actually need, rather than taking
    // whatever `findFirst` returns first. The demo catalogue that
    // `prisma db seed` writes carries READY primary assets whose `variants`
    // column is NULL, so an unordered pick lands on one of those and
    // `primaryAsset` serializes to null through no fault of the endpoint.
    const withAsset = await prisma.product.findFirst({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        assets: {
          some: {
            isPrimary: true,
            asset: { status: 'READY', variants: { not: Prisma.DbNull } },
          },
        },
        variants: { some: { isActive: true, deletedAt: null } },
      },
      select: {
        id: true,
        slug: true,
        variants: {
          where: { isActive: true, deletedAt: null },
          select: { id: true, isDefault: true },
          orderBy: { isDefault: 'desc' },
        },
      },
    });
    if (!withAsset) {
      throw new Error(
        'seed has no ACTIVE product with a READY primary asset carrying asset variants',
      );
    }
    withAssetId = withAsset.id;
    withAssetSlug = withAsset.slug;
    withAssetDefaultVariantId = withAsset.variants[0].id;

    const withoutAsset = await prisma.product.findFirst({
      where: { status: 'ACTIVE', deletedAt: null, assets: { none: {} } },
      select: { id: true },
    });
    if (!withoutAsset) throw new Error('seed has no ACTIVE product without assets');
    withoutAssetId = withoutAsset.id;

    cookie = await signUpCustomer(prisma, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: CUSTOMER_EMAIL.toLowerCase() },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    try {
      await prisma.wishlistItem.deleteMany({ where: { userId } });
    } catch {
      // best-effort
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.wishlistItem.deleteMany({ where: { userId } });
  });

  // ── GET /v1/wishlist ───────────────────────────────────────────────────────

  describe('GET /v1/wishlist', () => {
    it('carries the card-intent primary asset, the buyable variant id and the availability grade', async () => {
      await api().post(`/v1/wishlist/${withAssetId}`).set('Cookie', cookie).expect(201);

      const res = await api().get('/v1/wishlist').set('Cookie', cookie).expect(200);
      const row = (res.body.data as WishlistRow[]).find((r) => r.productId === withAssetId);

      expect(row).toBeDefined();
      expect(row!.productSlug).toBe(withAssetSlug);
      expect(row!.variantId).toBe(withAssetDefaultVariantId);
      expect(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).toContain(row!.availability);
      expect(row!.primaryAsset).not.toBeNull();
      // The seed serves its variants as one-pixel data URIs; an upload serves an https URL.
      expect(row!.primaryAsset!.url).toMatch(/^(https?:\/\/.+|data:image\/[a-z]+;base64,.+)$/);
      expect(Array.isArray(row!.primaryAsset!.assetVariants)).toBe(true);
      expect(row!.primaryAsset!.assetVariants.length).toBeGreaterThan(0);
    });

    it('emits primaryAsset null rather than omitting the key for an assetless product', async () => {
      await api().post(`/v1/wishlist/${withoutAssetId}`).set('Cookie', cookie).expect(201);

      const res = await api().get('/v1/wishlist').set('Cookie', cookie).expect(200);
      const row = (res.body.data as WishlistRow[]).find((r) => r.productId === withoutAssetId);

      expect(row).toBeDefined();
      expect(row).toHaveProperty('primaryAsset');
      expect(row!.primaryAsset).toBeNull();
    });

    // Plan J retired the exact count. The additive fields must not bring it back.
    it('still grades availability instead of shipping the exact stock count', async () => {
      await api().post(`/v1/wishlist/${withAssetId}`).set('Cookie', cookie).expect(201);

      const res = await api().get('/v1/wishlist').set('Cookie', cookie).expect(200);
      const row = (res.body.data as WishlistRow[])[0] as unknown as Record<string, unknown>;

      expect(row).not.toHaveProperty('availableStock');
      const numericStockKeys = Object.entries(row)
        .filter(([key, value]) => /stock/i.test(key) && typeof value === 'number')
        .map(([key]) => key);
      expect(numericStockKeys).toEqual([]);
    });

    // The row's variantId is what Add-to-cart posts. An unbuyable id there is a
    // failed cart round trip on the customer's primary action.
    it('never emits a variantId that is inactive or soft-deleted', async () => {
      await api().post(`/v1/wishlist/${withAssetId}`).set('Cookie', cookie).expect(201);

      const res = await api().get('/v1/wishlist').set('Cookie', cookie).expect(200);
      const row = (res.body.data as WishlistRow[]).find((r) => r.productId === withAssetId)!;

      const variant = await prisma.productVariant.findUniqueOrThrow({
        where: { id: row.variantId! },
        select: { isActive: true, deletedAt: true, productId: true },
      });
      expect(variant).toMatchObject({ isActive: true, deletedAt: null, productId: withAssetId });
    });

    it('rejects an anonymous read with 401', async () => {
      await api().get('/v1/wishlist').expect(401);
    });
  });

  // ── GET /v1/wishlist/ids ───────────────────────────────────────────────────

  describe('GET /v1/wishlist/ids', () => {
    it('returns the caller productIds, newest first', async () => {
      await api().post(`/v1/wishlist/${withoutAssetId}`).set('Cookie', cookie).expect(201);
      await api().post(`/v1/wishlist/${withAssetId}`).set('Cookie', cookie).expect(201);

      const res = await api().get('/v1/wishlist/ids').set('Cookie', cookie).expect(200);

      expect(res.body.data.productIds).toEqual([withAssetId, withoutAssetId]);
    });

    it('answers an empty list for a customer with an empty wishlist', async () => {
      const res = await api().get('/v1/wishlist/ids').set('Cookie', cookie).expect(200);

      expect(res.body.data).toEqual({ productIds: [] });
    });

    it('never leaks another customer wishlist', async () => {
      await api().post(`/v1/wishlist/${withAssetId}`).set('Cookie', cookie).expect(201);

      const otherEmail = `e-wishlist-other-${RUN}@e2e.test`;
      const otherCookie = await signUpCustomer(prisma, otherEmail, CUSTOMER_PASSWORD);
      try {
        const res = await api().get('/v1/wishlist/ids').set('Cookie', otherCookie).expect(200);
        expect(res.body.data.productIds).toEqual([]);
      } finally {
        const other = await prisma.user.findUnique({
          where: { email: otherEmail.toLowerCase() },
          select: { id: true },
        });
        if (other) await prisma.wishlistItem.deleteMany({ where: { userId: other.id } });
      }
    });

    it('rejects an anonymous read with 401', async () => {
      await api().get('/v1/wishlist/ids').expect(401);
    });

    // `wishlist/ids` must not be swallowed by a `:productId` route.
    it('does not resolve through the add route: POST /v1/wishlist/ids is a 404 envelope', async () => {
      const res = await api().post('/v1/wishlist/ids').set('Cookie', cookie).expect(404);

      expect(res.body.error.code).toBe('WISHLIST_PRODUCT_NOT_FOUND');
    });
  });
});
