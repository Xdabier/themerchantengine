import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signal } from '@angular/core';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ADMIN_API_BASE_URL } from '@admin-services';
import { ShippingMethodsListPage } from './methods-list.page';
import { AuthStore } from '../../core/stores/auth.store';

expect.extend(toHaveNoViolations);

describe('ShippingMethodsListPage', () => {
  const authStub = {
    hasPermission: (p: string) => ['shipping:view', 'shipping:create'].includes(p),
    currentUser: signal(null),
    permissions: signal<string[]>([]),
    locale: signal('fr'),
    isAuthenticated: signal(true),
    effectivePermissions: () => ['shipping:view', 'shipping:create'],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        provideRouter([{ path: 'shipping/methods', component: ShippingMethodsListPage }]),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        { provide: AuthStore, useValue: authStub },
      ],
    });
  });

  const methodRow = {
    id: 'm1',
    zoneId: 'z1',
    name: { default: 'Standard' },
    type: 'FLAT_RATE',
    price: 10,
    weightRanges: null,
    priceRanges: null,
    isActive: true,
    sortOrder: 0,
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
  };

  function flushAll(
    http: HttpTestingController,
    opts: { zones?: unknown[]; methods?: unknown[] } = {},
  ): void {
    const zonesReq = http.expectOne((r) => r.url.includes('/v1/admin/shipping/zones'));
    const zones = opts.zones ?? [
      {
        id: 'z1',
        name: { default: 'France' },
        countries: ['TN'],
        states: [],
        priority: 0,
        isActive: true,
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      },
    ];
    zonesReq.flush({ data: zones, meta: { page: 1, pageSize: 20, total: zones.length } });
    const methodsReq = http.expectOne((r) => r.url.includes('/v1/admin/shipping/methods'));
    const methods = opts.methods ?? [methodRow];
    methodsReq.flush({ data: methods, meta: { page: 1, pageSize: 20, total: methods.length } });
  }

  it('renders zone filter + methods row', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods');
    const cmp = await harness.navigateByUrl('/shipping/methods', ShippingMethodsListPage);
    flushAll(TestBed.inject(HttpTestingController));
    harness.detectChanges();
    expect(cmp.rows().length).toBe(1);
    expect(harness.routeNativeElement!.querySelector('#methods-zone-filter')).not.toBeNull();
  });

  it('shows the deep-linked zone on the filter select (QA C4 class)', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods?zoneId=z1');
    await harness.navigateByUrl('/shipping/methods?zoneId=z1', ShippingMethodsListPage);
    flushAll(TestBed.inject(HttpTestingController));
    harness.detectChanges();
    const select = harness.routeNativeElement!.querySelector(
      '#methods-zone-filter',
    ) as HTMLSelectElement;
    // A value binding on the select is applied before its options exist, so the
    // browser silently falls back to "All zones".
    expect(select.value).toBe('z1');
  });

  // ── Plan F, findings F8 + F9 ────────────────────────────────────────────

  it('names the zone from the row, even when the zone page never held it', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods');
    await harness.navigateByUrl('/shipping/methods', ShippingMethodsListPage);
    flushAll(TestBed.inject(HttpTestingController), {
      // The zones page is empty on purpose: a truncated pageSize=100 join is
      // exactly what made real zones dash (finding F8).
      zones: [],
      methods: [{ ...methodRow, zone: { id: 'z1', name: { default: 'Grand Lyon' } } }],
    });
    harness.detectChanges();

    const cell = harness.routeNativeElement!.querySelector(
      '[data-testid="method-zone-m1"]',
    ) as HTMLElement;
    expect(cell.textContent?.trim()).toBe('Grand Lyon');
    expect(cell.textContent).not.toContain('[object Object]');
  });

  it('falls back to the zone lookup, then a dash, when the row carries no zone', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods');
    await harness.navigateByUrl('/shipping/methods', ShippingMethodsListPage);
    flushAll(TestBed.inject(HttpTestingController), {
      methods: [methodRow, { ...methodRow, id: 'm2', zoneId: 'z-unknown' }],
    });
    harness.detectChanges();

    const cell = (id: string) =>
      (
        harness.routeNativeElement!.querySelector(
          `[data-testid="method-zone-${id}"]`,
        ) as HTMLElement
      ).textContent?.trim();
    expect(cell('m1')).toBe('France');
    expect(cell('m2')).toBe('—');
  });

  it('distinguishes two same-named methods by zone and price', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods');
    await harness.navigateByUrl('/shipping/methods', ShippingMethodsListPage);
    flushAll(TestBed.inject(HttpTestingController), {
      zones: [],
      methods: [
        { ...methodRow, price: 10, zone: { id: 'kh', name: { default: 'Grand Lyon' } } },
        { ...methodRow, id: 'm2', price: 15, zone: { id: 'z1', name: { default: 'France' } } },
      ],
    });
    harness.detectChanges();

    const root = harness.routeNativeElement!;
    const rowText = (id: string) =>
      (root.querySelector(`[data-testid="method-row-${id}"]`) as HTMLElement).textContent ?? '';
    expect(rowText('m1')).toContain('Grand Lyon');
    expect(rowText('m1')).toContain('10');
    expect(rowText('m2')).toContain('France');
    expect(rowText('m2')).toContain('15');
    expect(rowText('m1')).not.toBe(rowText('m2'));
  });

  it('is a11y-clean', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods');
    await harness.navigateByUrl('/shipping/methods', ShippingMethodsListPage);
    flushAll(TestBed.inject(HttpTestingController));
    harness.detectChanges();
    const results = await axe(harness.routeNativeElement!);
    expect(results).toHaveNoViolations();
  });
});
