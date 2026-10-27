import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AnalyticsApiService } from '@storefront-services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleService } from '../locale.service';
import { PixelService } from './pixel.service';
import { StoreConfigService } from './store-config.service';
import { AuthStateService } from './auth-state.service';
import {
  ANALYTICS_SESSION_STORAGE_KEY,
  AnalyticsTrackerService,
} from './analytics-tracker.service';

function build(
  options: {
    platform?: 'server' | 'browser';
    userId?: string | null;
    active?: { ga4?: boolean; meta?: boolean; tiktok?: boolean; snap?: boolean };
  } = {},
) {
  // Typed through the generic rather than a named-but-unused parameter: the
  // mock's argument tuple is read below (`send.mock.calls[0]![0]`), and an
  // inferred zero-arg mock types that tuple as `[]`.
  const send = vi.fn<(event: unknown) => Promise<undefined>>(async () => undefined);
  const active = {
    ga4: false,
    meta: false,
    tiktok: false,
    snap: false,
    ...(options.active ?? {}),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
      { provide: AnalyticsApiService, useValue: { send } },
      { provide: LocaleService, useValue: { locale: signal('fr') } },
      {
        provide: AuthStateService,
        useValue: { currentUser: signal(options.userId ? { id: options.userId } : null) },
      },
      { provide: PixelService, useValue: { active: signal(active) } },
      { provide: StoreConfigService, useValue: { currencyCode: signal('LYD') } },
    ],
  });
  return { tracker: TestBed.inject(AnalyticsTrackerService), send };
}

