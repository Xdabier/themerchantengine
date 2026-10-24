import { BadRequestException } from '@nestjs/common';

/**
 * Storefront called the set-default-address endpoint without setting either
 * `isDefaultShipping` or `isDefaultBilling` true. The bare
 * `BadRequestException('At least one of ... must be true')` at
 * `users.service.ts:220` is replaced with this typed exception so the
 * storefront page can catch the validation rejection by stable code instead
 * of relying on the global flat 400-toast — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #26.
 */
export class AddressDefaultFlagRequiredException extends BadRequestException {
  static readonly CODE = 'ADDRESS_DEFAULT_FLAG_REQUIRED' as const;

  constructor() {
    super({
      error: {
        code: AddressDefaultFlagRequiredException.CODE,
        message: 'At least one of isDefaultShipping or isDefaultBilling must be true',
      },
    });
  }
}
