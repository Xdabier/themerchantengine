import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CurrenciesService, type StoreCurrency } from '@admin-services';
import { MONEY_DECIMAL_PLACES } from '@admin-types';
import { AuthStore } from './auth.store';

/**
 * Signal-based singleton holding the store's display currency.
 *
 * Every money surface in the admin formats through this (via the `money` pipe or
 * `formatMoney`). Before it existed, nine independent formatters each carried
 * their own hardcoded default and the EUR store was shown `US$100.00`.
 *
 * Mirrors the `AuthStore` shape rather than TanStack Query: the value is ambient
 * app-level config read synchronously by a pipe and by pure utils that live
 * outside any component query scope.
 *
 * Hydration is one small authenticated request fired on the unauthenticated ->
 * authenticated transition. On failure the config stays `null`, which renders
 * bare amounts (`100.00`) rather than a fabricated code — never guess a currency.
 * A failure is not retried on a timer; `refresh()` is the deliberate lever.
 */
@Injectable({ providedIn: 'root' })
export class CurrencyStore {
  private readonly auth = inject(AuthStore);
  private readonly currencies = inject(CurrenciesService);

  private readonly _config = signal<StoreCurrency | null>(null);

  /**
   * Plain fields, not signals, on purpose: the hydration effect must depend on
   * `isAuthenticated` alone. Tracking request state in a signal the effect reads
   * makes a failed fetch re-trigger the effect and retry forever.
   */
  private attempted = false;
  private inFlight = false;

  /** Full store-currency config. null until hydrated, or after a failed fetch. */
  readonly config = this._config.asReadonly();

  /** ISO code of the store currency, or null while unhydrated. */
  readonly code = computed(() => this._config()?.code ?? null);

  /** Currency codes the store accepts. Empty while unhydrated. */
  readonly enabled = computed<readonly string[]>(() => this._config()?.enabled ?? []);

  /**
   * Fraction digits the store currency carries. Every money INPUT gate reads
   * this — the scale validator and the native `step` — so an operator can enter
   * a millime on a three-decimal currency without a client-side rejection.
   * Falls back to the shared constant while unhydrated rather than to 2, since
   * a too-small scale rejects a legal amount whereas a too-large one only
   * accepts a value the backend then validates anyway.
   */
  readonly decimalPlaces = computed(() => this._config()?.decimalPlaces ?? MONEY_DECIMAL_PLACES);

  /** True once a config has been committed. Forms gate on this instead of guessing. */
  readonly hydrated = computed(() => this._config() !== null);

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        if (!this.attempted) {
          this.attempted = true;
          this.fetch();
        }
        return;
      }
      // Signed out: let the next operator's session hydrate again.
      this.attempted = false;
    });
  }

  /** Re-read the store currency. Call after any mutation that can change it. */
  refresh(): void {
    this.attempted = true;
    this.fetch();
  }

  private fetch(): void {
    if (this.inFlight) return;
    this.inFlight = true;
    this.currencies.getStore().subscribe({
      next: (config) => {
        this._config.set(config);
        this.inFlight = false;
      },
      error: (err: unknown) => {
        // Deliberately non-blocking for the operator: money falls back to bare
        // amounts rather than failing a screen on a display-config fetch.
        this.inFlight = false;
        console.warn('[CurrencyStore] store currency unavailable, money renders bare', err);
      },
    });
  }
}
