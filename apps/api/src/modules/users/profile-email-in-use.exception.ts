import { ConflictException } from '@nestjs/common';

/**
 * Caller attempted to update their profile email to one already owned by
 * another account. Raised at `users.service.ts:updateProfile` line 97
 * after the uniqueness probe. Carries a stable error code so the profile
 * page can surface a dedicated "email already in use" message instead
 * of the generic submission failure. See
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #12.
 */
export class ProfileEmailInUseException extends ConflictException {
  static readonly CODE = 'PROFILE_EMAIL_IN_USE' as const;

  constructor() {
    super({
      error: {
        code: ProfileEmailInUseException.CODE,
        message: 'Email already in use',
      },
    });
  }
}
