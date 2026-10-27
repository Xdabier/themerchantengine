import { HttpErrorResponse, provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { NotificationTemplatesService } from './notification-templates.service';

const templateFixture = {
  id: 'tmpl-1',
  code: 'order.shipped',
  subject: { default: 'Your order has shipped' },
  body: { default: 'Hi {{customerName}}' },
  channel: 'email',
  event: 'order.shipped',
  variables: ['customerName'],
  isEnabled: true,
};

const logFixture = {
  id: 'log-1',
  templateId: 'tmpl-1',
  templateCode: 'order.shipped',
  channel: 'email',
  recipient: 'a@b.com',
  status: 'sent',
  sentAt: '2026-04-17T09:00:00.000Z',
};

describe('NotificationTemplatesService', () => {
  let service: NotificationTemplatesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        NotificationTemplatesService,
      ],
    });
    service = TestBed.inject(NotificationTemplatesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listTemplates() forwards channel + event filters', (done) => {
    service
      .listTemplates({ channel: 'email', event: 'order.shipped', isEnabled: true })
      .subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/notifications/templates');
    expect(req.request.params.get('channel')).toBe('email');
    expect(req.request.params.get('event')).toBe('order.shipped');
    expect(req.request.params.get('isEnabled')).toBe('true');
    req.flush({ data: [templateFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('getTemplate() unwraps envelope', (done) => {
    service.getTemplate('tmpl-1').subscribe((t) => {
      expect(t.code).toBe('order.shipped');
      done();
    });
    http.expectOne('/api/v1/admin/notifications/templates/tmpl-1').flush({ data: templateFixture });
  });

  it('getTemplate() forwards a 404 to the subscriber', (done) => {
    service.getTemplate('missing').subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/notifications/templates/missing')
      .flush(
        { error: { code: 'NOT_FOUND', message: 'x' } },
        { status: 404, statusText: 'Not Found' },
      );
  });

  it('createTemplate() rejects invalid code via Zod', () => {
    expect(() =>
      service
        .createTemplate({
          code: 'INVALID CODE',
          body: { default: 'x' },
          channel: 'email',
          event: 'order.shipped',
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/notifications/templates');
  });

  it('updateTemplate() PATCHes the template', (done) => {
    service.updateTemplate('tmpl-1', { isEnabled: false }).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/notifications/templates/tmpl-1');
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: { ...templateFixture, isEnabled: false } });
  });

  it('deleteTemplate() hits DELETE', (done) => {
    service.deleteTemplate('tmpl-1').subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/notifications/templates/tmpl-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('listLog() forwards all filters', (done) => {
    service
      .listLog({
        channel: 'email',
        status: 'sent',
        templateCode: 'order.shipped',
        from: '2026-04-01T00:00:00.000Z',
      })
      .subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/notifications/log');
    expect(req.request.params.get('channel')).toBe('email');
    expect(req.request.params.get('status')).toBe('sent');
    expect(req.request.params.get('templateCode')).toBe('order.shipped');
    expect(req.request.params.get('from')).toBe('2026-04-01T00:00:00.000Z');
    req.flush({ data: [logFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('resend() POSTs and parses queued response', (done) => {
    service.resend('log-1').subscribe((res) => {
      expect(res).toEqual({ status: 'queued', recipient: 'a@b.com' });
      done();
    });
    const req = http.expectOne('/api/v1/admin/notifications/log/log-1/resend');
    expect(req.request.method).toBe('POST');
    req.flush({ data: { status: 'queued', recipient: 'a@b.com' } });
  });

  it('resend() forwards a 404 to the subscriber', (done) => {
    service.resend('missing').subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/notifications/log/missing/resend')
      .flush(
        { error: { code: 'NOT_FOUND', message: 'x' } },
        { status: 404, statusText: 'Not Found' },
      );
  });

  it('resend() forwards a 403 to the subscriber', (done) => {
    service.resend('log-1').subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/notifications/log/log-1/resend')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'nope' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('resend() rejects a malformed response via Zod (no recipient)', (done) => {
    service.resend('log-1').subscribe({
      next: () => done.fail('should have errored'),
      error: () => done(),
    });
    http
      .expectOne('/api/v1/admin/notifications/log/log-1/resend')
      .flush({ data: { status: 'queued' } });
  });

  it('listLog() rejects pageSize above 100 via Zod before the network', () => {
    expect(() => service.listLog({ pageSize: 101 as never }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/notifications/log');
  });

  it('listLog() rejects an unknown status value via Zod before the network', () => {
    expect(() => service.listLog({ status: 'NOT_A_STATUS' as never }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/notifications/log');
  });

  it('listLog() forwards a 403 to the subscriber', (done) => {
    service.listLog({}).subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/notifications/log')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'nope' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  // ── NE6 preview + send-test ────────────────────────────────────────────────

  it('preview() POSTs the draft and parses the both-locale render', (done) => {
    service
      .preview('tmpl-1', { body: { default: 'Hi {{customerName}}' }, variables: ['customerName'] })
      .subscribe((res) => {
        expect(res['en'].html).toContain('<html>en</html>');
        expect(res['fr'].subject).toBe('Sujet');
        done();
      });
    const req = http.expectOne('/api/v1/admin/notifications/templates/tmpl-1/preview');
    expect(req.request.method).toBe('POST');
    req.flush({
      data: {
        en: { subject: 'EN', html: '<html>en</html>', text: 'en' },
        fr: { subject: 'Sujet', html: '<html>fr</html>', text: 'fr' },
      },
    });
  });

  it('preview() accepts whatever locale set the renderer returns', (done) => {
    // A one-locale response is valid: the key set is the renderer's business
    // and it changes at D7. What must still fail is a malformed ENTRY.
    service.preview('tmpl-1', { body: { default: 'x' } }).subscribe({
      next: (res) => {
        expect(res).toEqual({ en: { subject: 'S', html: 'x', text: 'S' } });
        done();
      },
      error: (err: unknown) => done(err),
    });
    http
      .expectOne('/api/v1/admin/notifications/templates/tmpl-1/preview')
      .flush({ data: { en: { subject: 'S', html: 'x', text: 'S' } } });
  });

  it('preview() rejects a malformed locale entry via Zod', (done) => {
    service.preview('tmpl-1', { body: { default: 'x' } }).subscribe({
      next: () => done(new Error('should have errored')),
      error: () => done(),
    });
    http
      .expectOne('/api/v1/admin/notifications/templates/tmpl-1/preview')
      .flush({ data: { en: { subject: 'S', html: 'x' } } });
  });

  it('sendTest() POSTs the locale + parses the enqueue outcome', (done) => {
    service.sendTest('tmpl-1', { locale: 'en' }).subscribe((res) => {
      expect(res).toEqual({ status: 'queued', recipient: 'me@store.test', logId: 'log-9' });
      done();
    });
    const req = http.expectOne('/api/v1/admin/notifications/templates/tmpl-1/send-test');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ locale: 'en' });
    req.flush({ data: { status: 'queued', recipient: 'me@store.test', logId: 'log-9' } });
  });

  it('sendTest() forwards a 404 to the subscriber', (done) => {
    service.sendTest('missing').subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/notifications/templates/missing/send-test')
      .flush(
        { error: { code: 'NOT_FOUND', message: 'x' } },
        { status: 404, statusText: 'Not Found' },
      );
  });
});
