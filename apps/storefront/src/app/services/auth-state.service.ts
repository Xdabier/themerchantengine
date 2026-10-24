import { Injectable, computed, signal } from '@angular/core';

import type { CustomerUser } from '@storefront-types';

/**
 * Per-render in-memory holder for the current storefront customer.
 *
 * After the Better Auth migration (DR-24) there is NO access token here — the
 * session is one `HttpOnly` cookie the browser owns and JavaScript cannot read
 * (constitution §3.3 / §3.11.6). `localStorage` / `sessionStorage` / IndexedDB
 * are never touched for auth material.
 *
 * `isAuthed` derives purely from whether a customer is present — there is no
 * token to reconcile against. That is what makes the §3.15-C boot atomic by
 * construction: `layout-shell.component.ts:boot()` resolves ONE object via a
 * single `getSession()` and commits it once, or commits nothing. Half-hydrated
 * state (token set, user null) — the storefront-side cause of the 2026-05-16
 * "login then refresh = logged out" cascade — is structurally impossible.
 *
 * Server-side render boots anonymous (no JS-readable cookie state on the
 * Angular side). The browser bundle's `boot()` resolves the session after
 * hydration, so the auth-aware UI swap happens inside a single change-detection
 * pass.
 */
export interface AuthSessionInput {
  user: CustomerUser;
}

/**
 * Where the one-shot browser boot stands. `'pending'` means the shell's
 * `getSession()` has not answered yet, so `isAuthed()` is not yet meaningful.
 */
export type AuthBootState = 'pending' | 'booted';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly _currentUser = signal<CustomerUser | null>(null);
  private readonly _bootState = signal<AuthBootState>('pending');
  private resolveBoot: (() => void) | null = null;
  private readonly bootPromise = new Promise<void>((resolve) => {
    this.resolveBoot = resolve;
  });

  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthed = computed(() => this._currentUser() !== null);
  /**
   * Boot progress, for templates that need to hold a decision until the
   * session is settled. Consumers that can await should use `whenBooted()`.
   */
  readonly bootState = this._bootState.asReadonly();

  /**
   * Commit a resolved session. Called once by `layout-shell.component.ts:boot()`
   * after the single `getSession()`, and by the login / register flows after a
   * sign-in. There is exactly one resolved object — no partial state to
   * reconcile (§3.15-C).
   */
  setSession(input: AuthSessionInput): void {
    this._currentUser.set(input.user);
  }

  /** Wipe the session. Called on sign-out and on a terminal 401. */
  clearSession(): void {
    this._currentUser.set(null);
  }

  /**
   * Mark the one-shot boot settled. Called by `layout-shell.component.ts:boot()`
   * in a `finally`, so a committed session, a null session and an unexpected
   * client fault all resolve waiters alike: each is a settled answer, and
   * consumers must never hang on the ones that mean "anonymous" (finding N4).
   *
   * Idempotent. Server-side renders never call it, and nothing on the SSR path
   * awaits the boot.
   */
  markBooted(): void {
    if (this._bootState() === 'booted') return;
    this._bootState.set('booted');
    this.resolveBoot?.();
    this.resolveBoot = null;
  }

  /**
   * Resolves once the browser boot has settled, immediately if it already has.
   * Every consumer that would otherwise read a not-yet-meaningful `isAuthed()`
   * awaits this first (constitution §3.15-C).
   *
   * No timeout: `AuthService.getSession()` resolves `null` for every expected
   * outcome and never throws for them, so the only way this hangs is an auth
   * client that hangs, which hangs the shell today too.
   */
  whenBooted(): Promise<void> {
    return this.bootPromise;
  }
}
