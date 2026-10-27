import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ZodError } from 'zod';
import { ADMIN_API_BASE_URL } from '../shared';
import { ShippingService } from './shipping.service';

const now = new Date().toISOString();

const zoneFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-aa0000000001',
  name: { default: 'GCC' },
  countries: ['QA', 'SA', 'AE'],
  states: [],
  priority: 0,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

const methodFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-aa0000000002',
  zoneId: zoneFixture.id,
  name: { default: 'Standard' },
  type: 'FLAT_RATE',
  price: 15,
  weightRanges: null,
  priceRanges: null,
  isActive: true,
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
};

describe('ShippingService', () => {
  let service: ShippingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        ShippingService,
      ],
    });
    service = TestBed.inject(ShippingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('listZones', () => {
    it('is paginated', (done) => {
      service.listZones({ page: 1 }).subscribe(() => done());
      http
        .expectOne((r) => r.url === '/api/v1/admin/shipping/zones')
        .flush({ data: [zoneFixture], meta: { page: 1, pageSize: 20, total: 1 } });
    });

    it('rejects pageSize > 100 before the network', () => {
      expect(() => service.listZones({ pageSize: 101 }).subscribe()).toThrow(ZodError);
      http.expectNone('/api/v1/admin/shipping/zones');
    });

    it('errors the observer when the response is missing meta', (done) => {
      service.listZones().subscribe({
        error: (err) => {
          expect(err).toBeInstanceOf(ZodError);
          done();
        },
      });
      http.expectOne('/api/v1/admin/shipping/zones').flush({ data: [zoneFixture] });
    });
  });

  describe('createZone', () => {
    it('rejects non-ISO 3166 country codes', () => {
      expect(() =>
        service.createZone({ name: { default: 'X' }, countries: ['qa'] as never }).subscribe(),
      ).toThrow(ZodError);
      http.expectNone('/api/v1/admin/shipping/zones');
    });

    it('rejects an empty countries array', () => {
      expect(() =>
        service.createZone({ name: { default: 'X' }, countries: [] as never }).subscribe(),
      ).toThrow(ZodError);
      http.expectNone('/api/v1/admin/shipping/zones');
    });

    it('rejects negative priority', () => {
      expect(() =>
        service
          .createZone({
            name: { default: 'X' },
            countries: ['QA'],
            priority: -1,
          })
          .subscribe(),
      ).toThrow(ZodError);
      http.expectNone('/api/v1/admin/shipping/zones');
    });

    it('POSTs a valid body', (done) => {
      service.createZone({ name: { default: 'GCC' }, countries: ['QA', 'SA'] }).subscribe((z) => {
        expect(z.id).toBe(zoneFixture.id);
        done();
      });
      const req = http.expectOne('/api/v1/admin/shipping/zones');
      expect(req.request.method).toBe('POST');
      req.flush({ data: zoneFixture });
    });
  });

  describe('updateZone', () => {
    it('PATCHes a single field and parses the response', (done) => {
      service.updateZone(zoneFixture.id, { isActive: false }).subscribe((z) => {
        expect(z.isActive).toBe(false);
        done();
      });
      const req = http.expectOne(`/api/v1/admin/shipping/zones/${zoneFixture.id}`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ isActive: false });
      req.flush({ data: { ...zoneFixture, isActive: false } });
    });

    it('errors the observer when a malformed zone comes back', (done) => {
      service.updateZone(zoneFixture.id, { priority: 5 }).subscribe({
        error: (err) => {
          expect(err).toBeInstanceOf(ZodError);
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/shipping/zones/${zoneFixture.id}`)
        .flush({ data: { id: 'x', name: { default: 'X' } } });
    });
  });

  describe('listMethods', () => {
    it('forwards zoneId filter', (done) => {
      service.listMethods({ zoneId: zoneFixture.id }).subscribe(() => done());
      const req = http.expectOne((r) => r.url === '/api/v1/admin/shipping/methods');
      expect(req.request.params.get('zoneId')).toBe(zoneFixture.id);
      req.flush({ data: [methodFixture], meta: { page: 1, pageSize: 20, total: 1 } });
    });

    it('forwards sortOrder + page together', (done) => {
      service.listMethods({ page: 2, sortOrder: 'desc' }).subscribe(() => done());
      const req = http.expectOne((r) => r.url === '/api/v1/admin/shipping/methods');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('sortOrder')).toBe('desc');
      req.flush({ data: [], meta: { page: 2, pageSize: 20, total: 0 } });
    });

    it('rejects sortOrder outside asc|desc', () => {
      expect(() => service.listMethods({ sortOrder: 'nope' as never }).subscribe()).toThrow(
        ZodError,
      );
      http.expectNone((r) => r.url === '/api/v1/admin/shipping/methods');
    });
  });

  describe('createMethod', () => {
    it('validates method type enum', () => {
      expect(() =>
        service
          .createMethod({
            zoneId: zoneFixture.id,
            name: { default: 'Bad' },
            type: 'TELEPORT' as never,
          })
          .subscribe(),
      ).toThrow(ZodError);
      http.expectNone('/api/v1/admin/shipping/methods');
    });

    it('rejects a negative price', () => {
      expect(() =>
        service
          .createMethod({
            zoneId: zoneFixture.id,
            name: { default: 'X' },
            type: 'FLAT_RATE',
            price: -1,
          })
          .subscribe(),
      ).toThrow(ZodError);
      http.expectNone('/api/v1/admin/shipping/methods');
    });

    it('rejects negative estimatedDaysMin', () => {
      expect(() =>
        service
          .createMethod({
            zoneId: zoneFixture.id,
            name: { default: 'X' },
            type: 'FLAT_RATE',
            price: 5,
            estimatedDaysMin: -1,
          })
          .subscribe(),
      ).toThrow(ZodError);
    });

    const typeCases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['FLAT_RATE', { price: 20 }],
      ['WEIGHT_BASED', { weightRanges: [{ minKg: 0, maxKg: 5, price: 10 }] }],
      ['PRICE_BASED', { priceRanges: [{ minAmount: 0, maxAmount: 100, price: 5 }] }],
      ['FREE', {}],
      ['CARRIER_CALCULATED', {}],
    ];
    for (const [type, extra] of typeCases) {
      it(`POSTs a valid ${type} body`, (done) => {
        service
          .createMethod({
            zoneId: zoneFixture.id,
            name: { default: type },
            type: type as never,
            ...extra,
          } as never)
          .subscribe((m) => {
            expect(m.id).toBe(methodFixture.id);
            done();
          });
        const req = http.expectOne('/api/v1/admin/shipping/methods');
        expect(req.request.method).toBe('POST');
        req.flush({ data: { ...methodFixture, type } });
      });
    }
  });

  describe('updateMethod', () => {
    it('PATCHes a single field and parses the response', (done) => {
      service.updateMethod(methodFixture.id, { isActive: false }).subscribe((m) => {
        expect(m.isActive).toBe(false);
        done();
      });
      const req = http.expectOne(`/api/v1/admin/shipping/methods/${methodFixture.id}`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ isActive: false });
      req.flush({ data: { ...methodFixture, isActive: false } });
    });
  });

  describe('deleteMethod', () => {
    it('DELETEs', (done) => {
      service.deleteMethod(methodFixture.id).subscribe(() => done());
      const req = http.expectOne(`/api/v1/admin/shipping/methods/${methodFixture.id}`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('surfaces a backend 404 to the observer', (done) => {
      service.deleteMethod(methodFixture.id).subscribe({
        error: (err) => {
          expect(err.status).toBe(404);
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/shipping/methods/${methodFixture.id}`)
        .flush({ error: { code: 'SHIPPING_METHOD_NOT_FOUND' } }, { status: 404, statusText: 'NF' });
    });
  });
});
