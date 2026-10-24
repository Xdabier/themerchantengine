import { ConflictException } from '@nestjs/common';

/**
 * Storefront tried to cancel an order that has already advanced past the
 * customer-cancellable lifecycle window (SHIPPED, DELIVERED, etc.). The
 * pre-B2 code threw `BadRequestException` (400) here, but the storefront
 * page at `account/orders/[id]/index.page.ts:746` was already dispatching
 * on `StorefrontConflictError` (409) — the type-class catch never fired.
 * B2 flips the status to 409 in addition to emitting the typed code, so the
 * storefront catch starts working for the first time. See
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #18.
 */
/** Why the customer cancel was refused. */
export type CancelIneligibleReason = 'STATUS' | 'HAS_SHIPMENT';

export class OrderCancelIneligibleException extends ConflictException {
  static readonly CODE = 'ORDER_CANCEL_INELIGIBLE' as const;

  /**
   * `details.reason` distinguishes the two refusals so the storefront can say
   * which one happened (finding AD4). `STATUS` means the order left the
   * customer-cancellable window; `HAS_SHIPMENT` means fulfilment already
   * started, which can refuse a CONFIRMED order the status rule would allow.
   */
  constructor(status: string, reason: CancelIneligibleReason = 'STATUS') {
    super({
      error: {
        code: OrderCancelIneligibleException.CODE,
        message:
          reason === 'HAS_SHIPMENT'
            ? 'This order is already being prepared and can no longer be cancelled online'
            : `Cannot cancel order in ${status} status`,
        details: { reason, status },
      },
    });
  }
}
