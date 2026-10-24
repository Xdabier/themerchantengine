import { ConflictException } from '@nestjs/common';

/**
 * Storefront submitted a `POST /v1/orders` with an `X-Idempotency-Key`
 * already claimed by an earlier request whose result has not yet been
 * cached. The atomic SET-NX sentinel at `orders.service.ts:createOrder`
 * (line 98) trapped the in-flight collision. Carries a stable error code
 * so the storefront can distinguish "retry me in a moment" from the
 * generic 409 surface — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #6.
 */
export class OrderIdempotencyInFlightException extends ConflictException {
  static readonly CODE = 'ORDER_IDEMPOTENCY_IN_PROGRESS' as const;

  constructor() {
    super({
      error: {
        code: OrderIdempotencyInFlightException.CODE,
        message: 'Order creation already in progress for this idempotency key',
      },
    });
  }
}
