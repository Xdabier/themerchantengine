import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { TaxService } from './tax.service';

const zoneFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-bb0000000001',
  name: 'TVA France',
  countries: ['TN'],
  rate: 0.19,
  isActive: true,
};

const classFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-bb0000000002',
  zoneId: zoneFixture.id,
  name: 'Standard',
  rate: 0.19,
  isDefault: true,
};

const listMeta = { page: 1, pageSize: 20, total: 1 };

describe('TaxService', () => {
  let service: TaxService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        TaxService,
      ],
    });
    service = TestBed.inject(TaxService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('listZones()', () => {
    it('parses the paginated envelope', (done) => {
      service.listZones().subscribe((res) => {
        expect(res.data).toHaveLength(1);
        expect(res.data[0].rate).toBe(0.19);
        expect(res.meta.total).toBe(1);
        done();
      });
      const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/zones');
      expect(req.request.method).toBe('GET');
      req.flush({ data: [zoneFixture], meta: listMeta });
    });

    it('coerces a decimal-string rate to a number', (done) => {
      service.listZones().subscribe((res) => {
        expect(res.data[0].rate).toBe(0.19);
        expect(typeof res.data[0].rate).toBe('number');
        done();
      });
      const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/zones');
      req.flush({ data: [{ ...zoneFixture, rate: '0.19' }], meta: listMeta });
    });

    it('forwards page + pageSize query parameters', (done) => {
      service.listZones({ page: 2, pageSize: 10 }).subscribe(() => done());
      const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/zones');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('10');
      req.flush({ data: [], meta: { page: 2, pageSize: 10, total: 0 } });
    });

    it('rejects a response whose rate falls outside the [0,1] fraction range', () => {
      return new Promise<void>((resolve, reject) => {
        service.listZones().subscribe({
          next: () => reject(new Error('expected the malformed rate to reject')),
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          },
        });
        const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/zones');
        req.flush({ data: [{ ...zoneFixture, rate: 1.5 }], meta: listMeta });
      });
    });

    it.each([
      [400, 'Bad Request'],
      [403, 'Forbidden'],
      [404, 'Not Found'],
    ] as const)('surfaces %i backend errors to the caller', (status, statusText) => {
      return new Promise<void>((resolve, reject) => {
        service.listZones().subscribe({
          next: () => reject(new Error('expected the backend error to surface')),
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          },
        });
        const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/zones');
        req.flush({ error: { code: 'ERR', message: statusText } }, { status, statusText });
      });
    });
  });

  describe('getZone()', () => {
    it('unwraps the envelope on a single zone fetch', (done) => {
      service.getZone(zoneFixture.id).subscribe((z) => {
        expect(z.id).toBe(zoneFixture.id);
        expect(z.rate).toBe(0.19);
        done();
      });
      const req = http.expectOne(`/api/v1/admin/tax/zones/${zoneFixture.id}`);
      expect(req.request.method).toBe('GET');
      req.flush({ data: zoneFixture });
    });

    it.each([
      [403, 'Forbidden'],
      [404, 'Not Found'],
    ] as const)('surfaces %i backend errors to the caller', (status, statusText) => {
      return new Promise<void>((resolve, reject) => {
        service.getZone(zoneFixture.id).subscribe({
          next: () => reject(new Error('expected the backend error to surface')),
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          },
        });
        const req = http.expectOne(`/api/v1/admin/tax/zones/${zoneFixture.id}`);
        req.flush({ error: { code: 'ERR', message: statusText } }, { status, statusText });
      });
    });
  });

  describe('createZone()', () => {
    it('rejects rate > 1 before hitting the network', () => {
      expect(() =>
        service.createZone({ name: { default: 'X' }, countries: ['TN'], rate: 1.5 }).subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/tax/zones');
    });

    it('rejects an empty name', () => {
      expect(() =>
        service.createZone({ name: { default: '' }, countries: ['TN'], rate: 0.19 }).subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/tax/zones');
    });

    it('rejects an empty countries array', () => {
      expect(() =>
        service
          .createZone({
            name: { default: 'X' },
            countries: [] as unknown as [string, ...string[]],
            rate: 0.19,
          })
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/tax/zones');
    });

    it('POSTs a valid body and unwraps the response envelope', (done) => {
      service
        .createZone({ name: { default: 'TVA France' }, countries: ['TN'], rate: 0.19 })
        .subscribe((z) => {
          expect(z.rate).toBe(0.19);
          expect(z.id).toBe(zoneFixture.id);
          done();
        });
      const req = http.expectOne('/api/v1/admin/tax/zones');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        name: { default: 'TVA France' },
        countries: ['TN'],
        rate: 0.19,
      });
      req.flush({ data: zoneFixture });
    });

    it.each([
      [400, 'Bad Request'],
      [403, 'Forbidden'],
    ] as const)('surfaces %i backend errors to the caller', (status, statusText) => {
      return new Promise<void>((resolve, reject) => {
        service.createZone({ name: { default: 'X' }, countries: ['TN'], rate: 0.19 }).subscribe({
          next: () => reject(new Error('expected the backend error to surface')),
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          },
        });
        const req = http.expectOne('/api/v1/admin/tax/zones');
        req.flush({ error: { code: 'ERR', message: statusText } }, { status, statusText });
      });
    });
  });

  describe('updateZone()', () => {
    it('PATCHes the provided partial body', (done) => {
      service.updateZone(zoneFixture.id, { rate: 0.1 }).subscribe((z) => {
        expect(z.rate).toBe(0.1);
        done();
      });
      const req = http.expectOne(`/api/v1/admin/tax/zones/${zoneFixture.id}`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ rate: 0.1 });
      req.flush({ data: { ...zoneFixture, rate: 0.1 } });
    });

    it('coerces a decimal-string rate on the response', (done) => {
      service.updateZone(zoneFixture.id, { rate: 0.1 }).subscribe((z) => {
        expect(z.rate).toBe(0.1);
        expect(typeof z.rate).toBe('number');
        done();
      });
      const req = http.expectOne(`/api/v1/admin/tax/zones/${zoneFixture.id}`);
      req.flush({ data: { ...zoneFixture, rate: '0.10' } });
    });

    it.each([
      [400, 'Bad Request'],
      [403, 'Forbidden'],
      [404, 'Not Found'],
    ] as const)('surfaces %i backend errors to the caller', (status, statusText) => {
      return new Promise<void>((resolve, reject) => {
        service.updateZone(zoneFixture.id, { rate: 0.1 }).subscribe({
          next: () => reject(new Error('expected the backend error to surface')),
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          },
        });
        const req = http.expectOne(`/api/v1/admin/tax/zones/${zoneFixture.id}`);
        req.flush({ error: { code: 'ERR', message: statusText } }, { status, statusText });
      });
    });
  });

  describe('listClasses()', () => {
    it('forwards zoneId filter', (done) => {
      service.listClasses({ zoneId: zoneFixture.id }).subscribe(() => done());
      const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/classes');
      expect(req.request.params.get('zoneId')).toBe(zoneFixture.id);
      req.flush({ data: [classFixture], meta: listMeta });
    });

    it('supports a no-filter list call', (done) => {
      service.listClasses().subscribe((res) => {
        expect(res.data).toHaveLength(1);
        done();
      });
      const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/classes');
      expect(req.request.params.get('zoneId')).toBeNull();
      req.flush({ data: [classFixture], meta: listMeta });
    });

    it('forwards page + pageSize alongside zoneId', (done) => {
      service.listClasses({ page: 3, pageSize: 5, zoneId: zoneFixture.id }).subscribe(() => done());
      const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/classes');
      expect(req.request.params.get('page')).toBe('3');
      expect(req.request.params.get('pageSize')).toBe('5');
      expect(req.request.params.get('zoneId')).toBe(zoneFixture.id);
      req.flush({ data: [], meta: { page: 3, pageSize: 5, total: 0 } });
    });

    it('parses an empty-result envelope', (done) => {
      service.listClasses().subscribe((res) => {
        expect(res.data).toHaveLength(0);
        expect(res.meta.total).toBe(0);
        done();
      });
      const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/classes');
      req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
    });

    it('rejects a class row whose rate falls outside the [0,1] fraction range', () => {
      return new Promise<void>((resolve, reject) => {
        service.listClasses().subscribe({
          next: () => reject(new Error('expected the malformed rate to reject')),
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          },
        });
        const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/classes');
        req.flush({ data: [{ ...classFixture, rate: '2.0' }], meta: listMeta });
      });
    });

    it.each([
      [400, 'Bad Request'],
      [403, 'Forbidden'],
    ] as const)('surfaces %i backend errors to the caller', (status, statusText) => {
      return new Promise<void>((resolve, reject) => {
        service.listClasses().subscribe({
          next: () => reject(new Error('expected the backend error to surface')),
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          },
        });
        const req = http.expectOne((r) => r.url === '/api/v1/admin/tax/classes');
        req.flush({ error: { code: 'ERR', message: statusText } }, { status, statusText });
      });
    });
  });

  describe('createClass()', () => {
    it('POSTs under the classes route and unwraps the envelope', (done) => {
      service
        .createClass({ zoneId: zoneFixture.id, name: 'Reduced', rate: 0.025 })
        .subscribe((c) => {
          expect(c.id).toBe(classFixture.id);
          done();
        });
      const req = http.expectOne('/api/v1/admin/tax/classes');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        zoneId: zoneFixture.id,
        name: 'Reduced',
        rate: 0.025,
      });
      req.flush({ data: classFixture });
    });

    it('rejects an empty name', () => {
      expect(() =>
        service.createClass({ zoneId: zoneFixture.id, name: '', rate: 0.19 }).subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/tax/classes');
    });

    it('rejects a malformed zoneId', () => {
      expect(() =>
        service.createClass({ zoneId: 'not valid!', name: 'Standard', rate: 0.19 }).subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/tax/classes');
    });

    it('rejects a rate greater than 1', () => {
      expect(() =>
        service.createClass({ zoneId: zoneFixture.id, name: 'Standard', rate: 1.5 }).subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/tax/classes');
    });

    it.each([
      [400, 'Bad Request'],
      [403, 'Forbidden'],
    ] as const)('surfaces %i backend errors to the caller', (status, statusText) => {
      return new Promise<void>((resolve, reject) => {
        service.createClass({ zoneId: zoneFixture.id, name: 'Standard', rate: 0.19 }).subscribe({
          next: () => reject(new Error('expected the backend error to surface')),
          error: (err) => {
            expect(err).toBeDefined();
            resolve();
          },
        });
        const req = http.expectOne('/api/v1/admin/tax/classes');
        req.flush({ error: { code: 'ERR', message: statusText } }, { status, statusText });
      });
    });
  });
});
