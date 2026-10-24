import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiServerError, ApiValidationError } from '@admin-types';
import { WebhooksService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { WebhookCreatePage } from './webhook-create.page';

expect.extend(toHaveNoViolations);

const created = {
  id: 'wh-1',
  url: 'https://example.com/hook',
  events: ['order.created'],
  isActive: true,
  failureCount: 0,
  lastDeliveredAt: null,
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
  secret: 'this-is-a-very-long-secret-value-0123',
};

describe('WebhookCreatePage', () => {
  let fixture: ComponentFixture<WebhookCreatePage>;
  let page: WebhookCreatePage;
  let createSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: WebhooksService, useValue: { create: createSpy } },
      ],
    });
    fixture = TestBed.createComponent(WebhookCreatePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    createSpy = jest.fn(() => of(created));
  });

  it('renders the form on mount', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="webhook-create-page"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="webhook-url"]')).not.toBeNull();
  });

  it('submit is disabled while form is pristine', () => {
    configure();
    expect(page.form.invalid).toBe(true);
    expect(page.form.pristine).toBe(true);
  });

  it('rejects http URLs with a validation error', () => {
    configure();
    page.form.controls.url.setValue('http://example.com/hook');
    page.form.controls.url.markAsTouched();
    expect(page.urlError()).toMatch(/https/i);
  });

  it('rejects empty events selection', () => {
    configure();
    page.form.controls.events.markAsTouched();
    expect(page.eventsError()).toMatch(/at least one/i);
  });

  it('rejects a custom secret shorter than 16 chars', () => {
    configure();
    page.form.controls.secret.setValue('shortie');
    expect(page.secretFieldError()).toMatch(/16/);
  });

  it('toggleEvent adds and removes events', () => {
    configure();
    page.toggleEvent('order.created', true);
    expect(page.events()).toEqual(['order.created']);
    page.toggleEvent('order.created', false);
    expect(page.events()).toEqual([]);
  });

  it('successful submit reveals the secret panel', () => {
    configure();
    page.form.controls.url.setValue('https://example.com/hook');
    page.toggleEvent('order.created', true);
    page.form.markAsDirty();
    page.submit();
    expect(createSpy).toHaveBeenCalledWith({
      url: 'https://example.com/hook',
      events: ['order.created'],
    });
    expect(page.revealedSecret()?.secret).toBe(created.secret);
  });

  it('finishReveal navigates to the detail page', () => {
    configure();
    const router = TestBed.inject(Router);
    const nav = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    page.finishReveal('wh-1');
    expect(nav).toHaveBeenCalledWith(['/webhooks', 'wh-1']);
  });

  it('maps backend WEBHOOK_URL_NOT_HTTPS to a URL field error', () => {
    configure();
    createSpy.mockReturnValue(
      throwError(
        () =>
          new ApiValidationError({
            code: 'WEBHOOK_URL_NOT_HTTPS',
            message: 'URL must use https',
          }),
      ),
    );
    page.form.controls.url.setValue('https://blocked.local/hook');
    page.toggleEvent('order.created', true);
    page.form.markAsDirty();
    page.submit();
    expect(page.urlError()).toMatch(/https/i);
    expect(page.topError()).toBeNull();
  });

  it('maps backend WEBHOOK_URL_INTERNAL_IP to a URL field error', () => {
    configure();
    createSpy.mockReturnValue(
      throwError(
        () =>
          new ApiValidationError({
            code: 'WEBHOOK_URL_INTERNAL_IP',
            message: 'URL resolves to a private/loopback IP',
          }),
      ),
    );
    page.form.controls.url.setValue('https://10.0.0.1/hook');
    page.toggleEvent('order.created', true);
    page.form.markAsDirty();
    page.submit();
    expect(page.urlError()).toMatch(/private|loopback/i);
  });

  it('non-URL backend errors surface as a top-level alert', () => {
    configure();
    createSpy.mockReturnValue(
      throwError(() => new ApiServerError({ code: 'SERVER', message: 'boom', status: 500 })),
    );
    page.form.controls.url.setValue('https://example.com/hook');
    page.toggleEvent('order.created', true);
    page.form.markAsDirty();
    page.submit();
    expect(page.topError()).toBeTruthy();
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
