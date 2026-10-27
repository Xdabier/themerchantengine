import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { PromotionsService } from './promotions.service';

const promoFixture = {
  id: '64f5c9a4-1a1a-4a4a-8a8a-666666666666',
  name: { default: 'Spring Sale' },
  type: 'PERCENTAGE',
  applicationMethod: 'COUPON',
  value: 15,
  isActive: true,
};

describe('PromotionsService', () => {
  let service: PromotionsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        PromotionsService,
      ],
    });
    service = TestBed.inject(PromotionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() forwards type + applicationMethod + isActive filters', (done) => {
    service
      .list({ type: 'PERCENTAGE', applicationMethod: 'COUPON', isActive: true })
      .subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/promotions');
    expect(req.request.params.get('type')).toBe('PERCENTAGE');
    expect(req.request.params.get('applicationMethod')).toBe('COUPON');
    req.flush({ data: [promoFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('create() rejects unknown promotion types via Zod', () => {
    expect(() =>
      service
        .create({
          name: { default: 'X' },
          type: 'NOT_A_TYPE' as never,
          applicationMethod: 'COUPON',
          value: 10,
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/promotions');
  });

  it('create() POSTs a valid body', (done) => {
    service
      .create({
        name: { default: 'Flash 20' },
        type: 'PERCENTAGE',
        applicationMethod: 'COUPON',
        couponCode: 'FLASH20',
        value: 20,
      })
      .subscribe((p) => {
        expect(p.id).toBe(promoFixture.id);
        done();
      });
    const req = http.expectOne('/api/v1/admin/promotions');
    expect(req.request.method).toBe('POST');
    req.flush({ data: promoFixture });
  });

  it('deactivate() DELETEs', (done) => {
    service.deactivate(promoFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/promotions/${promoFixture.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('get() fetches a single promotion', (done) => {
    service.get(promoFixture.id).subscribe((p) => {
      expect(p.id).toBe(promoFixture.id);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/promotions/${promoFixture.id}`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: promoFixture });
  });

  describe('update()', () => {
    it('PATCHes the partial body to the id path', (done) => {
      service
        .update(promoFixture.id, { value: 25, couponCode: 'SPRING25', isActive: false })
        .subscribe((p) => {
          expect(p.id).toBe(promoFixture.id);
          done();
        });
      const req = http.expectOne(`/api/v1/admin/promotions/${promoFixture.id}`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body.value).toBe(25);
      expect(req.request.body.couponCode).toBe('SPRING25');
      expect(req.request.body.isActive).toBe(false);
      req.flush({ data: { ...promoFixture, value: 25, couponCode: 'SPRING25', isActive: false } });
    });

    it('accepts an empty partial body (updatePromotionRequestSchema is a partial)', (done) => {
      service.update(promoFixture.id, {}).subscribe(() => done());
      const req = http.expectOne(`/api/v1/admin/promotions/${promoFixture.id}`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({});
      req.flush({ data: promoFixture });
    });

    it('rejects an unknown type before the network', () => {
      expect(() =>
        service.update(promoFixture.id, { type: 'NOT_A_TYPE' as never }).subscribe(),
      ).toThrow();
      http.expectNone(`/api/v1/admin/promotions/${promoFixture.id}`);
    });

    it('rejects a negative value before the network', () => {
      expect(() => service.update(promoFixture.id, { value: -5 }).subscribe()).toThrow();
      http.expectNone(`/api/v1/admin/promotions/${promoFixture.id}`);
    });

    it('surfaces a backend 409 coupon-conflict to the observer', (done) => {
      service.update(promoFixture.id, { couponCode: 'DUP' }).subscribe({
        error: (err) => {
          expect(err.status).toBe(409);
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/promotions/${promoFixture.id}`)
        .flush(
          { error: { code: 'COUPON_IN_USE', message: 'duplicate' } },
          { status: 409, statusText: 'Conflict' },
        );
    });
  });

  it('deactivate() surfaces a backend 404 to the observer', (done) => {
    service.deactivate(promoFixture.id).subscribe({
      error: (err) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/promotions/${promoFixture.id}`)
      .flush({ error: { code: 'NOT_FOUND' } }, { status: 404, statusText: 'Not Found' });
  });

  it('get() surfaces a backend 403 to the observer', (done) => {
    service.get(promoFixture.id).subscribe({
      error: (err) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/promotions/${promoFixture.id}`)
      .flush({ error: { code: 'FORBIDDEN' } }, { status: 403, statusText: 'Forbidden' });
  });

  it('list() forwards pagination + isActive=false filter', (done) => {
    service.list({ page: 2, pageSize: 10, isActive: false }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/promotions');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    expect(req.request.params.get('isActive')).toBe('false');
    req.flush({ data: [], meta: { page: 2, pageSize: 10, total: 0 } });
  });

  it('list() surfaces a backend 403 to the observer', (done) => {
    service.list().subscribe({
      error: (err) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/promotions')
      .flush({ error: { code: 'FORBIDDEN' } }, { status: 403, statusText: 'Forbidden' });
  });
});
