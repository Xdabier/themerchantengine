import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { IS_PUBLIC_KEY, IS_OPTIONAL_AUTH_KEY } from '@common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { auth } from '../auth/auth';

/**
 * The global authentication guard — replaces the retired `JwtAuthGuard`.
 *
 * Resolves the Better Auth session from the request cookies, loads the user's
 * `Role` + `RolePermission`s fresh from the database, and populates
 * `req.user = { id, role, permissions }` — the exact shape `PermissionsGuard`
 * and `@OwnerGuard` consume, so neither needs to change.
 *
 * Authorization (the `module:action` RBAC) is unchanged. See DR-24 and
 * `agent_docs/auth-rbac.md`.
 *
 * `@Public()` routes skip the guard entirely; `@OptionalAuth()` routes proceed
 * anonymously when there is no session. A soft-deleted user (filtered out by
 * the extended `PrismaService` client) or a deactivated user (`isActive:false`)
 * is rejected even with an otherwise-valid session cookie (spec §4.D6).
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    const sessionResult = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    // `sessionResult` is `null` when no cookie / invalid cookie. `sessionResult.user`
    // is `null` when the cookie resolves to a session row but the underlying user
    // was soft-deleted / deactivated mid-session — the customSession plugin
    // returns `user: null` in that branch (apps/api/src/auth/auth.ts) so a
    // stale cookieCache entry cannot serve a half-formed user object.
    if (!sessionResult || !sessionResult.user) {
      if (isOptionalAuth) return true; // proceed anonymously
      throw new UnauthorizedException({
        error: { code: 'AUTH_UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    // Load the user fresh through the soft-delete-extended PrismaService — a
    // soft-deleted user (deletedAt set) resolves to null and is rejected
    // (spec §4.D6). Permissions are read here, not carried in a token, so a
    // role or permission change takes effect on the next request.
    const user = await this.prisma.user.findUnique({
      where: { id: sessionResult.user.id },
      include: { customRole: { include: { permissions: true } } },
    });

    if (!user) {
      if (isOptionalAuth) return true;
      throw new UnauthorizedException({
        error: { code: 'AUTH_UNAUTHENTICATED', message: 'Authentication required' },
      });
    }

    // A deactivated account holds no valid session, even on an optional-auth route.
    if (!user.isActive) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_USER_DEACTIVATED', message: 'Account is deactivated' },
      });
    }

    request.user = {
      id: user.id,
      role: user.role,
      permissions: user.customRole?.permissions.map((p) => p.permission) ?? [],
    };

    return true;
  }
}
