import { HttpErrorResponse, provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AdminUser } from '@admin-types';
import { ADMIN_API_BASE_URL } from '../shared';
import { UsersService } from './users.service';

const userFixture: AdminUser = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
  email: 'owner@example.com',
  firstName: 'Store',
  lastName: 'Owner',
  roles: [],
  permissions: ['orders:view'],
  status: 'active',
};

const customerFixture = {
  ...userFixture,
  id: 'b4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb',
  segment: 'ACTIVE',
  totalSpent: 1250.5,
  orderCount: 7,
};

describe('UsersService', () => {
  let service: UsersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        UsersService,
      ],
    });
    service = TestBed.inject(UsersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('me() GETs /v1/users/me', (done) => {
    service.me().subscribe((user) => {
      expect(user.email).toBe('owner@example.com');
      done();
    });
    const req = http.expectOne('/api/v1/users/me');
    expect(req.request.method).toBe('GET');
    req.flush({ data: userFixture });
  });

  it('updateMe() PATCHes the body it was given', (done) => {
    service.updateMe({ firstName: 'Updated', locale: 'fr' }).subscribe(() => done());
    const req = http.expectOne('/api/v1/users/me');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ firstName: 'Updated', locale: 'fr' });
    req.flush({ data: userFixture });
  });

  it('updateMe() Zod-rejects locale shorter than 2 chars before network', () => {
    expect(() => service.updateMe({ locale: 'x' }).subscribe()).toThrow();
    http.expectNone('/api/v1/users/me');
  });

  it('updateMe() Zod-rejects locale longer than 10 chars before network', () => {
    expect(() => service.updateMe({ locale: 'x'.repeat(11) }).subscribe()).toThrow();
    http.expectNone('/api/v1/users/me');
  });

  it('updateMe() surfaces a 403 network error to the subscriber', (done) => {
    service.updateMe({ firstName: 'Nope' }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect(err).toBeDefined();
        done();
      },
    });
    const req = http.expectOne('/api/v1/users/me');
    req.flush(
      { error: { code: 'FORBIDDEN', message: 'nope' } },
      { status: 403, statusText: 'Forbidden' },
    );
  });

  it('me() surfaces a 401 network error to the subscriber', (done) => {
    service.me().subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect(err).toBeDefined();
        done();
      },
    });
    const req = http.expectOne('/api/v1/users/me');
    req.flush(
      { error: { code: 'UNAUTHORIZED', message: 'no token' } },
      { status: 401, statusText: 'Unauthorized' },
    );
  });

  it('listCustomers() applies pagination query params', (done) => {
    service.listCustomers({ page: 2, pageSize: 50, search: 'ali' }).subscribe((res) => {
      expect(res.data.length).toBe(1);
      expect(res.meta.page).toBe(2);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/customers');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('50');
    expect(req.request.params.get('search')).toBe('ali');
    req.flush({ data: [customerFixture], meta: { page: 2, pageSize: 50, total: 1 } });
  });

  it('listCustomers() surfaces the enriched columns off a backend-shaped row', (done) => {
    service.listCustomers().subscribe((res) => {
      const row = res.data[0];
      expect(row.orderCount).toBe(2);
      expect(row.totalSpent).toBe(410.25);
      expect(row.segment).toBe('ACTIVE');
      expect(row.status).toBe('inactive');
      done();
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/customers')
      .flush({
        // Mirrors the wire exactly: Prisma's `_count` nesting rides along beside
        // the flattened `orderCount`, and status comes from `isActive`.
        data: [
          {
            id: 'b4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb',
            email: 'sara@example.com',
            firstName: 'Sara',
            lastName: 'Hassan',
            isActive: false,
            emailVerified: true,
            _count: { orders: 2 },
            orderCount: 2,
            totalSpent: 410.25,
            segment: 'ACTIVE',
          },
        ],
        meta: { page: 1, pageSize: 20, total: 1 },
      });
  });

  it('getCustomer() GETs by id', (done) => {
    service.getCustomer('b4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb').subscribe((c) => {
      expect(c.segment).toBe('ACTIVE');
      done();
    });
    http.expectOne('/api/v1/admin/customers/b4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb').flush({
      data: customerFixture,
    });
  });

  it('listCustomerSegments() returns an array of summaries', (done) => {
    service.listCustomerSegments().subscribe((segments) => {
      expect(segments).toHaveLength(2);
      done();
    });
    http.expectOne('/api/v1/admin/customers/segments').flush({
      data: [
        { segment: 'ACTIVE', count: 120 },
        { segment: 'VIP', count: 5 },
      ],
    });
  });

  it('listCustomers() forwards segment=VIP when provided', (done) => {
    service.listCustomers({ segment: 'VIP' }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/customers');
    expect(req.request.params.get('segment')).toBe('VIP');
    req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it('listCustomers() sends no segment param when omitted', (done) => {
    service.listCustomers({ page: 1 }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/customers');
    expect(req.request.params.has('segment')).toBe(false);
    req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it('listCustomers() rejects unknown segment via Zod before network', () => {
    expect(() =>
      service.listCustomers({ segment: 'NOT_A_SEGMENT' as never }).subscribe(),
    ).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/customers');
  });

  it('listCustomers() rejects pageSize>100 via Zod before network', () => {
    expect(() => service.listCustomers({ pageSize: 101 }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/customers');
  });

  it('getCustomer() forwards a 404 error to the subscriber', (done) => {
    service.getCustomer('missing').subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect(err).toBeInstanceOf(HttpErrorResponse);
        expect((err as HttpErrorResponse).status).toBe(404);
        done();
      },
    });
    http.expectOne('/api/v1/admin/customers/missing').flush(
      { error: { code: 'NOT_FOUND', message: 'Customer not found' } },
      {
        status: 404,
        statusText: 'Not Found',
      },
    );
  });

  it('getCustomer() forwards a 403 error to the subscriber', (done) => {
    service.getCustomer('forbidden').subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http.expectOne('/api/v1/admin/customers/forbidden').flush(
      { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
      {
        status: 403,
        statusText: 'Forbidden',
      },
    );
  });

  it('updateCustomer() PATCHes the exact dirty body', (done) => {
    service
      .updateCustomer('b4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb', { firstName: 'Grace' })
      .subscribe((c) => {
        expect(c.email).toBe('owner@example.com');
        done();
      });
    const req = http.expectOne('/api/v1/admin/customers/b4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ firstName: 'Grace' });
    req.flush({ data: customerFixture });
  });

  it('updateCustomer() accepts an empty partial body and still fires', (done) => {
    service.updateCustomer('c1', {}).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/customers/c1');
    expect(req.request.body).toEqual({});
    req.flush({ data: customerFixture });
  });

  it('updateCustomer() rejects invalid email via Zod before network', () => {
    expect(() => service.updateCustomer('c1', { email: 'not-an-email' }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/customers/c1');
  });

  it('updateCustomer() rejects firstName >100 chars via Zod before network', () => {
    expect(() =>
      service.updateCustomer('c1', { firstName: 'x'.repeat(101) }).subscribe(),
    ).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/customers/c1');
  });

  it('updateCustomer() rejects phone >30 chars via Zod before network', () => {
    expect(() => service.updateCustomer('c1', { phone: 'x'.repeat(31) }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/customers/c1');
  });

  it('updateCustomer() surfaces a 409 email conflict to the subscriber', (done) => {
    service.updateCustomer('c1', { email: 'taken@example.com' }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(409);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/customers/c1')
      .flush(
        { error: { code: 'EMAIL_TAKEN', message: 'Email already in use' } },
        { status: 409, statusText: 'Conflict' },
      );
  });

  it('updateCustomer() surfaces a 403 forbidden to the subscriber', (done) => {
    service.updateCustomer('c1', { firstName: 'x' }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http.expectOne('/api/v1/admin/customers/c1').flush(
      { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
      {
        status: 403,
        statusText: 'Forbidden',
      },
    );
  });

  it('listCustomerSegments() returns [] for empty backend data', (done) => {
    service.listCustomerSegments().subscribe((segments) => {
      expect(segments).toEqual([]);
      done();
    });
    http.expectOne('/api/v1/admin/customers/segments').flush({ data: [] });
  });

  it('listCustomerSegments() forwards a 403 to the subscriber', (done) => {
    service.listCustomerSegments().subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http.expectOne('/api/v1/admin/customers/segments').flush(
      { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
      {
        status: 403,
        statusText: 'Forbidden',
      },
    );
  });

  it('createStaff() POSTs and rejects weak passwords via Zod', () => {
    expect(() =>
      service
        .createStaff({
          email: 'new@staff.com',
          password: 'weak',
          firstName: 'New',
          lastName: 'Staff',
          role: 'ADMIN',
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/staff');
  });

  it('createStaff() passes through a valid request body', (done) => {
    service
      .createStaff({
        email: 'new@staff.com',
        password: 'StrongPass1',
        firstName: 'New',
        lastName: 'Staff',
        role: 'SUPPORT',
      })
      .subscribe((res) => {
        expect(res.email).toBe('owner@example.com');
        done();
      });
    const req = http.expectOne('/api/v1/admin/staff');
    expect(req.request.method).toBe('POST');
    req.flush({ data: userFixture });
  });

  it('createStaff() rejects a too-short password via Zod before network', () => {
    expect(() =>
      service
        .createStaff({
          email: 'new@staff.com',
          password: 'Short1',
          firstName: 'New',
          lastName: 'Staff',
          role: 'SUPPORT',
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/staff');
  });

  it('createStaff() rejects empty firstName via Zod .min(1) before network', () => {
    expect(() =>
      service
        .createStaff({
          email: 'new@staff.com',
          password: 'StrongPass1',
          firstName: '',
          lastName: 'Staff',
          role: 'SUPPORT',
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/staff');
  });

  it('createStaff() surfaces a 409 email-conflict to the subscriber', (done) => {
    service
      .createStaff({
        email: 'taken@example.com',
        password: 'StrongPass1',
        firstName: 'Dup',
        lastName: 'Staff',
        role: 'SUPPORT',
      })
      .subscribe({
        next: () => done.fail('expected error'),
        error: (err: unknown) => {
          expect((err as HttpErrorResponse).status).toBe(409);
          done();
        },
      });
    http
      .expectOne('/api/v1/admin/staff')
      .flush(
        { error: { code: 'EMAIL_TAKEN', message: 'Email already in use' } },
        { status: 409, statusText: 'Conflict' },
      );
  });

  it('createStaff() surfaces a 403 forbidden to the subscriber', (done) => {
    service
      .createStaff({
        email: 'ok@staff.com',
        password: 'StrongPass1',
        firstName: 'Forbid',
        lastName: 'Staff',
        role: 'SUPPORT',
      })
      .subscribe({
        next: () => done.fail('expected error'),
        error: (err: unknown) => {
          expect((err as HttpErrorResponse).status).toBe(403);
          done();
        },
      });
    http
      .expectOne('/api/v1/admin/staff')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('listStaff() applies page + pageSize query params', (done) => {
    service.listStaff({ page: 2, pageSize: 50 }).subscribe((res) => {
      expect(res.meta.page).toBe(2);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/staff');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('50');
    req.flush({ data: [userFixture], meta: { page: 2, pageSize: 50, total: 1 } });
  });

  it('listStaff() forwards role=ADMIN when provided', (done) => {
    service.listStaff({ role: 'ADMIN' }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/staff');
    expect(req.request.params.get('role')).toBe('ADMIN');
    req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it('listStaff() sends no role param when omitted', (done) => {
    service.listStaff().subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/staff');
    expect(req.request.params.has('role')).toBe(false);
    req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it('listStaff() rejects an invalid role via Zod before network', () => {
    expect(() => service.listStaff({ role: 'NOT_A_ROLE' as never }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/staff');
  });

  it('listStaff() rejects pageSize > 100 via Zod before network', () => {
    expect(() => service.listStaff({ pageSize: 101 }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/staff');
  });

  it('listStaff() parses each data row via adminUserSchema', (done) => {
    service.listStaff().subscribe((res) => {
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.email).toBe('owner@example.com');
      done();
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/staff')
      .flush({ data: [userFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listStaff() keeps role, customRole, and the isActive-derived status', (done) => {
    service.listStaff().subscribe((res) => {
      const [row] = res.data;
      expect(row.role).toBe('ADMIN');
      expect(row.customRole?.name).toBe('Catalog editor');
      // isActive:false must beat adminUserSchema's `status` default of 'active'.
      expect(row.status).toBe('inactive');
      done();
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/staff')
      .flush({
        data: [
          {
            ...userFixture,
            role: 'ADMIN',
            customRole: { id: 'c4f5c9a4-1a1a-4a4a-8a8a-cccccccccccc', name: 'Catalog editor' },
            isActive: false,
          },
        ],
        meta: { page: 1, pageSize: 20, total: 1 },
      });
  });

  it('listStaff() parses a SUPER_ADMIN row and a permission-bearing customRole', (done) => {
    service.listStaff({ role: 'SUPER_ADMIN' }).subscribe((res) => {
      expect(res.data[0]?.role).toBe('SUPER_ADMIN');
      expect(res.data[0]?.customRole?.name).toBe('Owner');
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/staff');
    expect(req.request.params.get('role')).toBe('SUPER_ADMIN');
    req.flush({
      data: [
        {
          ...userFixture,
          role: 'SUPER_ADMIN',
          customRole: {
            id: 'c4f5c9a4-1a1a-4a4a-8a8a-cccccccccccc',
            name: 'Owner',
            permissions: [{ permission: 'orders:view' }],
          },
          isActive: true,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });

  it('listStaff() forwards a 403 error to the subscriber', (done) => {
    service.listStaff().subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/staff')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('updateStaff() PATCHes /api/v1/admin/staff/:id with the given body', (done) => {
    service.updateStaff('s1', { firstName: 'Updated' }).subscribe((res) => {
      expect(res.email).toBe('owner@example.com');
      done();
    });
    const req = http.expectOne('/api/v1/admin/staff/s1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ firstName: 'Updated' });
    req.flush({ data: userFixture });
  });

  it('updateStaff() accepts an empty partial body and still fires', (done) => {
    service.updateStaff('s1', {}).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/staff/s1');
    expect(req.request.body).toEqual({});
    req.flush({ data: userFixture });
  });

  it('updateStaff() rejects an invalid role via Zod before network', () => {
    expect(() => service.updateStaff('s1', { role: 'NOT_A_ROLE' as never }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/staff/s1');
  });

  it('updateStaff() rejects firstName > 100 chars via Zod before network', () => {
    expect(() => service.updateStaff('s1', { firstName: 'x'.repeat(101) }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/staff/s1');
  });

  it('updateStaff() surfaces a 404 not-found to the subscriber', (done) => {
    service.updateStaff('missing', { firstName: 'x' }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(404);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/staff/missing')
      .flush(
        { error: { code: 'NOT_FOUND', message: 'Staff not found' } },
        { status: 404, statusText: 'Not Found' },
      );
  });

  it('updateStaff() surfaces a 403 forbidden to the subscriber', (done) => {
    service.updateStaff('forbidden', { firstName: 'x' }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/staff/forbidden')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('deactivateStaff() issues DELETE', (done) => {
    service.deactivateStaff('staff-id').subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/staff/staff-id');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('deactivateStaff() surfaces a 404 not-found to the subscriber', (done) => {
    service.deactivateStaff('missing').subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(404);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/staff/missing')
      .flush(
        { error: { code: 'NOT_FOUND', message: 'Staff not found' } },
        { status: 404, statusText: 'Not Found' },
      );
  });

  it('deactivateStaff() surfaces a 403 forbidden to the subscriber', (done) => {
    service.deactivateStaff('forbidden').subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/staff/forbidden')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });
});
