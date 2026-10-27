import { BadRequestException } from '@nestjs/common';

/**
 * Storefront or admin sent an `assetIds[]` payload referencing one or more
 * asset rows that do not exist. The bare
 * `BadRequestException('One or more asset IDs are invalid')` at
 * `reviews.service.ts` `createReview`, `updateReview`, and `adminUpdateReview`
 * is replaced with this typed exception so the storefront page catches the
 * error by stable code instead of substring matching — see
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #14.
 */
export class AssetInvalidException extends BadRequestException {
  static readonly CODE = 'ASSET_INVALID' as const;

  constructor() {
    super({
      error: {
        code: AssetInvalidException.CODE,
        message: 'One or more asset IDs are invalid',
      },
    });
  }
}
