import { isPlatformBrowser } from '@angular/common';
import { Injectable, Injector, PLATFORM_ID, inject } from '@angular/core';

import { AnalyticsApiService } from '@storefront-services';
import type { AnalyticsEvent, AnalyticsEventType } from '@storefront-types';

import { LocaleService } from '../locale.service';
import { AuthStateService } from './auth-state.service';
import { PixelService } from './pixel.service';
import { StoreConfigService } from './store-config.service';

/**
 * First-party analytics emission for the whole storefront.
 *
 * `POST /v1/analytics/events` has been complete since the analytics module
 * shipped and nothing ever called it, so every admin analytics dashboard read
 * an empty table and the server-side purchase forwarding never ran (finding
 * D2). This is the one place that calls it.
 *
 * Three rules hold everywhere:
 *
 * - **Browser only.** SSR would attribute one event per render to the server,
 *   and a session id that belongs to a server process describes nothing.
 * - **Silent.** Every failure path resolves and logs nothing at error level.
 *   The e2e console baseline fails a journey on any `console.error`, so a
 *   beacon that logs one takes every mutation journey down with it, and more
 *   plainly: a marketing beacon must never be able to fail a page.
 * - **Never awaited by a caller on a critical path.** `placeOrder` must not
 *   wait for a tracking post before its redirect.
 */

/** Per-tab session id. `sessionStorage`, not `localStorage`: an analytics
 * session ends with the tab, and nothing here is a credential. */
export const ANALYTICS_SESSION_STORAGE_KEY = 'storefront_analytics_session';

/** Orders already reported, so a reload of the confirmation page cannot
 * double-count revenue. Survives a reload for the same reason. */
const PURCHASE_SENT_STORAGE_KEY = 'storefront_analytics_purchases';

/** The character set the API's `sessionId` pattern accepts. */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

export interface PurchaseEventInput {
  orderId: string;
  orderNumber: string;
  total: number;
}

/**
 * One first-party name, the two vendor names it means.
 *
 * Each vendor has its own vocabulary for the same moment, and getting one wrong
 * is invisible: the tag accepts anything and the operator's conversion report
 * is simply empty. Held in one table so the mapping is reviewable rather than
 * scattered across five call sites. TikTok and Snap take the Meta-style names.
 */
const VENDOR_EVENT_NAMES: Readonly<Record<string, { ga4: string; meta: string } | undefined>> = {
  page_view: { ga4: 'page_view', meta: 'PageView' },
  product_view: { ga4: 'view_item', meta: 'ViewContent' },
  add_to_cart: { ga4: 'add_to_cart', meta: 'AddToCart' },
  begin_checkout: { ga4: 'begin_checkout', meta: 'InitiateCheckout' },
  purchase: { ga4: 'purchase', meta: 'Purchase' },
  search: { ga4: 'search', meta: 'Search' },
};

export interface BeginCheckoutInput {
  /** The checkout's idempotency key, which is already one per cart snapshot. */
  key: string;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsTrackerService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly locale = inject(LocaleService);
  private readonly authState = inject(AuthStateService);
  /**
   * Resolved at emission, not at construction, for the same reason
   * `StoreConfigService` does it: components that emit events would otherwise
   * make `STOREFRONT_API_CLIENT` a required provider in their specs.
   */
  private readonly injector = inject(Injector);
  private readonly pixels = inject(PixelService);
  private readonly storeConfig = inject(StoreConfigService);

  /** Checkout attempts already reported this tab. In memory is enough: a
   * reload re-enters checkout, which is a new attempt worth counting. */
  private readonly checkoutsSent = new Set<string>();

  async track(event: Omit<AnalyticsEvent, 'sessionId' | 'userId' | 'locale'>): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const api = this.injector.get(AnalyticsApiService, null);
    if (!api) return;

    const userId = this.authState.currentUser()?.id;
    const sessionId = this.sessionId();

    try {
      await api.send({
        ...event,
        ...(sessionId ? { sessionId } : {}),
        ...(userId ? { userId } : {}),
        locale: this.locale.locale(),
      });
    } catch {
      // Silent by contract. See the class comment.
    }

