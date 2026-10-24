import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { ApiNotFoundError, ApiServerError, ApiValidationError } from '@admin-types';
import { WebhooksService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { WebhookEditPage } from './webhook-edit.page';

expect.extend(toHaveNoViolations);

const sample = {
  id: 'wh-1',
  url: 'https://example.com/hook',
  events: ['order.created'] as const,
  isActive: true,
  failureCount: 0,
  lastDeliveredAt: null,
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
};

describe('WebhookEditPage', () => {
  let fixture: ComponentFixture<WebhookEditPage>;
  let page: WebhookEditPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;

  function configure(getResponse: unknown = of(sample)) {
    getSpy = jest.fn(() => getResponse);
    updateSpy = jest.fn(() => of(sample));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: WebhooksService, useValue: { get: getSpy, update: updateSpy } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'wh-1' })),
            snapshot: { paramMap: convertToParamMap({ id: 'wh-1' }) },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(WebhookEditPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('pre-populates the form with the loaded webhook', () => {
    configure();
    expect(page.form.controls.url.value).toBe(sample.url);
    expect(page.form.controls.events.value).toEqual(sample.events);
    expect(page.form.controls.isActive.value).toBe(true);
  });

  it('submit is disabled while pristine', () => {
    configure();
    expect(page.form.pristine).toBe(true);
  });

  it('rejects http URLs inline', () => {
    configure();
    page.form.controls.url.setValue('http://example.com/hook');
    page.form.controls.url.markAsTouched();
    expect(page.urlError()).toMatch(/https/i);
  });

  it('rejects empty events array', () => {
    configure();
    page.toggleEvent('order.created', false);
    expect(page.eventsError()).toMatch(/at least one/i);
  });

  it('successful update navigates back to detail', () => {
    configure();
    const router = TestBed.inject(Router);
    const nav = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    page.form.controls.url.setValue('https://example.com/hook2');
    page.form.markAsDirty();
    page.submit();
    expect(updateSpy).toHaveBeenCalledWith('wh-1', {
      url: 'https://example.com/hook2',
      events: ['order.created'],
      isActive: true,
    });
    expect(nav).toHaveBeenCalledWith(['/webhooks', 'wh-1']);
  });

  it('shows not-found state when get returns 404', () => {
    configure(
      throwError(() => new ApiNotFoundError({ code: 'WEBHOOK_NOT_FOUND', message: 'gone' })),
    );
    expect(page.notFound()).toBe(true);
  });

  it('maps backend WEBHOOK_URL_INTERNAL_IP to a URL field error', () => {
    configure();
    updateSpy.mockReturnValue(
      throwError(
        () =>
          new ApiValidationError({
            code: 'WEBHOOK_URL_INTERNAL_IP',
            message: 'URL resolves to a private/loopback IP',
          }),
      ),
    );
    page.form.controls.url.setValue('https://10.0.0.1/hook');
    page.form.markAsDirty();
    page.submit();
    expect(page.urlError()).toMatch(/private|loopback/i);
  });

  it('non-URL backend errors surface as a top-level alert', () => {
    configure();
    updateSpy.mockReturnValue(
      throwError(() => new ApiServerError({ code: 'SERVER', message: 'boom', status: 500 })),
    );
    page.form.controls.url.setValue('https://example.com/hook2');
    page.form.markAsDirty();
    page.submit();
    expect(page.loadError()).toBeTruthy();
  });

  it('isActive toggle sets the form value', () => {
    configure();
    page.form.controls.isActive.setValue(false);
    expect(page.form.controls.isActive.value).toBe(false);
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
