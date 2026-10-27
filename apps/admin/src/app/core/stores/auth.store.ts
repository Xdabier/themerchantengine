import { Injectable, computed, inject, signal } from '@angular/core';
import type { AdminUser } from '@admin-types';
import { defaultLocale, effectivePermissions } from '@admin-types';
import { BOOTSTRAP_LOCALE } from '../tokens';

/**
 * Signal-based singleton holding authentication state.
 *
 * After the Better Auth migration (DR-24) there is NO access token here — the
 * session is one `HttpOnly` cookie the browser owns and JavaScript cannot read
 * (constitution §3.3 / §3.10). The store holds only the resolved `AdminUser`
 * (identity + RBAC) and the active locale.
 *
 * `isAuthenticated` derives purely from whether a user is present — there is no
 * token to reconcile against. That is what makes the §3.15-C bootstrap atomic
 * by construction: `session-bootstrap` resolves ONE object via a single
 * `getSession()` and commits it once, or commits nothing.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly bootstrapLocale = inject(BOOTSTRAP_LOCALE);

  private readonly _user = signal<AdminUser | null>(null);
  private readonly _locale = signal<string>(this.bootstrapLocale);

  /** Full admin user profile. null when unauthenticated. */
  readonly user = this._user.asReadonly();
  /** Active locale for the Accept-Language header. */
  readonly locale = this._locale.asReadonly();

  /** True when a resolved user is present — the session cookie carries the rest. */
  readonly isAuthenticated = computed(() => this._user() !== null);

  /** Effective permission set, union of direct + role permissions. */
  readonly permissions = computed<ReadonlySet<string>>(() => {
    const u = this._user();
    return u ? effectivePermissions(u) : new Set();
  });

  /** Permission check used by `permissionGuard`. */
  hasPermission(permission: string): boolean {
    return this.permissions().has(permission);
  }

  hasAnyPermission(permissions: readonly string[]): boolean {
    const set = this.permissions();
    return permissions.some((p) => set.has(p));
  }

  /**
   * Commit a resolved session. Called once by `session-bootstrap` after the
   * single `getSession()`, and by the login / 2FA flows after a sign-in. There
   * is exactly one resolved object — no partial state to reconcile (§3.15-C).
   */
  setSession(args: { user: AdminUser }): void {
    this._user.set(args.user);
    if (args.user.locale) {
      this._locale.set(args.user.locale);
    }
  }

  /**
   * Mirror the active locale signal. Called by `MePage` after a successful
   * `PATCH /v1/users/me { locale }`. Persistence is the caller's concern —
   * this setter only updates the in-memory signal driving `Accept-Language`.
   */
  setLocale(locale: string): void {
    this._locale.set(locale);
  }

  /** Wipe every trace of the session. Called on sign-out. */
  clear(): void {
    this._user.set(null);
    this._locale.set(this.bootstrapLocale || defaultLocale);
  }
}
