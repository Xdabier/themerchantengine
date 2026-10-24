import { BadRequestException } from '@nestjs/common';

/**
 * Caller attempted to change a sensitive profile field (email, phone,
 * password) without supplying the `currentPassword` confirmation. Raised
 * at `users.service.ts:updateProfile` line 75 before any DB read. The
 * stable code lets the storefront profile page surface a dedicated
 * localized message instead of the generic "something went wrong" copy.
 * See `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #10.
 */
export class ProfileCurrentPasswordRequiredException extends BadRequestException {
  static readonly CODE = 'PROFILE_CURRENT_PASSWORD_REQUIRED' as const;

  constructor() {
    super({
      error: {
        code: ProfileCurrentPasswordRequiredException.CODE,
        message: 'Current password is required to change email, phone, or password',
      },
    });
  }
}
