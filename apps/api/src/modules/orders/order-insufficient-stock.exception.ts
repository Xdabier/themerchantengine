import { ConflictException } from '@nestjs/common';

/**
 * Storefront submitted an order whose cart contains items the inventory
 * pipeline can no longer satisfy. Raised both by the pre-flight
 * `outOfStock` filter at `orders.service.ts:createOrder` (line 122) and
 * by the atomic decrement guard at line 280 (when stock disappears between
 * cart load and decrement). The optional `variantId` detail lets callers
 * highlight the offending line; the storefront ignores it today and shows
 * a generic localized message, but the code is what the storefront keys
 * its switch on — replacing the prior English-substring catch at
 * `apps/storefront/src/app/pages/[locale]/checkout/index.page.ts:389`.
 * See `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #8.
 */
export class OrderInsufficientStockException extends ConflictException {
  static readonly CODE = 'ORDER_INSUFFICIENT_STOCK' as const;

  constructor(variantId?: string) {
    super({
      error: {
        code: OrderInsufficientStockException.CODE,
        message: variantId
          ? `Insufficient stock for variant "${variantId}"`
          : 'Some items are out of stock',
        ...(variantId ? { details: { variantId } } : {}),
      },
    });
  }
}
