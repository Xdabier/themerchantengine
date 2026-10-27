import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthStore } from '../stores/auth.store';

/**
 * Permission guard factory. Usage in a Route definition:
 *
 * ```ts
 * { path: 'orders', canActivate: [authGuard, permissionGuard('orders:view')], ... }
 * ```
 *
 * - If user is unauthenticated, defers to authGuard (assumes it runs first in
 *   the guard list). Returns UrlTree to /auth/login as a fallback.
 * - If authenticated but missing the permission, redirects to /403.
 */
export function permissionGuard(required: string | readonly string[]): CanActivateFn {
  const permissions = Array.isArray(required) ? required : [required];
  return (_route, state): boolean | UrlTree => {
    const store = inject(AuthStore);
    const router = inject(Router);

    if (!store.isAuthenticated()) {
      return router.createUrlTree(['/auth/login'], {
        queryParams: { returnTo: state.url },
      });
    }
    if (store.hasAnyPermission(permissions as string[])) {
      return true;
    }
    return router.createUrlTree(['/403']);
  };
}
