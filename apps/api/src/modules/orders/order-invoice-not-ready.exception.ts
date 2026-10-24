import { NotFoundException } from '@nestjs/common';

/**
 * Storefront requested an invoice for an order whose invoice row has not
 * been generated yet (asynchronously created post-checkout per §4.8). The
 * bare `NotFoundException('Invoice not yet generated')` at
 * `orders.service.ts:882` is replaced with this typed exception so the
 * storefront page catches the deferred-availability case by stable code
 * instead of treating it as a generic missing-resource — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #19.
 */
export class OrderInvoiceNotReadyException extends NotFoundException {
  static readonly CODE = 'ORDER_INVOICE_NOT_READY' as const;

  constructor() {
    super({
      error: {
        code: OrderInvoiceNotReadyException.CODE,
        message: 'Invoice not yet generated',
      },
    });
  }
}
