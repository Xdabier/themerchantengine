import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signal } from '@angular/core';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ADMIN_API_BASE_URL } from '@admin-services';
import { ShippingZonesListPage } from './zones-list.page';
import { AuthStore } from '../../core/stores/auth.store';

expect.extend(toHaveNoViolations);

describe('ShippingZonesListPage', () => {
  const authStub = {
    hasPermission: (p: string) =>
      ['shipping:view', 'shipping:create', 'shipping:update'].includes(p),
    currentUser: signal(null),
    permissions: signal<string[]>([]),
    locale: signal('fr'),
    isAuthenticated: signal(true),
    effectivePermissions: () => ['shipping:view', 'shipping:create', 'shipping:update'],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        provideRouter([{ path: 'shipping/zones', component: ShippingZonesListPage }]),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        { provide: AuthStore, useValue: authStub },
      ],
    });
  });

  it('renders seeded zone rows', async () => {
    const harness = await RouterTestingHarness.create('/shipping/zones');
    const cmp = await harness.navigateByUrl('/shipping/zones', ShippingZonesListPage);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne((r) => r.url.includes('/v1/admin/shipping/zones'))
      .flush({
        data: [
          {
            id: 'zone-1',
            name: { default: 'GCC' },
            countries: ['QA', 'SA'],
            states: [],
            priority: 0,
            isActive: true,
            createdAt: '2026-04-20T00:00:00Z',
            updatedAt: '2026-04-20T00:00:00Z',
          },
        ],
        meta: { page: 1, pageSize: 20, total: 1 },
      });
    harness.detectChanges();
    expect(cmp.rows().length).toBe(1);
    expect(cmp.total()).toBe(1);
  });

  it('shows empty-state when total is zero', async () => {
    const harness = await RouterTestingHarness.create('/shipping/zones');
    await harness.navigateByUrl('/shipping/zones', ShippingZonesListPage);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne((r) => r.url.includes('/v1/admin/shipping/zones'))
      .flush({
        data: [],
        meta: { page: 1, pageSize: 20, total: 0 },
      });
    harness.detectChanges();
    const root = harness.routeNativeElement!;
    expect(root.querySelector('[data-testid="zones-empty"]')).not.toBeNull();
  });

  it('is a11y-clean', async () => {
    const harness = await RouterTestingHarness.create('/shipping/zones');
    await harness.navigateByUrl('/shipping/zones', ShippingZonesListPage);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne((r) => r.url.includes('/v1/admin/shipping/zones'))
      .flush({
        data: [],
        meta: { page: 1, pageSize: 20, total: 0 },
      });
    harness.detectChanges();
    const results = await axe(harness.routeNativeElement!);
    expect(results).toHaveNoViolations();
  });
});
