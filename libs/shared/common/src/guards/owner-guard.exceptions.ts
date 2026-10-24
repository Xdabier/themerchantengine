import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

/**
 * Thrown by `OwnerGuardGuard` when a route is decorated with both `@OwnerGuard()`
 * and `@Public()` — a contradictory configuration that would silently bypass
 * per-customer ownership scoping if the runtime gate were missing. Fail-closed
 * so a misconfigured controller is caught at request time rather than in code
 * review. Developer-tier hard-error; not customer-facing.
 */
export class OwnerGuardPublicConflictException extends ForbiddenException {
  static readonly CODE = 'OWNER_GUARD_PUBLIC_CONFLICT' as const;

  constructor() {
    super({
      error: {
        code: OwnerGuardPublicConflictException.CODE,
        message: '@OwnerGuard route cannot also be @Public()',
      },
    });
  }
}

/**
 * Thrown by `OwnerGuardGuard` when a `@OwnerGuard()`-decorated route is reached
 * without a hydrated `req.user.id`. `JwtAuthGuard` normally absorbs this case
 * via the global guard chain — the assertion here is defense-in-depth against
 * a misordered chain, an accidental `@Public()` removal that bypasses auth, or
 * a future controller pattern that bypasses `req.user` hydration.
 */
export class OwnerGuardUserMissingException extends UnauthorizedException {
  static readonly CODE = 'OWNER_GUARD_USER_MISSING' as const;

  constructor() {
    super({
      error: {
        code: OwnerGuardUserMissingException.CODE,
        message: 'Authenticated user required',
      },
    });
  }
}
