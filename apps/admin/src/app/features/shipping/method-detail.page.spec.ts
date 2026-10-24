import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signal } from '@angular/core';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ADMIN_API_BASE_URL } from '@admin-services';
import { ShippingMethodDetailPage } from './method-detail.page';
import { AuthStore } from '../../core/stores/auth.store';

expect.extend(toHaveNoViolations);

describe('ShippingMethodDetailPage', () => {
  const authStub = {
    hasPermission: (p: string) =>
      ['shipping:view', 'shipping:update', 'shipping:delete'].includes(p),
    currentUser: signal(null),
    permissions: signal<string[]>([]),
    locale: signal('fr'),
    isAuthenticated: signal(true),
    effectivePermissions: () => ['shipping:view', 'shipping:update', 'shipping:delete'],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        provideRouter([{ path: 'shipping/methods/:id', component: ShippingMethodDetailPage }]),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        { provide: AuthStore, useValue: authStub },
      ],
    });
  });

  it('renders a method summary', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods/m1');
    const cmp = await harness.navigateByUrl('/shipping/methods/m1', ShippingMethodDetailPage);
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne((r) => r.url.includes('/v1/admin/shipping/methods'))
      .flush({
        data: [
          {
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
          },
        ],
        meta: { page: 1, pageSize: 100, total: 1 },
      });
    harness.detectChanges();
    expect(cmp.method()?.id).toBe('m1');

    const results = await axe(harness.routeNativeElement!);
    expect(results).toHaveNoViolations();
  });
});
