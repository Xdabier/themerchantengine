import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ADMIN_API_BASE_URL } from '@admin-services';
import { errorNormalizerInterceptor } from '../../core/interceptors';
import { CarrierNewPage } from './carrier-new.page';

expect.extend(toHaveNoViolations);

describe('CarrierNewPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch(), withInterceptors([errorNormalizerInterceptor])),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'shipping/carriers/new', component: CarrierNewPage },
          { path: 'shipping/carriers/:id', component: CarrierNewPage },
        ]),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
      ],
    });
  });

  it('is a11y-clean', async () => {
    const harness = await RouterTestingHarness.create('/shipping/carriers/new');
    await harness.navigateByUrl('/shipping/carriers/new', CarrierNewPage);
    harness.detectChanges();
    const results = await axe(harness.routeNativeElement!);
    expect(results).toHaveNoViolations();
  });

  it('rejects uppercase code + missing provider', async () => {
    const harness = await RouterTestingHarness.create('/shipping/carriers/new');
    const cmp = await harness.navigateByUrl('/shipping/carriers/new', CarrierNewPage);

    cmp.form.controls.code.setValue('DHL');
    cmp.form.controls.code.markAsTouched();
    expect(cmp.codeError()).toContain('lowercase');

    cmp.form.controls.code.setValue('d');
    expect(cmp.codeError()).toContain('at least 2');
  });

  it('POSTs on valid submit', async () => {
    const harness = await RouterTestingHarness.create('/shipping/carriers/new');
    const cmp = await harness.navigateByUrl('/shipping/carriers/new', CarrierNewPage);

    cmp.form.controls.code.setValue('dhl_test');
    cmp.form.controls.name.setValue({ default: 'DHL Test' });
    cmp.form.controls.provider.setValue('dhl');

    cmp.submit();
    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne('/api/v1/admin/carriers');
    expect(req.request.method).toBe('POST');
    expect((req.request.body as Record<string, unknown>)['code']).toBe('dhl_test');
    req.flush({
      data: {
        id: 'c1',
        code: 'dhl_test',
        name: { default: 'DHL Test' },
        provider: 'dhl',
        services: [],
        zones: [],
        isActive: true,
        sortOrder: 0,
        config: {},
      },
    });
  });

  it('409 maps to code field error', async () => {
    const harness = await RouterTestingHarness.create('/shipping/carriers/new');
    const cmp = await harness.navigateByUrl('/shipping/carriers/new', CarrierNewPage);

    cmp.form.controls.code.setValue('dhl_test');
    cmp.form.controls.name.setValue({ default: 'DHL' });
    cmp.form.controls.provider.setValue('dhl');

    cmp.submit();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/v1/admin/carriers')
      .flush({ error: { code: 'CARRIER_CODE_IN_USE' } }, { status: 409, statusText: 'Conflict' });

    expect(cmp.conflict()).toBe(true);
    expect(cmp.codeError()).toContain('already exists');
  });
});
