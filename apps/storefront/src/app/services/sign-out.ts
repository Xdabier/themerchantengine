import type { Router } from '@angular/router';

import type { AuthService } from '@storefront-services';

import type { AuthStateService } from './auth-state.service';
import type { LocaleService } from '../locale.service';
import { APP_ROUTES } from '../../lib/routes';

export interface SignOutDeps {
  authSvc: AuthService;
  authState: AuthStateService;
  locale: LocaleService;
  router: Router;
}

/**
 * The one sign-out path for the storefront.
 *
 * Sign-out used to live only inside the header account menu, so the account
 * pages had no way to offer it (finding A2) and any second caller would have
 * had to re-derive the same three-step ordering. All of it matters:
 *
 *   - The server call is best-effort. A failed `signOut()` must not strand the
 *     customer in a shell that still looks signed in, so the local state is
 *     cleared either way, in a `finally`.
 *   - `clearSession()` happens before the navigation, so the shell that
 *     renders at the destination is already the anonymous one.
 *   - The destination is the locale home. The trailing slash it carries is the
 *     URL contract, parsed by `TrailingSlashUrlSerializer` (finding A1).
 */
export async function signOutAndGoHome(deps: SignOutDeps): Promise<void> {
  try {
    await deps.authSvc.signOut();
  } catch {
    // Sign-out failures are non-fatal — clear client state and move on.
  } finally {
    deps.authState.clearSession();
    void deps.router.navigateByUrl(APP_ROUTES.home(deps.locale.locale()));
  }
}
