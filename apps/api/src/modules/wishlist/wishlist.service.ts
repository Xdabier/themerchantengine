import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService, type VariantAvailability } from '../inventory/inventory.service';
import type { StockStatus } from '../inventory/inventory.constants';
import { tryPickVariantUrl } from '@common/asset-variants';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import type { ListWishlistDto } from './dto/list-wishlist.dto';
import { VALID_WISHLIST_SORT_FIELDS, WISHLIST_EVENTS } from './wishlist.constants';
import { WishlistProductNotFoundException } from './wishlist-product-not-found.exception';

// ── Prisma include shapes ────────────────────────────────────────────────────

const WISHLIST_ITEM_INCLUDE = {
  product: {
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      variants: { select: { id: true, price: true, isDefault: true, isActive: true } },
    },
  },
} as const;

/**
 * List-only include. Carries the primary-asset join and restricts variants to
 * the purchasable ones, mirroring the public products list
 * (`products.service.ts`) so a catalogue card and a wishlist row can never
 * disagree about the image or about which variant is buyable. `addItem` keeps
 * the lean include above: it returns an id and a slug and has no use for a join.
 */
const WISHLIST_LIST_INCLUDE = {
  product: {
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      assets: {
        where: { isPrimary: true },
        select: {
          assetId: true,
          sortOrder: true,
          isPrimary: true,
          asset: {
            select: { id: true, url: true, type: true, alt: true, status: true, variants: true },
          },
        },
        take: 1,
      },
      variants: {
        where: { isActive: true, deletedAt: null },
        select: { id: true, price: true, isDefault: true, isActive: true },
        orderBy: { isDefault: 'desc' },
      },
    },
  },
} as const;

/** Newest-first membership hydration cap. Documented in the API reference. */
const WISHLIST_IDS_LIMIT = 500;

/** Shape of the primary-asset join above, once Prisma has widened it to JSON. */
interface PrimaryAssetJoin {
  assetId: string;
  sortOrder: number;
  isPrimary: boolean;
  asset: {
    id: string;
    url: string;
    type: string;
    alt: unknown;
    status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
    variants: unknown;
  } | null;
}

/**
 * Flat `primaryAsset` at the card intent, built exactly like the products list.
 * Returns null when the product has no primary asset, and also when the asset
 * cannot resolve a card URL yet (still processing, or a malformed variants
 * payload) — the row then renders the branded fallback instead of failing the
 * whole page.
 */
function buildPrimaryAsset(join: PrimaryAssetJoin | undefined) {
  if (!join?.asset) return null;
  const variant = tryPickVariantUrl(join.asset, 'card');
  if (!variant) return null;
  return {
    id: join.asset.id,
    assetId: join.assetId,
    url: variant.url,
    type: join.asset.type,
    altText: join.asset.alt,
    isPrimary: join.isPrimary,
    sortOrder: join.sortOrder,
    assetVariants: variant.srcset ?? [],
  };
}

