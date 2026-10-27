import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { StorefrontConfigService, type StorefrontPublicConfig } from '@admin-services';
import { AuthStore } from './auth.store';

/**
 * The public storefront origin and product URL shape, hydrated once per
 * session so any admin screen can deep-link to the page a customer sees.
 *
 * Structural copy of `CurrencyStore`, including its retry discipline: the
 * request state lives in plain fields rather than signals, because an effect
 * that reads its own request signal re-triggers on failure and retries forever.
 *
 * The config is served by the API rather than baked into the admin build. The
 * origin is per BOX while the admin image is per BRANCH, and the two clients
 * are co-hosted, so a compiled-in origin would eventually point an operator at
 * the other client's storefront. Deriving it from the same place the sitemap
 * does keeps one answer.
 */
@Injectable({ providedIn: 'root' })
export class StorefrontLinkStore {
  private readonly auth = inject(AuthStore);
  private readonly storefront = inject(StorefrontConfigService);

  private readonly _config = signal<StorefrontPublicConfig | null>(null);

  private attempted = false;
  private inFlight = false;

  readonly config = this._config.asReadonly();
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
      this.attempted = false;
    });
  }

  /** Re-read the config. */
  refresh(): void {
    this.attempted = true;
    this.fetch();
  }

  /**
   * The public URL for a product slug, or null when it cannot be built.
   *
   * Null rather than a guess: an unhydrated or failed config must HIDE the
   * link, because emitting a plausible-looking origin would send an operator to
   * a different client's shop.
   *
   * Prefers the operator's own locale when the storefront serves it, so the
   * page opens in the language they are working in.
   */
  productUrl(slug: string | null | undefined): string | null {
    const config = this._config();
    if (!config || !slug) return null;
    const locale = config.locales.includes(this.auth.locale())
      ? this.auth.locale()
      : config.defaultLocale;
    const path = config.productPathTemplate
      .replace('{locale}', encodeURIComponent(locale))
      .replace('{slug}', encodeURIComponent(slug));
    return `${config.baseUrl}${path}`;
  }

  private fetch(): void {
    if (this.inFlight) return;
    this.inFlight = true;
    this.storefront.getPublicConfig().subscribe({
      next: (config) => {
        this._config.set(config);
        this.inFlight = false;
      },
      error: () => {
        // query-error-guard: allow — a failed config HIDES the link rather than
        // degrading a screen. There is nothing for the operator to act on and
        // nothing missing from the page they came for; surfacing an error here
        // would be noise on every product page for a display-only affordance.
        this.inFlight = false;
      },
    });
  }
}
