import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { AuditLogService } from './audit-log.service';

const entryFixture = {
  id: 'log-1',
  userId: 'user-1',
  user: { id: 'user-1', email: 'admin@merchants.test', firstName: 'Ada', lastName: 'Lovelace' },
  entityType: 'Product',
  entityId: 'prod-1',
  action: 'update',
  before: { price: 1000 },
  after: { price: 1200 },
  createdAt: '2026-04-15T10:00:00.000Z',
};

describe('AuditLogService', () => {
  let service: AuditLogService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        AuditLogService,
      ],
    });
    service = TestBed.inject(AuditLogService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() sends filters as query params', (done) => {
    service
      .list({
        entityType: 'Product',
        action: 'update',
        from: '2026-04-01T00:00:00Z',
        page: 2,
      })
      .subscribe((res) => {
        expect(res.data).toHaveLength(1);
        done();
      });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/audit-log');
    expect(req.request.params.get('entityType')).toBe('Product');
    expect(req.request.params.get('action')).toBe('update');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ data: [entryFixture], meta: { page: 2, pageSize: 20, total: 1 } });
  });

  it('listByEntity() URL-encodes entity parts', (done) => {
    service.listByEntity('Order/A', 'id with space').subscribe(() => done());
    const req = http.expectOne(
      (r) => r.url === '/api/v1/admin/audit-log/Order%2FA/id%20with%20space',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ data: [entryFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listByEntity() forwards query params + parses the response shape', (done) => {
    service
      .listByEntity('Product', 'prod-1', { page: 3, pageSize: 50, action: 'update' })
      .subscribe((res) => {
        expect(res.data).toHaveLength(1);
        expect(res.data[0].user?.email).toBe('admin@merchants.test');
        expect(res.meta).toEqual({ page: 3, pageSize: 50, total: 1 });
        done();
      });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/audit-log/Product/prod-1');
    expect(req.request.params.get('page')).toBe('3');
    expect(req.request.params.get('pageSize')).toBe('50');
    expect(req.request.params.get('action')).toBe('update');
    req.flush({ data: [entryFixture], meta: { page: 3, pageSize: 50, total: 1 } });
  });

  it('list() errors when the response fails Zod parse', (done) => {
    service.list().subscribe({
      next: () => done('expected error'),
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/audit-log');
    req.flush({ data: [{ id: 42 }], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listByEntity() errors when the response fails Zod parse', (done) => {
    service.listByEntity('Product', 'prod-1').subscribe({
      next: () => done('expected error'),
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/audit-log/Product/prod-1');
    req.flush({ data: [{ id: 'log-1' }], meta: { page: 1 } });
  });
});
