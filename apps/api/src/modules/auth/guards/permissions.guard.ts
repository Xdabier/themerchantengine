import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, IS_PUBLIC_KEY } from '@common/decorators';
import { AuthPermissionInsufficientException } from '../auth-permission-insufficient.exception';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Public routes bypass permission checks
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Permissions() decorator → open to any authenticated user
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new AuthPermissionInsufficientException();

    // SUPER_ADMIN bypasses all permission checks
    if (user.role === 'SUPER_ADMIN') return true;

    const hasPermission = required.some((perm: string) => user.permissions?.includes(perm));
    if (!hasPermission) {
      throw new AuthPermissionInsufficientException();
    }

    return true;
  }
}
