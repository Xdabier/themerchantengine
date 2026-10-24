import { NotFoundException } from '@nestjs/common';

/**
 * Storefront tried to add or remove a product on the wishlist whose ID does
 * not resolve to an existing product row. The bare
 * `NotFoundException('Product "<id>" not found')` at `wishlist.service.ts:112`
 * and `:138` is replaced with this typed exception so the storefront page
 * catches the error by stable code instead of a generic 404 toast — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #22.
 *
 * Note: the audit row also mentions "Prisma P2002 fallthrough" on the
 * `addItem` path; the implementation actually uses `prisma.wishlistItem
 * .upsert` (documented as "silently idempotent" — duplicate adds succeed
 * without firing P2002), so no second exception class is needed. The
 * `WISHLIST_ALREADY_ADDED` code the tasks file mentioned would require a
 * behavior change (switching `upsert` to `create + P2002 catch`) that
 * contradicts the documented idempotent contract and is not in scope here.
 */
export class WishlistProductNotFoundException extends NotFoundException {
  static readonly CODE = 'WISHLIST_PRODUCT_NOT_FOUND' as const;

  constructor(productId: string) {
    super({
      error: {
        code: WishlistProductNotFoundException.CODE,
        message: `Product "${productId}" not found`,
      },
    });
  }
}
