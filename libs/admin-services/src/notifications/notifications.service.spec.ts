import { HttpErrorResponse, provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { NotificationsService } from './notifications.service';

const notificationFixture = {
  id: 'n-1',
  userId: 'user-1',
  type: 'NEW_ORDER',
  title: { default: 'Commande', fr: 'Nouvelle commande', en: 'New Order' },
  body: {
    default: 'Order #1234 has been placed',
    en: 'Order #1234 has been placed',
    fr: 'Commande passée',
  },
  data: { id: 'o-1', orderNumber: '1234' },
  isRead: false,
  readAt: null,
  createdAt: '2026-04-15T12:00:00.000Z',
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        NotificationsService,
      ],
    });
    service = TestBed.inject(NotificationsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() forwards isRead + pagination', (done) => {
    service.list({ isRead: false, page: 1 }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/notifications');
    expect(req.request.params.get('isRead')).toBe('false');
    req.flush({ data: [notificationFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('list() forwards every query param as a string', (done) => {
    service.list({ isRead: true, page: 2, pageSize: 50 }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/notifications');
    expect(req.request.params.get('isRead')).toBe('true');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('50');
    req.flush({ data: [], meta: { page: 2, pageSize: 50, total: 0 } });
  });

  it('list() rejects pageSize 0 via Zod before the network', () => {
    expect(() => service.list({ pageSize: 0 as never }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/notifications');
  });

  it('list() rejects negative page via Zod before the network', () => {
    expect(() => service.list({ page: -1 as never }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/notifications');
  });

  it('list() rejects pageSize above 100 via Zod before the network', () => {
    expect(() => service.list({ pageSize: 101 as never }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/notifications');
  });

  it('list() parses a realistic Translatable-shaped envelope with mixed-shape rows', (done) => {
    const minimal = {
      id: 'n-2',
      userId: 'user-1',
      type: 'LOW_STOCK',
      isRead: true,
      readAt: '2026-04-15T13:00:00.000Z',
      createdAt: '2026-04-15T12:30:00.000Z',
    };
    service.list({}).subscribe((res) => {
      expect(res.data).toHaveLength(2);
      expect(res.data[0].title?.default).toBe('Commande');
      expect(res.data[1].title).toBeUndefined();
      done();
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/notifications')
      .flush({ data: [notificationFixture, minimal], meta: { page: 1, pageSize: 20, total: 2 } });
  });

  it('list() forwards a 500 error to the subscriber', (done) => {
    service.list({}).subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(500);
        done();
      },
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/notifications')
      .flush(
        { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } },
        { status: 500, statusText: 'Internal Server Error' },
      );
  });

  it('list() forwards a 403 error to the subscriber', (done) => {
    service.list({}).subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/notifications')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'nope' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('unreadCount() unwraps the envelope', (done) => {
    service.unreadCount().subscribe((res) => {
      expect(res.unreadCount).toBe(3);
      done();
    });
    http.expectOne('/api/v1/admin/notifications/unread-count').flush({ data: { unreadCount: 3 } });
  });

  it('unreadCount() unwraps a zero count', (done) => {
    service.unreadCount().subscribe((res) => {
      expect(res.unreadCount).toBe(0);
      done();
    });
    http.expectOne('/api/v1/admin/notifications/unread-count').flush({ data: { unreadCount: 0 } });
  });

  it('unreadCount() rejects a malformed response via Zod', (done) => {
    service.unreadCount().subscribe({
      next: () => done.fail('should have errored'),
      error: () => done(),
    });
    http
      .expectOne('/api/v1/admin/notifications/unread-count')
      .flush({ data: { unreadCount: 'not-a-number' } });
  });

  it('unreadCount() forwards a 403 to the subscriber', (done) => {
    service.unreadCount().subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/notifications/unread-count')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'nope' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('markRead() PATCHes /:id/read', (done) => {
    service.markRead('n-1').subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/notifications/n-1/read');
    expect(req.request.method).toBe('PATCH');
    req.flush(null);
  });

  it('markRead() forwards a 404 to the subscriber', (done) => {
    service.markRead('missing').subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/notifications/missing/read')
      .flush(
        { error: { code: 'NOT_FOUND', message: 'x' } },
        { status: 404, statusText: 'Not Found' },
      );
  });

  it('markRead() forwards a 403 to the subscriber', (done) => {
    service.markRead('n-1').subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/notifications/n-1/read')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'nope' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('markAllRead() PATCHes /read-all', (done) => {
    service.markAllRead().subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/notifications/read-all');
    expect(req.request.method).toBe('PATCH');
    req.flush(null);
  });

  it('markAllRead() forwards a 403 to the subscriber', (done) => {
    service.markAllRead().subscribe({
      next: () => done.fail('should have errored'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/notifications/read-all')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'nope' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });
});