describe('AnalyticsTrackerService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('emission', () => {
    it('sends the event with the active locale', async () => {
      const { tracker, send } = build();

      await tracker.track({ eventType: 'page_view' });

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'page_view', locale: 'fr' }),
      );
    });

    it('carries the signed-in customer id when there is one', async () => {
      const { tracker, send } = build({ userId: 'cust-1' });

      await tracker.track({ eventType: 'product_view', productId: 'p-1' });

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'cust-1', productId: 'p-1' }),
      );
    });

    it('omits the user id for an anonymous visitor rather than sending an empty one', async () => {
      const { tracker, send } = build();

      await tracker.track({ eventType: 'page_view' });

      expect(send.mock.calls[0]![0]).not.toHaveProperty('userId');
    });

    it('sends nothing at all on the server pass', async () => {
      // SSR would attribute one event per render to the server, and the whole
      // point of a session id is that it belongs to a browser.
      const { tracker, send } = build({ platform: 'server' });

      await tracker.track({ eventType: 'page_view' });

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('session id', () => {
    it('mints one and keeps it in sessionStorage', async () => {
      const { tracker, send } = build();

      await tracker.track({ eventType: 'page_view' });

      const stored = sessionStorage.getItem(ANALYTICS_SESSION_STORAGE_KEY);
      expect(stored).toBeTruthy();
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ sessionId: stored }));
    });

    it('reuses the same id across events, which is what makes a session', async () => {
      const { tracker, send } = build();

      await tracker.track({ eventType: 'page_view' });
      await tracker.track({ eventType: 'product_view', productId: 'p-1' });

      const [first, second] = send.mock.calls.map(
        (call) => call[0] as unknown as { sessionId: string },
      );
      expect(first.sessionId).toBe(second.sessionId);
    });

    it('replaces a stored id that would not survive the API pattern', async () => {
      sessionStorage.setItem(ANALYTICS_SESSION_STORAGE_KEY, 'not a valid id');
      const { tracker, send } = build();

      await tracker.track({ eventType: 'page_view' });

      const sent = (send.mock.calls[0]![0] as unknown as { sessionId: string }).sessionId;
      expect(sent).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('still emits when sessionStorage is unavailable', async () => {
      // Private windows and locked-down browsers throw on access. An analytics
      // id is a convenience, never a reason to drop the event.
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      try {
        const { tracker, send } = build();
        await tracker.track({ eventType: 'page_view' });
        expect(send).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('failure is silent', () => {
    it('resolves when the post rejects, and logs nothing at error level', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        TestBed.configureTestingModule({
          providers: [
            { provide: PLATFORM_ID, useValue: 'browser' },
            {
              provide: AnalyticsApiService,
              useValue: {
                send: vi.fn<(event: unknown) => Promise<undefined>>(async () => {
                  throw new Error('offline');
                }),
              },
            },
            { provide: LocaleService, useValue: { locale: signal('fr') } },
            { provide: AuthStateService, useValue: { currentUser: signal(null) } },
          ],
        });
        const tracker = TestBed.inject(AnalyticsTrackerService);

        await expect(
          tracker.track({ eventType: 'purchase', orderId: 'o-1' }),
        ).resolves.toBeUndefined();
        // The e2e console baseline fails a journey on any console.error, so a
        // beacon that logs one takes every mutation journey down with it.
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('purchase deduplication', () => {
    it('sends one purchase per order, however many times it is called', async () => {
      // The confirmation page re-renders on reload and the checkout handler can
      // retry. A double purchase event doubles the operator's revenue chart.
      const { tracker, send } = build();

      await tracker.trackPurchase({ orderId: 'o-1', orderNumber: 'ORD-1', total: 120 });
      await tracker.trackPurchase({ orderId: 'o-1', orderNumber: 'ORD-1', total: 120 });

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'purchase',
          orderId: 'o-1',
          data: expect.objectContaining({ orderNumber: 'ORD-1', value: 120 }),
        }),
      );
    });

    it('still sends a second, different order', async () => {
      const { tracker, send } = build();

      await tracker.trackPurchase({ orderId: 'o-1', orderNumber: 'ORD-1', total: 10 });
      await tracker.trackPurchase({ orderId: 'o-2', orderNumber: 'ORD-2', total: 20 });

      expect(send).toHaveBeenCalledTimes(2);
    });

    it('remembers the order across a reload, so the confirmation page cannot re-fire it', async () => {
      const { tracker: first } = build();
      await first.trackPurchase({ orderId: 'o-1', orderNumber: 'ORD-1', total: 10 });

      TestBed.resetTestingModule();
      const { tracker: second, send } = build();
      await second.trackPurchase({ orderId: 'o-1', orderNumber: 'ORD-1', total: 10 });

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('checkout deduplication', () => {
    it('sends one begin_checkout per checkout attempt key', async () => {
      const { tracker, send } = build();

      await tracker.trackBeginCheckout({ key: 'idem-1', total: 50 });
      await tracker.trackBeginCheckout({ key: 'idem-1', total: 50 });

      expect(send).toHaveBeenCalledTimes(1);
    });

    it('sends again for a new cart, which mints a new key', async () => {
      const { tracker, send } = build();

      await tracker.trackBeginCheckout({ key: 'idem-1', total: 50 });
      await tracker.trackBeginCheckout({ key: 'idem-2', total: 70 });

      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  describe('vendor mirroring (plan I phase I8)', () => {
    /** The globals PixelService creates, cleared between tests. */
    function vendorWindow(): Record<string, unknown> {
      return window as unknown as Record<string, unknown>;
    }

    beforeEach(() => {
      for (const key of ['gtag', 'fbq', 'ttq', 'snaptr']) delete vendorWindow()[key];
    });

    it('mirrors a purchase to GA4 with the store currency', async () => {
      const gtag = vi.fn();
      vendorWindow()['gtag'] = gtag;
      const { tracker } = build({ active: { ga4: true } });

      await tracker.trackPurchase({ orderId: 'o-1', orderNumber: 'ORD-1', total: 120 });

      expect(gtag).toHaveBeenCalledWith(
        'event',
        'purchase',
        expect.objectContaining({ value: 120, currency: 'LYD', transaction_id: 'ORD-1' }),
      );
    });

    it('mirrors a purchase to Meta under its own event name', async () => {
      const fbq = vi.fn();
      vendorWindow()['fbq'] = fbq;
      const { tracker } = build({ active: { meta: true } });

      await tracker.trackPurchase({ orderId: 'o-1', orderNumber: 'ORD-1', total: 120 });

      expect(fbq).toHaveBeenCalledWith(
        'track',
        'Purchase',
        expect.objectContaining({ value: 120, currency: 'LYD' }),
      );
    });

    it('translates the first-party name into each vendor vocabulary', async () => {
      const gtag = vi.fn();
      const fbq = vi.fn();
      vendorWindow()['gtag'] = gtag;
      vendorWindow()['fbq'] = fbq;
      const { tracker } = build({ active: { ga4: true, meta: true } });

      await tracker.trackProductView('p-1', 'a-slug');

      expect(gtag).toHaveBeenCalledWith('event', 'view_item', expect.anything());
      expect(fbq).toHaveBeenCalledWith('track', 'ViewContent', expect.anything());
    });

    it('does not call a vendor global that PixelService reported inactive', async () => {
      // A global can exist from a previous page or an extension. Mirroring into
      // one whose loader never arrived queues events nobody will ever send.
      const gtag = vi.fn();
      vendorWindow()['gtag'] = gtag;
      const { tracker } = build({ active: { ga4: false } });

      await tracker.trackProductView('p-1', 'a-slug');

      expect(gtag).not.toHaveBeenCalled();
    });

    it('still posts first-party when a vendor global throws', async () => {
      const { send } = (() => {
        vendorWindow()['gtag'] = () => {
          throw new Error('tag blew up');
        };
        return build({ active: { ga4: true } });
      })();
      const tracker = TestBed.inject(AnalyticsTrackerService);

      await tracker.trackProductView('p-1', 'a-slug');

      expect(send).toHaveBeenCalledTimes(1);
    });

    it('mirrors nothing at all on the server pass', async () => {
      const gtag = vi.fn();
      vendorWindow()['gtag'] = gtag;
      const { tracker } = build({ platform: 'server', active: { ga4: true } });

      await tracker.trackPageView('/fr/');

      expect(gtag).not.toHaveBeenCalled();
    });
  });
});
