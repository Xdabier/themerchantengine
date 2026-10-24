import type { PrismaClient } from '@prisma/client';

/**
 * Idempotence keys for the fixture catalogue seed. Every catalogue-scoped row carries
 * one of these markers so the seed can re-run safely without duplicating data
 * and without touching the baseline seed (admin user, default categories, etc.).
 */
export const FIXTURE_CATALOGUE_PREFIXES = {
  /** Category and Product `slug` prefix. */
  slug: 'fx-',
  /** GiftCard `code` prefix. Alphanumeric-only so seeded codes satisfy
   * `ApplyGiftCardDto` (8–20 uppercase alphanumeric, no dashes). */
  giftCardCode: 'FXGIFT',
  /** Promotion `couponCode` literals. */
  couponCodes: ['FIXTURE10', 'WELCOME50'] as const,
  /** Customer + reviewer email prefix used for the catalogue-scoped customer pool. */
  customerEmailDomain: '@fixture.test',
  /** InventoryLocation `code` for the catalogue-scoped warehouse. */
  inventoryLocationCode: 'FIXTURE-MAIN-WH',
} as const;

/**
 * Models that are append-only per constitution §3.4. The seed must NEVER
 * write to any of these — even via cascade. Asserted by
 * `__tests__/append-only-static.spec.ts`.
 */
export const APPEND_ONLY_MODELS = [
  'order',
  'orderItem',
  'inventoryMovement',
  'giftCardTransaction',
  'promotionUsage',
  'auditLogEntry',
  'return',
  'returnItem',
  'invoice',
] as const;

/**
 * Drop the catalogue-scoped rows + their dependents in the correct FK order so
 * a re-seed produces the same end-state. Never touches append-only tables.
 *
 * Returns counts of each entity type cleared, useful for the seed-runner log.
 */
