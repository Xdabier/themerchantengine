import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthStore } from '../stores/auth.store';

/**
 * Allows navigation only when the user is authenticated. Unauthenticated
 * navigation attempts are redirected to `/auth/login?returnTo=<path>` so we
 * can bounce the user back to their destination after login.
 */
export const authGuard: CanActivateFn = (_route, state): boolean | UrlTree => {
  const store = inject(AuthStore);
  const router = inject(Router);

  if (store.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/auth/login'], {
    queryParams: { returnTo: state.url },
  });
};
