import { BadRequestException } from '@nestjs/common';

/**
 * Storefront submitted a coupon code that failed validation. The four
 * underlying failure modes at `promotions.service.ts:106,117,127,151` —
 * not-found / expired / per-user-limit / global-limit / exclusive-collision
 * — collapse into this single code by design: the §8.1 API6 enumeration-mask
 * spec mandates that the wire response never leaks which reason a coupon
 * was rejected. The bare `BadRequestException('Invalid coupon')` previously
 * thrown is replaced with this typed exception so the storefront page can
 * catch by stable code instead of by status — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #16.
 */
export class CouponInvalidException extends BadRequestException {
  static readonly CODE = 'COUPON_INVALID' as const;

  constructor() {
    super({
      error: {
        code: CouponInvalidException.CODE,
        message: 'Invalid coupon',
      },
    });
  }
}
