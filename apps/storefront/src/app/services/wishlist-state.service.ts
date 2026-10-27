import { Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { WishlistService } from '@storefront-services';

import { AuthStateService } from './auth-state.service';

/**
 * The customer's wishlist membership, held once for the whole browser session.
 *
 * Finding W1: `WishlistToggleComponent` used to boot its own `signal(false)`
 * with no input and no fetch, so a wishlisted product showed an empty heart
 * after every reload, in the same browser, and the next click silently
 * re-added it against an idempotent upsert. Membership is a per-customer fact,
 * not a per-component one, so it lives here and every heart is a view over it.
 *
 * Hydration source is `GET /v1/wishlist/ids`, not `GET /v1/wishlist`: the list
 * endpoint pays for a product join, an asset join and an inventory grading
 * call to answer one bit per product, and caps at a page, so a customer with
 * more than a page of rows would get empty hearts past it.
 *
 * Mutations funnel through `add` / `remove` so a heart on a catalogue card, a
 * heart in the buy box and the wishlist page can never disagree. They apply
 * optimistically, roll back on failure and rethrow, so the caller can surface
 * the failure instead of the UI quietly lying.
 *
 * SSR: the auth store starts anonymous on the server pass and the platform
 * gate below is a second lock, so no request is ever dispatched during
 * prerender or SSR.
 */
@Injectable({ providedIn: 'root' })
export class WishlistStateService {
  private readonly authState = inject(AuthStateService);
  private readonly wishlist = inject(WishlistService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _ids = signal<ReadonlySet<string>>(new Set());
  readonly ids = this._ids.asReadonly();
  readonly count = computed(() => this._ids().size);

  /** In-flight hydration, so a burst of auth writes cannot fan out to N calls. */
  private inFlight: Promise<void> | null = null;

  constructor() {
    effect(() => {
      const authed = this.authState.isAuthed();
      if (!isPlatformBrowser(this.platformId)) return;
      if (authed) {
        void this.hydrate();
      } else {
        this._ids.set(new Set());
      }
    });
  }

  isWishlisted(productId: string): boolean {
    return this._ids().has(productId);
  }

  async add(productId: string): Promise<void> {
    if (this._ids().has(productId)) return;
    this.commit(productId, true);
    try {
      await this.wishlist.add(productId);
    } catch (err) {
      // Roll back so the heart reverts to its pre-click state, then rethrow so
      // the caller can surface the failure. Swallowing it here is what made
      // finding W2's UI half invisible.
      this.commit(productId, false);
      throw err;
    }
  }

  async remove(productId: string): Promise<void> {
    if (!this._ids().has(productId)) return;
    this.commit(productId, false);
    try {
      await this.wishlist.remove(productId);
    } catch (err) {
      this.commit(productId, true);
      throw err;
    }
  }

  /**
   * Re-read membership from the server. Called on the auth flip, and by any
   * flow that changes the wishlist without going through `add` / `remove` —
   * the cart's move-to-wishlist, for one, whose line carries no productId.
   */
  async hydrate(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchIds().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchIds(): Promise<void> {
    try {
      this._ids.set(new Set(await this.wishlist.ids()));
    } catch {
      // Non-fatal. Hearts render unpressed and the next mutation surfaces the
      // underlying problem; a half-applied set would be worse than an empty one.
    }
  }

  private commit(productId: string, member: boolean): void {
    const next = new Set(this._ids());
    if (member) next.add(productId);
    else next.delete(productId);
    this._ids.set(next);
  }
}
