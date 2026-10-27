import { ForbiddenException } from '@nestjs/common';

/**
 * Authenticated user lacks the required `@Permissions('module:action')` for the route,
 * or the request reached the permissions guard without an attached user. Both call sites
 * in `permissions.guard.ts` collapse to one code — the guard cannot expose which
 * permission was missing without violating the §3.7 secrets-in-logs / response posture.
 */
export class AuthPermissionInsufficientException extends ForbiddenException {
  static readonly CODE = 'AUTH_PERMISSION_INSUFFICIENT' as const;

  constructor() {
    super({
      error: {
        code: AuthPermissionInsufficientException.CODE,
        message: 'Insufficient permissions',
      },
    });
  }
}
