import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { OWNER_GUARD_KEY } from '../decorators/owner-guard.decorator';
import {
  OwnerGuardPublicConflictException,
  OwnerGuardUserMissingException,
} from './owner-guard.exceptions';

/**
 * Runtime gate for storefront per-customer routes decorated with `@OwnerGuard()`.
 *
 * Constitution §3.3 mandates that storefront routes returning or mutating
 * per-customer data carry `@OwnerGuard()` on the controller AND verify
 * ownership at the service layer (`req.user.id === entity.userId`). The
 * controller-side decorator was previously metadata-only (`SetMetadata`) with
 * no `CanActivate` implementation — permissions-auditor §1.13 BLOCKER #1.
 *
 * This guard closes the gap with a thin, defense-in-depth check:
 *  - Routes without `@OwnerGuard()` short-circuit `true` in O(1) (the common case).
 *  - `@OwnerGuard()` + `@Public()` collision → `OwnerGuardPublicConflictException`.
 *  - `@OwnerGuard()` + no `req.user.id` → `OwnerGuardUserMissingException`.
 *  - `@OwnerGuard()` + hydrated `req.user.id` → pass; service layer enforces
 *    the actual entity-ownership scan.
 */
@Injectable()
export class OwnerGuardGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresOwnerGuard = this.reflector.getAllAndOverride<boolean>(OWNER_GUARD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiresOwnerGuard) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) throw new OwnerGuardPublicConflictException();

    const user = context.switchToHttp().getRequest<{ user?: { id?: string } }>().user;
    if (!user?.id) throw new OwnerGuardUserMissingException();

    return true;
  }
}
