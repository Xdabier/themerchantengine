import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { signal } from '@angular/core';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ADMIN_API_BASE_URL } from '@admin-services';
import { ShippingMethodEditorPage } from './method-editor.page';
import { AuthStore } from '../../core/stores/auth.store';

expect.extend(toHaveNoViolations);

describe('ShippingMethodEditorPage', () => {
  const authStub = {
    hasPermission: () => true,
    currentUser: signal(null),
    permissions: signal<string[]>([]),
    locale: signal('fr'),
    isAuthenticated: signal(true),
    effectivePermissions: () => [] as string[],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'shipping/methods/new', component: ShippingMethodEditorPage },
          { path: 'shipping/methods/:id/edit', component: ShippingMethodEditorPage },
        ]),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        { provide: AuthStore, useValue: authStub },
      ],
    });
  });

  function flushZones(http: HttpTestingController): void {
    http
      .expectOne((r) => r.url.includes('/v1/admin/shipping/zones'))
      .flush({
        data: [
          {
            id: 'z1',
            name: { default: 'GCC' },
            countries: ['QA'],
            states: [],
            priority: 0,
            isActive: true,
            createdAt: '2026-04-20T00:00:00Z',
            updatedAt: '2026-04-20T00:00:00Z',
          },
        ],
        meta: { page: 1, pageSize: 20, total: 1 },
      });
  }

  it('type change swaps the active config block and clears stale ranges', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods/new');
    const cmp = await harness.navigateByUrl('/shipping/methods/new', ShippingMethodEditorPage);
    flushZones(TestBed.inject(HttpTestingController));
    harness.detectChanges();

    cmp.form.controls.type.setValue('WEIGHT_BASED');
    harness.detectChanges();
    cmp.addWeightRange();
    expect(cmp.weightRanges.length).toBe(1);

    cmp.form.controls.type.setValue('FLAT_RATE');
    expect(cmp.weightRanges.length).toBe(0);

    cmp.form.controls.type.setValue('PRICE_BASED');
    cmp.addPriceRange();
    expect(cmp.priceRanges.length).toBe(1);

    cmp.form.controls.type.setValue('FREE');
    expect(cmp.priceRanges.length).toBe(0);
  });

  it('is a11y-clean', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods/new');
    await harness.navigateByUrl('/shipping/methods/new', ShippingMethodEditorPage);
    flushZones(TestBed.inject(HttpTestingController));
    harness.detectChanges();
    const results = await axe(harness.routeNativeElement!);
    expect(results).toHaveNoViolations();
  });

  // ── QA C7: a prefilled edit form must not enable Save before an edit ───────

  function flushMethods(http: HttpTestingController): void {
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
            isDefault: true,
            sortOrder: 0,
            createdAt: '2026-04-20T00:00:00Z',
            updatedAt: '2026-04-20T00:00:00Z',
          },
        ],
        meta: { page: 1, pageSize: 100, total: 1 },
      });
  }

  function saveButton(harness: RouterTestingHarness): HTMLButtonElement {
    return harness.routeNativeElement!.querySelector(
      '[data-testid="method-save"] button',
    ) as HTMLButtonElement;
  }

  it('keeps Save disabled on a loaded method until something changes', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods/m1/edit');
    const cmp = await harness.navigateByUrl('/shipping/methods/m1/edit', ShippingMethodEditorPage);
    const http = TestBed.inject(HttpTestingController);
    flushZones(http);
    flushMethods(http);
    harness.detectChanges();

    expect(cmp.isEditMode()).toBe(true);
    expect(saveButton(harness).disabled).toBe(true);
    expect(harness.routeNativeElement!.textContent).toContain('No changes');

    cmp.form.controls.price.setValue(12);
    cmp.form.controls.price.markAsDirty();
    harness.detectChanges();
    expect(saveButton(harness).disabled).toBe(false);
    expect(harness.routeNativeElement!.textContent).toContain('Unsaved changes');
  });

  it('still enables Create on a valid new method, which is not a dirty gate', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods/new');
    const cmp = await harness.navigateByUrl('/shipping/methods/new', ShippingMethodEditorPage);
    flushZones(TestBed.inject(HttpTestingController));
    harness.detectChanges();

    cmp.form.controls.zoneId.setValue('z1');
    cmp.form.controls.name.setValue({ default: 'Standard' });
    cmp.form.controls.type.setValue('FREE');
    harness.detectChanges();

    expect(cmp.isEditMode()).toBe(false);
    // Create forms enable on valid input; pristine-gating them would be wrong.
    expect(saveButton(harness).disabled).toBe(false);
    expect(harness.routeNativeElement!.textContent).not.toContain('No changes');
  });

  it('FLAT_RATE requires a price', async () => {
    const harness = await RouterTestingHarness.create('/shipping/methods/new');
    const cmp = await harness.navigateByUrl('/shipping/methods/new', ShippingMethodEditorPage);
    flushZones(TestBed.inject(HttpTestingController));
    harness.detectChanges();

    cmp.form.controls.zoneId.setValue('z1');
    cmp.form.controls.name.setValue({ default: 'Standard' });
    cmp.form.controls.type.setValue('FLAT_RATE');
    cmp.submit();
    expect(cmp.topError()).toMatch(/price/i);
  });
});
