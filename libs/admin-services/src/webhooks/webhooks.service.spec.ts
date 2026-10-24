import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ZodError } from 'zod';
import { ADMIN_API_BASE_URL } from '../shared';
import { WebhooksService } from './webhooks.service';

const webhookId = 'c4f5c9a4-1a1a-4a4a-8a8a-ab0000000020';
const deliveryId = 'd4f5c9a4-1a1a-4a4a-8a8a-ab0000000030';
const eventId = 'e4f5c9a4-1a1a-4a4a-8a8a-ab0000000040';

const webhookFixture = {
  id: webhookId,
  url: 'https://example.com/hook',
  events: ['order.created'],
  isActive: true,
  failureCount: 0,
  lastDeliveredAt: null,
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
};

const secretFixture = {
  ...webhookFixture,
  secret: 'this-is-a-very-long-secret-value-0123',
};

describe('WebhooksService', () => {
  let service: WebhooksService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        WebhooksService,
      ],
    });
    service = TestBed.inject(WebhooksService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ── create() ──────────────────────────────────────────────────────────────

  it('create() rejects non-https urls', () => {
    expect(() =>
      service.create({ url: 'http://example.com/hook', events: ['order.created'] }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/webhooks');
  });

  it('create() rejects empty events array', () => {
    expect(() =>
      service.create({ url: 'https://example.com/hook', events: [] as never }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/webhooks');
  });

  it('create() rejects unknown event types', () => {
    expect(() =>
      service
        .create({
          url: 'https://example.com/hook',
          events: ['unknown.event' as never],
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/webhooks');
  });

  it('create() rejects a secret shorter than 16 characters before the network', () => {
    expect(() =>
      service
        .create({
          url: 'https://example.com/hook',
          events: ['order.created'],
          secret: 'tooshort',
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/webhooks');
  });

  it('create() POSTs and returns secret on success', (done) => {
    service
      .create({ url: 'https://example.com/hook', events: ['order.created'] })
      .subscribe((result) => {
        expect(result.secret).toBe(secretFixture.secret);
        done();
      });
    const req = http.expectOne('/api/v1/admin/webhooks');
    expect(req.request.method).toBe('POST');
    req.flush({ data: secretFixture });
  });

  it('create() throws a ZodError when the POST response envelope omits the secret', (done) => {
    service.create({ url: 'https://example.com/hook', events: ['order.created'] }).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err).toBeInstanceOf(ZodError);
        done();
      },
    });
    const req = http.expectOne('/api/v1/admin/webhooks');
    req.flush({ data: webhookFixture });
  });

  // ── list() ────────────────────────────────────────────────────────────────

  it('list() GETs with pagination params', (done) => {
    service.list({ page: 2, pageSize: 25 }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/webhooks');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    req.flush({ data: [webhookFixture], meta: { page: 2, pageSize: 25, total: 1 } });
  });

  it('list() rejects pageSize greater than 100 before the network', () => {
    expect(() => service.list({ pageSize: 101 }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/webhooks');
  });

  it('list() throws a ZodError when the response is missing the meta field', (done) => {
    service.list().subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err).toBeInstanceOf(ZodError);
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/webhooks');
    req.flush({ data: [webhookFixture] });
  });

  it('list() throws a ZodError when a webhook item in data is malformed', (done) => {
    service.list().subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err).toBeInstanceOf(ZodError);
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/webhooks');
    req.flush({
      data: [{ id: 'malformed', url: 'not-https', events: [], isActive: true, failureCount: 0 }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });

  // ── get() ─────────────────────────────────────────────────────────────────

  it('get() retrieves single webhook (no secret)', (done) => {
    service.get(webhookId).subscribe((w) => {
      expect(w.id).toBe(webhookId);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/webhooks/${webhookId}`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: webhookFixture });
  });

  it('get() surfaces WEBHOOK_NOT_FOUND 404 to the error callback', (done) => {
    service.get(webhookId).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/webhooks/${webhookId}`);
    req.flush(
      { error: { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook subscription not found' } },
      { status: 404, statusText: 'Not Found' },
    );
  });

  // ── update() ──────────────────────────────────────────────────────────────

  it('update() PATCHes url + events + active flag', (done) => {
    service
      .update(webhookId, {
        url: 'https://example.com/hook2',
        events: ['order.created', 'order.cancelled'],
        isActive: true,
      })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/webhooks/${webhookId}`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: webhookFixture });
  });

  it('update() rejects a non-https URL before the network', () => {
    expect(() =>
      service.update(webhookId, { url: 'http://example.com/hook' }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/webhooks/${webhookId}`);
  });

  it('update() rejects an empty events array before the network', () => {
    expect(() => service.update(webhookId, { events: [] as never }).subscribe()).toThrow();
    http.expectNone(`/api/v1/admin/webhooks/${webhookId}`);
  });

  it('update() rejects unknown event types before the network', () => {
    expect(() =>
      service.update(webhookId, { events: ['unknown.event' as never] }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/webhooks/${webhookId}`);
  });

  // ── remove() ──────────────────────────────────────────────────────────────

  it('remove() DELETEs webhook', (done) => {
    service.remove(webhookId).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/webhooks/${webhookId}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  // ── test() ────────────────────────────────────────────────────────────────

  it('test() POSTs /test and parses { eventId, deliveryId } result', (done) => {
    service.test(webhookId).subscribe((res) => {
      expect(res.eventId).toBe(eventId);
      expect(res.deliveryId).toBe(deliveryId);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/webhooks/${webhookId}/test`);
    expect(req.request.method).toBe('POST');
    // The endpoint requires it; without the header every click 400s.
    expect(req.request.headers.get('X-Idempotency-Key')).toMatch(/[0-9a-f-]{36}/i);
    req.flush({ data: { eventId, deliveryId } });
  });

  // ── deliveries() ──────────────────────────────────────────────────────────

  it('deliveries() GETs paginated delivery log', (done) => {
    service.deliveries(webhookId, { page: 1 }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === `/api/v1/admin/webhooks/${webhookId}/deliveries`);
    expect(req.request.method).toBe('GET');
    req.flush({
      data: [
        {
          id: deliveryId,
          subscriptionId: webhookId,
          eventType: 'order.created',
          eventId,
          payload: { eventId, eventType: 'order.created' },
          attempt: 1,
          createdAt: '2026-04-20T10:00:00.000Z',
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });

  it('deliveries() rejects pageSize greater than 100 before the network', () => {
    expect(() => service.deliveries(webhookId, { pageSize: 101 }).subscribe()).toThrow();
    http.expectNone((r) => r.url === `/api/v1/admin/webhooks/${webhookId}/deliveries`);
  });

  it('deliveries() parses a delivery row with every nullable Prisma field populated', (done) => {
    service.deliveries(webhookId).subscribe((page) => {
      const row = page.data[0];
      expect(row.responseStatus).toBe(200);
      expect(row.responseBody).toBe('{"ok":true}');
      expect(row.succeededAt).toBe('2026-04-20T10:01:00.000Z');
      expect(row.failedAt).toBeNull();
      expect(row.nextRetryAt).toBeNull();
      done();
    });
    const req = http.expectOne((r) => r.url === `/api/v1/admin/webhooks/${webhookId}/deliveries`);
    req.flush({
      data: [
        {
          id: deliveryId,
          subscriptionId: webhookId,
          eventType: 'order.created',
          eventId,
          payload: { eventId, eventType: 'order.created' },
          attempt: 2,
          responseStatus: 200,
          responseBody: '{"ok":true}',
          succeededAt: '2026-04-20T10:01:00.000Z',
          failedAt: null,
          nextRetryAt: null,
          createdAt: '2026-04-20T10:00:00.000Z',
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });
});
