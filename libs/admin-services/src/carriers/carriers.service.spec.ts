import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ZodError } from 'zod';
import { ADMIN_API_BASE_URL } from '../shared';
import { CarriersService } from './carriers.service';

const fixture = {
  id: 'car-1',
  code: 'dhl_express',
  name: { default: 'DHL', en: 'DHL Express' },
  provider: 'dhl',
  services: ['express'],
  zones: ['QA', 'AE'],
  isActive: true,
  sortOrder: 0,
  config: { apiKey: '***' },
};

describe('CarriersService', () => {
  let service: CarriersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        CarriersService,
      ],
    });
    service = TestBed.inject(CarriersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('list', () => {
    it('forwards filters', (done) => {
      service.list({ provider: 'dhl', isActive: true }).subscribe(() => done());
      const req = http.expectOne((r) => r.url === '/api/v1/admin/carriers');
      expect(req.request.params.get('provider')).toBe('dhl');
      req.flush({ data: [fixture], meta: { page: 1, pageSize: 20, total: 1 } });
    });
  });

  describe('get', () => {
    it('fetches a single carrier', (done) => {
      service.get('car-1').subscribe((c) => {
        expect(c.id).toBe('car-1');
        done();
      });
      const req = http.expectOne('/api/v1/admin/carriers/car-1');
      req.flush({ data: fixture });
    });
  });

  describe('create', () => {
    it('rejects an uppercase code via Zod', () => {
      expect(() =>
        service.create({ code: 'DHL', name: { default: 'x' }, provider: 'dhl' }).subscribe(),
      ).toThrow(ZodError);
      http.expectNone('/api/v1/admin/carriers');
    });

    it('rejects a code shorter than 2 chars', () => {
      expect(() =>
        service.create({ code: 'd', name: { default: 'x' }, provider: 'dhl' }).subscribe(),
      ).toThrow(ZodError);
    });

    it('rejects a code longer than 50 chars', () => {
      expect(() =>
        service
          .create({ code: 'd'.repeat(51), name: { default: 'x' }, provider: 'dhl' })
          .subscribe(),
      ).toThrow(ZodError);
    });

    it('rejects a code with hyphens', () => {
      expect(() =>
        service
          .create({ code: 'dhl-express', name: { default: 'x' }, provider: 'dhl' })
          .subscribe(),
      ).toThrow(ZodError);
    });

    it('rejects an unknown provider', () => {
      expect(() =>
        service
          .create({
            code: 'tele',
            name: { default: 'x' },
            provider: 'teleport' as never,
          })
          .subscribe(),
      ).toThrow(ZodError);
    });

    it('rejects a lowercase zone code', () => {
      expect(() =>
        service
          .create({
            code: 'dhl_x',
            name: { default: 'x' },
            provider: 'dhl',
            zones: ['qa'] as never,
          })
          .subscribe(),
      ).toThrow(ZodError);
    });

    it('POSTs a valid body and parses the envelope', (done) => {
      service
        .create({
          code: 'dhl_express',
          name: { default: 'DHL Express' },
          provider: 'dhl',
          zones: ['QA'],
        })
        .subscribe((c) => {
          expect(c.id).toBe('car-1');
          done();
        });
      const req = http.expectOne('/api/v1/admin/carriers');
      expect(req.request.method).toBe('POST');
      req.flush({ data: fixture });
    });

    it('surfaces a backend 409 to the observer', (done) => {
      service.create({ code: 'dhl_express', name: { default: 'x' }, provider: 'dhl' }).subscribe({
        error: (err) => {
          expect(err.status).toBe(409);
          done();
        },
      });
      http
        .expectOne('/api/v1/admin/carriers')
        .flush({ error: { code: 'CARRIER_CODE_IN_USE' } }, { status: 409, statusText: 'Conflict' });
    });
  });

  describe('update', () => {
    it('rejects non-ISO zones via Zod', () => {
      expect(() => service.update('car-1', { zones: ['france'] as never }).subscribe()).toThrow(
        ZodError,
      );
    });
  });

  describe('delete', () => {
    it('hits DELETE', (done) => {
      service.delete('car-1').subscribe(() => done());
      const req = http.expectOne('/api/v1/admin/carriers/car-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});