/** Grade for a variant the inventory module reported nothing for. */
const OUT_OF_STOCK: StockStatus = 'OUT_OF_STOCK';

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WishlistService {
  private readonly logger = new Logger(WishlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Lists user's wishlist items with live price and availability enrichment.
   * Enrichment:
   * - Price: from product's default variant
   * - Availability: the three-state grade for that variant
   */
  async list(userId: string, query: ListWishlistDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = (VALID_WISHLIST_SORT_FIELDS as readonly string[]).includes(query.sortBy ?? '')
      ? query.sortBy!
      : 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    // `price` is enriched from the variant, not a WishlistItem column — the DB
    // query falls back to createdAt and the page is re-sorted by price below.
    const dbSortBy = sortBy === 'price' ? 'createdAt' : sortBy;

    const where: Prisma.WishlistItemWhereInput = { userId };

    // ── Fetch paginated wishlist items ────────────────────────────────────
    const [items, total] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where,
        include: WISHLIST_LIST_INCLUDE,
        orderBy: { [dbSortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.wishlistItem.count({ where }),
    ]);

    // Get default variant (or first active variant) for price + availability.
    const defaultVariantOf = (item: (typeof items)[number]) =>
      item.product.variants.find((v) => v.isDefault && v.isActive) ??
      item.product.variants.find((v) => v.isActive) ??
      item.product.variants[0];

    // ── Grade availability for the whole page in one call ─────────────────
    // Through the same inventory helper the products and search endpoints use,
    // so a product card and its wishlist row can never disagree about a
    // variant's state. The exact count stays server-side: the catalogue
    // endpoints withhold it on purpose, and an account holder can wishlist the
    // whole catalogue, so emitting it here would read off the store's
    // inventory position through a side door (plan J, pass-2 finding W2).
    let grades = new Map<string, VariantAvailability>();
    const variantIds = items.map((item) => defaultVariantOf(item)?.id).filter(isDefined);
    if (variantIds.length) {
      try {
        grades = await this.inventory.availabilityForVariants(variantIds);
      } catch (err) {
        // A grading failure degrades to OUT_OF_STOCK rather than failing the
        // page, matching the previous per-item behaviour.
        this.logger.warn(`Failed to grade wishlist availability: ${(err as Error).message}`);
      }
    }

    const enriched = items.map((item) => {
      const defaultVariant = defaultVariantOf(item);
      const assets = (item.product as unknown as { assets: PrimaryAssetJoin[] }).assets;
      return {
        productId: item.product.id,
        productSlug: item.product.slug,
        productName: item.product.name,
        price: defaultVariant?.price ?? null,
        availability:
          (defaultVariant && grades.get(defaultVariant.id)?.availability) ?? OUT_OF_STOCK,
        // The row's Add-to-cart posts this id. Null when the product has no
        // purchasable variant, which is what disables the button honestly
        // instead of letting it fail after the click.
        variantId: defaultVariant?.id ?? null,
        primaryAsset: buildPrimaryAsset(assets?.[0]),
        addedAt: item.createdAt,
      };
    });

    if (sortBy === 'price') {
      enriched.sort((a, b) => {
        const pa = a.price == null ? 0 : Number(a.price);
        const pb = b.price == null ? 0 : Number(b.price);
        return sortOrder === 'asc' ? pa - pb : pb - pa;
      });
    }

    return { data: enriched, meta: { page, pageSize, total } };
  }

  /**
   * Membership hydration source: the productIds this customer has wishlisted,
   * newest first.
   *
   * Deliberately separate from `list()`. The heart toggle on every catalogue
   * card needs one bit per product, and `list()` pays for a product join, an
   * asset join and an inventory grading call to answer it, while capping at a
   * page. This is a single indexed id select, so the storefront hydrates the
   * whole set once per session. Capped at `WISHLIST_IDS_LIMIT`: past that a
   * customer gets hearts for their newest 500 rows, which is degradation, not
   * breakage.
   */
  async listIds(userId: string): Promise<{ productIds: string[] }> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId },
      select: { productId: true },
      orderBy: { createdAt: 'desc' },
      take: WISHLIST_IDS_LIMIT,
    });
    return { productIds: rows.map((row) => row.productId) };
  }

  /**
   * Adds a product to the user's wishlist.
   * Validates product exists.
   * Silently idempotent: if already in wishlist, succeeds without error.
   */
  async addItem(userId: string, productId: string): Promise<unknown> {
    // ── Validate product exists ─────────────────────────────────────────
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, slug: true, name: true },
    });
    if (!product) throw new WishlistProductNotFoundException(productId);

    // ── Upsert (idempotent) ────────────────────────────────────────────
    const item = await this.prisma.wishlistItem.upsert({
      where: { userId_productId: { userId, productId } },
      update: {},
      create: { userId, productId },
      include: WISHLIST_ITEM_INCLUDE,
    });

    this.events.emit(WISHLIST_EVENTS.ITEM_ADDED, { userId, productId });
    this.logger.log(`addItem: userId=${userId} productId=${productId}`);

    return { productId: item.product.id, productSlug: item.product.slug };
  }

  /**
   * Removes a product from the user's wishlist.
   * Returns silently if not in wishlist (idempotent).
   */
  async removeItem(userId: string, productId: string): Promise<void> {
    // ── Verify product exists ──────────────────────────────────────────
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new WishlistProductNotFoundException(productId);

    // ── Delete (if exists) ────────────────────────────────────────────
    await this.prisma.wishlistItem.deleteMany({
      where: { userId, productId },
    });

    this.events.emit(WISHLIST_EVENTS.ITEM_REMOVED, { userId, productId });
    this.logger.log(`removeItem: userId=${userId} productId=${productId}`);
  }

  /**
   * Checks if a product is in the user's wishlist.
   * Used internally by cart service for save-for-later check.
   */
  async isInWishlist(userId: string, productId: string): Promise<boolean> {
    const exists = await this.prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { userId: true },
    });
    return !!exists;
  }
}
