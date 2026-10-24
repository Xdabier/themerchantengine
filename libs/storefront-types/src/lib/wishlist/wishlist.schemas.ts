import { z } from 'zod';
import { wishlistItemSchema } from '../shared/entities';

/**
 * Storefront wishlist schemas. Mirrors
 * `apps/api/src/modules/wishlist/dto/list-wishlist.dto.ts:ListWishlistDto`. All
 * routes class-level `@OwnerGuard()` — server enforces caller-owns-list.
 */

export const listWishlistQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sortBy: z.enum(['createdAt', 'productName', 'price']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type ListWishlistQuery = z.infer<typeof listWishlistQuerySchema>;

/**
 * `GET /v1/wishlist/ids` — the membership hydration source.
 *
 * Deliberately not `wishlistItemSchema[]`: the heart toggle on every catalogue
 * card needs one bit per product, and the list endpoint pays for a product
 * join, an asset join and an inventory grading call to answer it while capping
 * at one page. The API caps this at the 500 newest rows.
 */
export const wishlistIdsSchema = z.object({
  productIds: z.array(z.string()),
});
export type WishlistIds = z.infer<typeof wishlistIdsSchema>;

export { wishlistItemSchema };
export type { WishlistItem } from '../shared/entities';