    this.mirrorToVendors(event.eventType, event);
  }

  /**
   * Send the same moment to whichever vendor tags are live.
   *
   * The server-side CAPI and Measurement Protocol forwarders are still logging
   * stubs, so these client-side calls are what actually reach Google and Meta.
   *
   * Gated on `PixelService.active()` rather than on the presence of the global:
   * a global can survive from an extension or a previous page, and mirroring
   * into one whose loader never arrived queues events nobody will ever send.
   */
  private mirrorToVendors(
    eventType: string,
    event: Omit<AnalyticsEvent, 'sessionId' | 'userId' | 'locale'>,
  ): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const names = VENDOR_EVENT_NAMES[eventType];
    if (!names) return;

    const active = this.pixels.active();
    const data = event.data ?? {};
    const payload: Record<string, unknown> = {
      ...data,
      currency: this.storeConfig.currencyCode(),
      ...(event.productId ? { content_ids: [event.productId] } : {}),
      ...(data['orderNumber'] ? { transaction_id: data['orderNumber'] } : {}),
    };

    const w = window as unknown as Record<string, unknown>;
    const call = (global: unknown, args: unknown[]): void => {
      if (typeof global !== 'function') return;
      try {
        (global as (...a: unknown[]) => void)(...args);
      } catch {
        // A vendor tag that throws must not take the first-party post, or the
        // page, down with it.
      }
    };

    if (active.ga4) call(w['gtag'], ['event', names.ga4, payload]);
    if (active.meta) call(w['fbq'], ['track', names.meta, payload]);
    if (active.tiktok) call(w['ttq'], ['track', names.meta, payload]);
    if (active.snap) call(w['snaptr'], ['track', names.meta, payload]);
  }

  trackPageView(path: string): Promise<void> {
    return this.track({ eventType: 'page_view', data: { path } });
  }

  trackProductView(productId: string, slug: string): Promise<void> {
    return this.track({ eventType: 'product_view', productId, data: { slug } });
  }

  trackAddToCart(productId: string, quantity: number, variantId?: string): Promise<void> {
    return this.track({
      eventType: 'add_to_cart',
      productId,
      data: { quantity, ...(variantId ? { variantId } : {}) },
    });
  }

  /**
   * One event per checkout attempt. The caller passes the checkout's own
   * idempotency key, which is already minted once per cart snapshot, so a
   * re-render of the ready state cannot inflate the funnel's second rung.
   */
  async trackBeginCheckout(input: BeginCheckoutInput): Promise<void> {
    if (this.checkoutsSent.has(input.key)) return;
    this.checkoutsSent.add(input.key);
    await this.track({ eventType: 'begin_checkout', data: { value: input.total } });
  }

  /**
   * One event per order, ever.
   *
   * Fired on the order-create success path rather than on the confirmation
   * page: a confirmation-page hook re-fires on every reload, and a doubled
   * purchase doubles the revenue the operator reads. The sent set is persisted
   * anyway, because a caller can be re-entered and because the confirmation
   * page is one refresh away from the same call.
   */
  async trackPurchase(input: PurchaseEventInput): Promise<void> {
    if (this.purchaseAlreadySent(input.orderId)) return;
    this.rememberPurchase(input.orderId);
    await this.track({
      eventType: 'purchase',
      orderId: input.orderId,
      data: { orderNumber: input.orderNumber, value: input.total },
    });
  }

  /**
   * The tab's session id, minted on first use.
   *
   * Returns null rather than throwing when storage is unavailable, which is
   * real: a private window or a browser set to block site data throws on
   * access. The event still goes out, just unattributed to a session.
   */
  private sessionId(): string | null {
    try {
      const stored = sessionStorage.getItem(ANALYTICS_SESSION_STORAGE_KEY);
      if (stored && SAFE_SESSION_ID.test(stored)) return stored;
      // A stored value that would fail the API's pattern is replaced rather
      // than sent: the API answers 400 and the whole event is lost.
      const minted = crypto.randomUUID();
      sessionStorage.setItem(ANALYTICS_SESSION_STORAGE_KEY, minted);
      return minted;
    } catch {
      return null;
    }
  }

  private purchaseAlreadySent(orderId: string): boolean {
    try {
      const raw = sessionStorage.getItem(PURCHASE_SENT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]).includes(orderId) : false;
    } catch {
      return false;
    }
  }

  private rememberPurchase(orderId: string): void {
    try {
      const raw = sessionStorage.getItem(PURCHASE_SENT_STORAGE_KEY);
      const sent = raw ? (JSON.parse(raw) as string[]) : [];
      sessionStorage.setItem(PURCHASE_SENT_STORAGE_KEY, JSON.stringify([...sent, orderId]));
    } catch {
      // Best effort. Without storage the in-process guard is all there is,
      // which still covers the double-call this method exists for.
    }
  }
}

export type { AnalyticsEventType };
