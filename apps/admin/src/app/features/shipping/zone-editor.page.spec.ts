import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signal } from '@angular/core';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ADMIN_API_BASE_URL } from '@admin-services';
import { ShippingZoneEditorPage } from './zone-editor.page';
import { AuthStore } from '../../core/stores/auth.store';

expect.extend(toHaveNoViolations);

describe('ShippingZoneEditorPage', () => {
  const authStub = {
    hasPermission: () => true,
    currentUser: signal(null),
    permissions: signal<string[]>([]),
    locale: signal('fr'),
    isAuthenticated: signal(true),
    effectivePermissions: () => ['shipping:create', 'shipping:update'],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'shipping/zones', component: ShippingZoneEditorPage },
          { path: 'shipping/zones/new', component: ShippingZoneEditorPage },
        ]),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        { provide: AuthStore, useValue: authStub },
      ],
    });
  });

  it('countries empty → save disabled; adding QA enables the validator', async () => {
    const harness = await RouterTestingHarness.create('/shipping/zones/new');
    const cmp = await harness.navigateByUrl('/shipping/zones/new', ShippingZoneEditorPage);
    harness.detectChanges();

    expect(cmp.form.controls.countries.invalid).toBe(true);

    cmp.countryDraft = 'QA';
    cmp.addCountry();
    harness.detectChanges();
    expect(cmp.form.controls.countries.value).toEqual(['QA']);
    expect(cmp.invalidIso()).toBeNull();
  });

  it('rejects non-ISO country code', async () => {
    const harness = await RouterTestingHarness.create('/shipping/zones/new');
    const cmp = await harness.navigateByUrl('/shipping/zones/new', ShippingZoneEditorPage);
    cmp.countryDraft = 'ZZ';
    cmp.addCountry();
    expect(cmp.invalidIso()).toBe('ZZ');
    expect(cmp.form.controls.countries.value).toEqual([]);
  });

  it('is a11y-clean on mount', async () => {
    const harness = await RouterTestingHarness.create('/shipping/zones/new');
    await harness.navigateByUrl('/shipping/zones/new', ShippingZoneEditorPage);
    harness.detectChanges();
    const results = await axe(harness.routeNativeElement!);
    expect(results).toHaveNoViolations();
  });

  it('creates a zone on submit', async () => {
    const harness = await RouterTestingHarness.create('/shipping/zones/new');
    const cmp = await harness.navigateByUrl('/shipping/zones/new', ShippingZoneEditorPage);

    cmp.form.controls.name.setValue({ default: 'GCC' });
    cmp.countryDraft = 'QA';
    cmp.addCountry();
    harness.detectChanges();

    cmp.submit();
    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne((r) => r.url.endsWith('/v1/admin/shipping/zones'));
    expect(req.request.method).toBe('POST');
    expect((req.request.body as Record<string, unknown>)['countries']).toEqual(['QA']);
    req.flush({
      data: {
        id: 'z1',
        name: { default: 'GCC' },
        countries: ['QA'],
        states: [],
        priority: 0,
        isActive: true,
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      },
    });
  });
});
