import { Router } from '@angular/router';

import { AuthStateService } from '../../../services/auth-state.service';
import { LocaleService } from '../../../locale.service';
import { APP_ROUTES } from '../../../../lib/routes';

/**
 * Hydration-side auth check for every `/account/*` page (track-by-number
 * exempt — that page is intentionally public per
 * `docs/storefront-api-reference.md` §"Orders").
 *
 * The SSR pass renders the shell anonymously per
 * `agent_docs/storefront/architecture.md`. After hydration the page calls
 * this helper. If the customer is not authed it navigates to the login route
 * with a `?from=<currentPath>` query so the post-login flow returns the user
 * to the originating account surface.
 *
 * Awaits the session boot outcome before deciding. Reading `isAuthed()` the
 * instant the page mounted redirected customers whose valid cookie was still
 * being resolved by the shell's single `getSession()` (finding N4). The await
 * is instant once boot has settled, so the post-401 re-guard calls pay nothing.
 *
 * Resolves `true` when the caller is allowed to continue loading data, `false`
 * when the redirect has been dispatched and the caller should bail.
 */
export interface AccountAuthGuardDeps {
  authState: AuthStateService;
  locale: LocaleService;
  router: Router;
}

export async function ensureAuthedForAccount(
  deps: AccountAuthGuardDeps,
  currentPath: string,
): Promise<boolean> {
  await deps.authState.whenBooted();
  if (deps.authState.isAuthed()) return true;
  const target = `${APP_ROUTES.auth.login(deps.locale.locale())}?from=${encodeURIComponent(
    currentPath,
  )}`;
  void deps.router.navigateByUrl(target);
  return false;
}
