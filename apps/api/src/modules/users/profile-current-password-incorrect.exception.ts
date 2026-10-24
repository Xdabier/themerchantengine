import { UnauthorizedException } from '@nestjs/common';

/**
 * Caller supplied a `currentPassword` that does not match the stored hash.
 * Raised at `users.service.ts:updateProfile` line 88 after `bcrypt.compare`
 * returns false. HTTP 401 is preserved (a wrong password is semantically
 * an auth failure), but the stable code lets the storefront profile page
 * branch inside its `StorefrontUnauthorizedError` handler so a wrong
 * current-password no longer clears the session and bounces the customer
 * to the login form mid-edit. See
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #11.
 */
export class ProfileCurrentPasswordIncorrectException extends UnauthorizedException {
  static readonly CODE = 'PROFILE_CURRENT_PASSWORD_INCORRECT' as const;

  constructor() {
    super({
      error: {
        code: ProfileCurrentPasswordIncorrectException.CODE,
        message: 'Current password is incorrect',
      },
    });
  }
}
