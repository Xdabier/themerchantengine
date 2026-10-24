import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthStore } from '../stores/auth.store';

/**
 * Prevents authenticated users from reaching guest-only routes (login,
 * forgot-password, reset-password). Redirects them home.
 */
export const guestOnlyGuard: CanActivateFn = (): boolean | UrlTree => {
  const store = inject(AuthStore);
  const router = inject(Router);

  if (!store.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/']);
};
