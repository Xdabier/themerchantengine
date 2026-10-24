import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersService } from '@storefront-services';

import { LocaleService } from '../../locale.service';
import { getChromeStrings } from '../../../i18n';
import { type Locale } from '../../../i18n/types';
import TrackPage from './track.page';
import { fixtureChromeIdentity } from '../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
}

const DEFAULT_RESULT = {
  orderNumber: 'ORD-2026-000001',
  status: 'SHIPPED',
  createdAt: '2026-04-25T10:00:00Z',
  shipments: [],
  timeline: [],
};

function makeOrders(opts: { trackResult?: unknown; trackThrows?: unknown }) {
  return {
    track: vi.fn(async () => {
      if (opts.trackThrows) throw opts.trackThrows;
      return opts.trackResult ?? DEFAULT_RESULT;
    }),
  } as unknown as OrdersService;
}

interface RenderResult {
  fixture: ComponentFixture<TrackPage>;
  ordersSpy: ReturnType<typeof vi.fn>;
}

async function renderTrack(opts: {
  locale: Locale;
  prefill?: string;
  trackResult?: unknown;
  trackThrows?: unknown;
}): Promise<RenderResult> {
  const stub = new StubLocaleService(opts.locale);
  const ordersSvc = makeOrders({
    trackResult: opts.trackResult,
    trackThrows: opts.trackThrows,
  });

  TestBed.overrideComponent(TrackPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocaleService, useValue: stub },
      { provide: OrdersService, useValue: ordersSvc },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({}),
            queryParamMap: convertToParamMap(opts.prefill ? { order: opts.prefill } : {}),
          },
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(TrackPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return {
    fixture,
    ordersSpy: (ordersSvc as unknown as { track: ReturnType<typeof vi.fn> }).track,
  };
}

