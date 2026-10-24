import { inject, provideAppInitializer } from '@angular/core';
import { AuthService } from '@admin-services';
import { isStaff } from '@admin-types';
import { AuthStore } from './stores/auth.store';
import * as sentry from './sentry';

/**
 * Cold-start session bootstrap (constitution §3.15-C).
 *
 * The browser may already hold a valid Better Auth session cookie. Before any
 * route guard runs, resolve the session with a SINGLE `getSession()` call:
 *
 *   - A resolved `AdminUser` → committed to `AuthStore` in one atomic
 *     `setSession`. There is exactly one object — never an access-token + /me
 *     pair to reconcile — so half-hydrated state is structurally impossible.
 *   - No usable session (genuinely logged out, OR a transient 429 / 5xx /
 *     network / timeout) → the store is left exactly as it was on entry
 *     (empty). There is nothing partial to clear, so there is no
 *     `clearSession()` call here. The auth guard then bounces an anonymous
 *     visitor to /auth/login as normal.
 *
 * `getSession()` resolves `null` for every expected outcome — unauthenticated
 * and transient failures alike — and never throws for them. The try/catch is a
 * telemetry tripwire only: if the Better Auth client itself throws
 * unexpectedly, report it to Sentry and still let the app shell boot.
 */
export function provideSessionBootstrap() {
  return provideAppInitializer(async () => {
    const auth = inject(AuthService);
    const store = inject(AuthStore);

    try {
      const user = await auth.getSession();
      // Finding AD6: the auth cookie is shared across subdomains on production
      // by design, so a customer signed in on the storefront presents it here.
      // Refuse to commit rather than revoke: signing them out from this origin
      // would log them out of the STOREFRONT for clicking a wrong link. The
      // auth guard then bounces them to the admin login like any visitor.
      if (user && isStaff(user)) {
        store.setSession({ user });
      }
    } catch (err) {
      sentry.captureException(err);
      console.warn('[session-bootstrap] unexpected failure resolving session', err);
    }
  });
}