export async function clearFixtureCatalogueScope(
  prisma: PrismaClient,
): Promise<Record<string, number>> {
  const cleared: Record<string, number> = {};

  // Wishlist rows owned by fixture catalogue customers. Filter `deletedAt: null`
  // explicitly so this works whether the Prisma client has soft-delete
  // middleware mounted or not — the cleanup operates on live rows only;
  // soft-deleted fixture catalogue rows are left alone.
  const customers = await prisma.user.findMany({
    where: { email: { endsWith: FIXTURE_CATALOGUE_PREFIXES.customerEmailDomain }, deletedAt: null },
    select: { id: true, email: true },
  });
  const customerIds = customers.map((c) => c.id);
  // The COD-test customer (`cod-test+fixture@fixture.test`) owns the
  // seeded DELIVERED order created by `orders.ts`. Hard-deleting the user
  // would set Order.userId to NULL (FK `SetNull` per schema.prisma:827)
  // and orphan the fixture — a re-seed would then create a fresh customer
  // id with no DELIVERED order linked, regressing the verified-purchase
  // gate at reviews.service.ts:117-127. We preserve the customer across
  // re-seeds; their wishlist / addresses / helpful votes still get
  // cleared below by `userId IN customerIds`, and customer.ts upserts the
  // user row to refresh non-key fields.
  const deletableCustomerIds = customers
    .filter((c) => !c.email.startsWith('cod-test+'))
    .map((c) => c.id);

  if (customerIds.length) {
    cleared.wishlistItems = (
      await prisma.wishlistItem.deleteMany({ where: { userId: { in: customerIds } } })
    ).count;
    cleared.helpfulVotes = (
      await prisma.helpfulVote.deleteMany({ where: { userId: { in: customerIds } } })
    ).count;
    cleared.addresses = (
      await prisma.address.deleteMany({ where: { userId: { in: customerIds } } })
    ).count;
  }

  // Reviews + Questions on fixture catalogue products (keyed by product slug prefix).
  const catalogueProducts = await prisma.product.findMany({
    where: { slug: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug }, deletedAt: null },
    select: { id: true },
  });
  const productIds = catalogueProducts.map((p) => p.id);

  if (productIds.length) {
    cleared.reviews = (
      await prisma.review.deleteMany({ where: { productId: { in: productIds } } })
    ).count;
    cleared.productQuestions = (
      await prisma.productQuestion.deleteMany({ where: { productId: { in: productIds } } })
    ).count;
    cleared.productFaqs = (
      await prisma.productFaq.deleteMany({ where: { productId: { in: productIds } } })
    ).count;
    cleared.productAssets = (
      await prisma.productAsset.deleteMany({ where: { productId: { in: productIds } } })
    ).count;
    cleared.productCategories = (
      await prisma.productCategory.deleteMany({ where: { productId: { in: productIds } } })
    ).count;
    // StockLevel cascades from variant; clear via variant scope below.
    const variants = await prisma.productVariant.findMany({
      where: { productId: { in: productIds }, deletedAt: null },
      select: { id: true },
    });
    const variantIds = variants.map((v) => v.id);
    if (variantIds.length) {
      cleared.stockLevels = (
        await prisma.stockLevel.deleteMany({ where: { variantId: { in: variantIds } } })
      ).count;
    }
    // Soft-delete variants instead of hard-delete: `InventoryMovement` rows
    // reference variants with `onDelete: Restrict` (constitution §3.4 — those
    // movement records are append-only and must never be deleted). Setting
    // `deletedAt` logically removes the variants while satisfying the FK
    // constraint. The products seed uses `upsert` by SKU so re-runs recreate
    // the rows with `deletedAt: null`.
    cleared.productVariants = (
      await prisma.productVariant.updateMany({
        where: { productId: { in: productIds }, deletedAt: null },
        data: { deletedAt: new Date() },
      })
    ).count;
  }

  // Products + Categories (catalogue-scoped only).
  // Soft-delete products for the same reason: `ProductVariant.productId` is
  // `onDelete: Restrict`, and the soft-deleted variant rows still reference
  // their parent product. The products seed uses `upsert` by slug.
  cleared.products = (
    await prisma.product.updateMany({
      where: { slug: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug }, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  ).count;

  // Promotions (the 3 catalogue-scoped: 2 coupons + 1 auto Electronics promo).
  // Coupon promos identified by couponCode literal; auto promo identified by category join.
  cleared.promotionCategories = (
    await prisma.promotionCategory.deleteMany({
      where: { category: { slug: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug } } },
    })
  ).count;
  cleared.promotionProducts = (
    await prisma.promotionProduct.deleteMany({
      where: { product: { slug: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug } } },
    })
  ).count;
  cleared.promotions = (
    await prisma.promotion.deleteMany({
      where: {
        deletedAt: null,
        OR: [
          { couponCode: { in: [...FIXTURE_CATALOGUE_PREFIXES.couponCodes] } },
          // Auto-promo (no couponCode) is identified by its `PromotionCategory`
          // join to an catalogue-scoped category — those joins were already
          // cleared above, so the orphaned auto-promo is hard-cleared here on
          // re-runs by matching the seeded name. The seed re-creates from
          // scratch on every run regardless.
          { name: { path: ['en'], equals: 'Electronics Sale 10%' } },
        ],
      },
    })
  ).count;

  // Categories last — products are already gone, so the FK Restrict on
  // ProductCategory.categoryId is satisfied.
  cleared.categories = (
    await prisma.category.deleteMany({
      where: { slug: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug }, deletedAt: null },
    })
  ).count;

  // Gift cards.
  cleared.giftCards = (
    await prisma.giftCard.deleteMany({
      where: { code: { startsWith: FIXTURE_CATALOGUE_PREFIXES.giftCardCode }, deletedAt: null },
    })
  ).count;

  // Reviewer pool only. Cascade-safe because reviews/questions/votes were
  // already cleared above. The COD-test customer is preserved (see filter
  // at the top of this function) so the seeded DELIVERED order keeps its
  // owner across re-seeds.
  if (deletableCustomerIds.length) {
    cleared.users = (
      await prisma.user.deleteMany({
        where: { id: { in: deletableCustomerIds }, deletedAt: null },
      })
    ).count;
  }

  // Shipping zone + method (catalogue-scoped by the `fx-` id prefix). Methods
  // first — ShippingMethod.zoneId is `onDelete: Restrict` — then the zone.
  // Neither is append-only; an Order keeps only a `shippingMethodName` string
  // snapshot (no FK to ShippingMethod), so deleting the method is FK-safe. The
  // shipping seed re-upserts both with the same ids on the next run.
  cleared.shippingMethods = (
    await prisma.shippingMethod.deleteMany({
      where: { id: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug } },
    })
  ).count;
  cleared.shippingZones = (
    await prisma.shippingZone.deleteMany({
      where: { id: { startsWith: FIXTURE_CATALOGUE_PREFIXES.slug } },
    })
  ).count;

  // Asset rows the seed planted are NOT cleared. With deterministic ids
  // (`uuidv5(storageId, SEED_ASSET_NAMESPACE)`) and a content-hashed
  // storagePath, every reseed converges on the same row id. The DB
  // short-circuit in `ingestImage` then re-uses the row instead of
  // recreating it — which keeps the bucket and Asset table from churning
  // across reseeds. Genuinely-orphaned binaries (source PNG removed from
  // `../new/`) are reconciled by `scripts/cleanup-orphan-assets.ts`, not
  // here.

  return cleared;
}