function setInput(root: HTMLElement, testId: string, value: string) {
  const input = root.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function fillAndSubmit(
  fixture: ComponentFixture<TrackPage>,
  opts: { orderNumber?: string; email?: string } = {},
): Promise<HTMLElement> {
  const root = fixture.nativeElement as HTMLElement;
  setInput(root, 'track-order-number-input', opts.orderNumber ?? 'ORD-2026-000001');
  setInput(root, 'track-email-input', opts.email ?? 'real@example.com');
  fixture.detectChanges();
  const form = root.querySelector('[data-testid="track-form"]') as HTMLFormElement;
  form.dispatchEvent(new Event('submit'));
  await fixture.whenStable();
  fixture.detectChanges();
  return root;
}

describe('TrackPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  /**
   * Finding K9. The page used to live at `/account/orders/:id/track` and render
   * the route's internal cuid under the label "Order number". There is no
   * identity in the route at all now: the customer types the number they were
   * given.
   */
  it('takes the order number from a form field, never from the route', async () => {
    const { fixture } = await renderTrack({ locale: 'fr' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="track-page"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="track-order-number-input"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="track-email-input"]')).not.toBeNull();
  });

  it('prefills the order number from ?order= without granting access on its own', async () => {
    const { fixture, ordersSpy } = await renderTrack({
      locale: 'en',
      prefill: 'ORD-2026-000009',
    });
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector(
      '[data-testid="track-order-number-input"]',
    ) as HTMLInputElement;
    expect(input.value).toBe('ORD-2026-000009');
    // Nothing is looked up until the email challenge is answered.
    expect(ordersSpy).not.toHaveBeenCalled();
  });

  it('blocks submission and marks both fields when the form is empty', async () => {
    const { fixture, ordersSpy } = await renderTrack({ locale: 'en' });
    const root = fixture.nativeElement as HTMLElement;
    const form = root.querySelector('[data-testid="track-form"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(ordersSpy).not.toHaveBeenCalled();
    expect(
      (
        root.querySelector('[data-testid="track-order-number-input"]') as HTMLInputElement
      ).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      (root.querySelector('[data-testid="track-email-input"]') as HTMLInputElement).getAttribute(
        'aria-invalid',
      ),
    ).toBe('true');
  });

  it('blocks submission when the email is malformed', async () => {
    const { fixture, ordersSpy } = await renderTrack({ locale: 'en' });
    await fillAndSubmit(fixture, { email: 'not-an-email' });
    expect(ordersSpy).not.toHaveBeenCalled();
  });

  /**
   * The error copy is read through a plain method, not a `computed()` over a
   * Reactive-Forms getter: a form getter is untracked, so a computed would
   * memoize its first answer and the message would never change.
   */
  it('updates the error message as the field changes, not just on first render', async () => {
    const { fixture } = await renderTrack({ locale: 'en' });
    const root = fixture.nativeElement as HTMLElement;
    const form = root.querySelector('[data-testid="track-form"]') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    const required = root.querySelector('#track-email-error')?.textContent?.trim();

    setInput(root, 'track-email-input', 'nope');
    fixture.detectChanges();
    const invalid = root.querySelector('#track-email-error')?.textContent?.trim();

    expect(required).toBe(getChromeStrings('en').track.requiredField);
    expect(invalid).toBe(getChromeStrings('en').track.invalidEmail);
  });

  /**
   * Finding K10. The email is the shared secret that authorises this read, so
   * it goes into a POST body and the service is handed one object.
   */
  it('sends the order number and email together as a single lookup body', async () => {
    const { fixture, ordersSpy } = await renderTrack({ locale: 'en' });
    await fillAndSubmit(fixture);
    expect(ordersSpy).toHaveBeenCalledWith({
      orderNumber: 'ORD-2026-000001',
      email: 'real@example.com',
    });
  });

  it('uppercases and trims the typed order number so a copied one still resolves', async () => {
    const { fixture, ordersSpy } = await renderTrack({ locale: 'en' });
    await fillAndSubmit(fixture, { orderNumber: '  ord-2026-000001  ' });
    expect(ordersSpy).toHaveBeenCalledWith({
      orderNumber: 'ORD-2026-000001',
      email: 'real@example.com',
    });
  });

  it('refuses an order number the API would reject, without calling it', async () => {
    const { fixture, ordersSpy } = await renderTrack({ locale: 'en' });
    const root = await fillAndSubmit(fixture, { orderNumber: 'ORD 2026 !!' });
    expect(ordersSpy).not.toHaveBeenCalled();
    expect(root.querySelector('#track-order-number-error')?.textContent?.trim()).toBe(
      getChromeStrings('en').track.invalidOrderNumber,
    );
  });

  it('renders the result heading from the order number the API confirmed', async () => {
    const { fixture } = await renderTrack({ locale: 'en' });
    const root = await fillAndSubmit(fixture);
    expect(root.querySelector('[data-testid="track-result"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="track-result"]')?.textContent).toContain(
      'ORD-2026-000001',
    );
  });

  it('renders the generic not-found surface on any API failure (enumeration defense)', async () => {
    const { fixture } = await renderTrack({ locale: 'en', trackThrows: new Error('404') });
    const root = await fillAndSubmit(fixture, { email: 'wrong@example.com' });
    expect(root.querySelector('[data-testid="track-not-found"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="track-result"]')).toBeNull();
  });

  it('renders the French copy under fr', async () => {
    const { fixture } = await renderTrack({ locale: 'fr' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.title')?.textContent?.trim()).toBe(
      getChromeStrings('fr').track.heading,
    );
  });
});

describe('TrackPage shipments and timeline', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  const SHIPPED_PAYLOAD = {
    orderNumber: 'ORD-2026-000001',
    status: 'DELIVERED',
    createdAt: '2026-04-25T10:00:00Z',
    shipments: [
      {
        id: 'shp_1',
        carrier: 'Aramex',
        trackingNumber: 'ARX-9',
        status: 'DELIVERED',
        shippedAt: '2026-04-26T08:00:00Z',
        deliveredAt: '2026-04-28T14:00:00Z',
      },
    ],
    timeline: [],
  };

  it('renders one row per shipment with its carrier and tracking number', async () => {
    const { fixture } = await renderTrack({ locale: 'en', trackResult: SHIPPED_PAYLOAD });
    const root = await fillAndSubmit(fixture);

    const rows = root.querySelectorAll('[data-testid="track-shipment"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Aramex');
    expect(rows[0].textContent).toContain('ARX-9');
  });

  it('links a known carrier to its own tracking page', async () => {
    const { fixture } = await renderTrack({ locale: 'en', trackResult: SHIPPED_PAYLOAD });
    const root = await fillAndSubmit(fixture);

    const link = root.querySelector('[data-testid="track-carrier-link"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      'https://www.aramex.com/track/results?ShipmentNumber=ARX-9',
    );
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toContain('ARX-9');
  });

  it('renders no carrier link for a carrier it holds no URL for', async () => {
    const { fixture } = await renderTrack({
      locale: 'en',
      trackResult: {
        ...SHIPPED_PAYLOAD,
        shipments: [{ ...SHIPPED_PAYLOAD.shipments[0], carrier: 'National Post' }],
      },
    });
    const root = await fillAndSubmit(fixture);
    expect(root.querySelector('[data-testid="track-carrier-link"]')).toBeNull();
  });

  /**
   * Finding K11. The result used to be a status pill and nothing else, because
   * the API sent no history. It sends `timeline` now (plan M phase M2) and this
   * is what the page must prefer.
   */
  it('renders the API timeline, one row per real transition', async () => {
    const { fixture } = await renderTrack({
      locale: 'en',
      trackResult: {
        ...SHIPPED_PAYLOAD,
        timeline: [
          { status: 'PENDING', at: '2026-04-25T10:00:00Z' },
          { status: 'CONFIRMED', at: '2026-04-25T11:00:00Z' },
          { status: 'DELIVERED', at: '2026-04-28T14:00:00Z' },
        ],
      },
    });
    await fillAndSubmit(fixture);

    const events = (
      fixture.componentInstance as unknown as {
        timelineEvents: () => Array<{ status: string; at: string }>;
      }
    ).timelineEvents();

    expect(events.map((e) => e.status)).toEqual(['PENDING', 'CONFIRMED', 'DELIVERED']);
    expect(events.map((e) => e.at)).toEqual([
      '2026-04-25T10:00:00Z',
      '2026-04-25T11:00:00Z',
      '2026-04-28T14:00:00Z',
    ]);
  });

  it('falls back to derived events for an order placed before the history backfill', async () => {
    const { fixture } = await renderTrack({ locale: 'en', trackResult: SHIPPED_PAYLOAD });
    await fillAndSubmit(fixture);

    const events = (
      fixture.componentInstance as unknown as {
        timelineEvents: () => Array<{ status: string }>;
      }
    ).timelineEvents();
    expect(events.map((e) => e.status)).toEqual(['PENDING', 'SHIPPED', 'DELIVERED']);
  });

  it('shows the not-yet-shipped hint instead of an empty shipments block', async () => {
    const { fixture } = await renderTrack({ locale: 'en' });
    const root = await fillAndSubmit(fixture);

    expect(root.querySelectorAll('[data-testid="track-shipment"]').length).toBe(0);
    expect(root.querySelector('[data-testid="track-no-shipments"]')).not.toBeNull();
  });
});
