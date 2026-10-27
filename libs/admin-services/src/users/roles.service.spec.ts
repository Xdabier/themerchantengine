import { HttpErrorResponse, provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { RolesService } from './roles.service';

const roleFixture = {
  id: 'b4f5c9a4-1a1a-4a4a-8a8a-bbbbbbbbbbbb',
  name: 'admin',
  description: 'Full access',
  permissions: ['orders:view', 'orders:create', 'returns:manage'],
};

describe('RolesService', () => {
  let service: RolesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        RolesService,
      ],
    });
    service = TestBed.inject(RolesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() GETs /v1/admin/roles', (done) => {
    service.list().subscribe((roles) => {
      expect(roles).toHaveLength(1);
      expect(roles[0]?.name).toBe('admin');
      done();
    });
    http.expectOne('/api/v1/admin/roles').flush({ data: [roleFixture] });
  });

  it('create() POSTs with full request body', (done) => {
    service
      .create({
        name: 'support',
        description: 'Support agents',
        permissions: ['orders:view', 'returns:create'],
      })
      .subscribe((role) => {
        expect(role.id).toBeTruthy();
        done();
      });
    const req = http.expectOne('/api/v1/admin/roles');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'support',
      description: 'Support agents',
      permissions: ['orders:view', 'returns:create'],
    });
    req.flush({ data: roleFixture });
  });

  it('create() rejects invalid permission strings', () => {
    expect(() =>
      service.create({ name: 'x', permissions: ['not-a-valid-permission'] as never }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/roles');
  });

  it('updatePermissions() PATCHes /v1/admin/roles/:id', (done) => {
    service.updatePermissions('role-id', { permissions: ['orders:view'] }).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/roles/role-id');
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: roleFixture });
  });

  it('list() returns [] for an empty backend response', (done) => {
    service.list().subscribe((roles) => {
      expect(roles).toEqual([]);
      done();
    });
    http.expectOne('/api/v1/admin/roles').flush({ data: [] });
  });

  it('list() forwards a 403 error to the subscriber', (done) => {
    service.list().subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/roles')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('create() rejects an empty permissions array via Zod .nonempty()', () => {
    expect(() =>
      service
        .create({ name: 'qa', permissions: [] as unknown as [string, ...string[]] })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/roles');
  });

  it('create() rejects an empty name via Zod .min(1)', () => {
    expect(() => service.create({ name: '', permissions: ['orders:view'] }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/roles');
  });

  it('create() rejects name > 50 chars via Zod .max(50)', () => {
    expect(() =>
      service.create({ name: 'x'.repeat(51), permissions: ['orders:view'] }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/roles');
  });

  it('create() rejects description > 255 chars via Zod .max(255)', () => {
    expect(() =>
      service
        .create({ name: 'ok', description: 'x'.repeat(256), permissions: ['orders:view'] })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/roles');
  });

  it('create() surfaces a 409 duplicate-name to the subscriber', (done) => {
    service.create({ name: 'admin', permissions: ['orders:view'] }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(409);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/roles')
      .flush(
        { error: { code: 'ROLE_EXISTS', message: 'Role already exists' } },
        { status: 409, statusText: 'Conflict' },
      );
  });

  it('create() surfaces a 403 forbidden to the subscriber', (done) => {
    service.create({ name: 'qa', permissions: ['orders:view'] }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/roles')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('updatePermissions() rejects an empty array via Zod .nonempty()', () => {
    expect(() =>
      service
        .updatePermissions('role-id', {
          permissions: [] as unknown as [string, ...string[]],
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/roles/role-id');
  });

  it('updatePermissions() rejects invalid permission strings via Zod regex', () => {
    expect(() =>
      service.updatePermissions('role-id', { permissions: ['not-valid'] }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/roles/role-id');
  });

  it('updatePermissions() surfaces a 404 not-found to the subscriber', (done) => {
    service.updatePermissions('missing', { permissions: ['orders:view'] }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(404);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/roles/missing')
      .flush(
        { error: { code: 'ROLE_NOT_FOUND', message: 'Role not found' } },
        { status: 404, statusText: 'Not Found' },
      );
  });

  it('updatePermissions() surfaces a 403 forbidden to the subscriber', (done) => {
    service.updatePermissions('forbidden', { permissions: ['orders:view'] }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect((err as HttpErrorResponse).status).toBe(403);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/roles/forbidden')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  it('updatePermissions() happy path parses the response via roleSchema', (done) => {
    service
      .updatePermissions('role-id', { permissions: ['orders:view', 'products:view'] })
      .subscribe((role) => {
        expect(role.permissions).toEqual(['orders:view', 'products:view']);
        done();
      });
    http
      .expectOne('/api/v1/admin/roles/role-id')
      .flush({ data: { ...roleFixture, permissions: ['orders:view', 'products:view'] } });
  });
});
