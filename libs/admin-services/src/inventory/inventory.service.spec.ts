import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { InventoryService } from './inventory.service';

const VARIANT = '04f5c9a4-1a1a-4a4a-8a8a-000000000000';
const LOCATION_A = 'a4f5c9a4-1a1a-4a4a-8a8a-ee0000000002';
const LOCATION_B = 'a4f5c9a4-1a1a-4a4a-8a8a-ee0000000003';

const stockFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-ee0000000001',
  variantId: VARIANT,
  locationId: LOCATION_A,
  onHand: 42,
  reserved: 0,
  available: 42,
  updatedAt: '2026-04-19T10:00:00.000Z',
  location: { id: LOCATION_A, name: 'Lyon Warehouse', code: 'LYON-01', isActive: true },
  variant: { id: VARIANT, sku: 'SKU-1', productId: '04f5c9a4-1a1a-4a4a-8a8a-000000000001' },
};

const locationFixture = {
  id: LOCATION_A,
  name: 'Lyon Warehouse',
  code: 'LYON-01',
  isActive: true,
};

const movementFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-ee0000000009',
  variantId: VARIANT,
  locationId: LOCATION_A,
  type: 'ADJUSTMENT',
  quantity: 3,
  reason: 'RECOUNT',
  notes: null,
  createdAt: '2026-04-19T10:00:00.000Z',
};

const alertFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-ee0000000011',
  variantId: VARIANT,
  locationId: LOCATION_A,
  onHand: 2,
  reserved: 0,
  lowStockThreshold: 10,
  alertType: 'LOW_STOCK',
  variant: { id: VARIANT, sku: 'SKU-1' },
  location: { id: LOCATION_A, name: 'Lyon Warehouse', code: 'LYON-01' },
};

describe('InventoryService', () => {
  let service: InventoryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        InventoryService,
      ],
    });
    service = TestBed.inject(InventoryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listStockLevels() filters by stockStatus', (done) => {
    service.listStockLevels({ stockStatus: 'LOW_STOCK' }).subscribe((res) => {
      expect(res.data).toHaveLength(1);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/inventory');
    expect(req.request.params.get('stockStatus')).toBe('LOW_STOCK');
    req.flush({ data: [stockFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listStockLevels() surfaces 403', (done) => {
    service.listStockLevels().subscribe({
      next: () => done(new Error('should not succeed')),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/inventory');
    req.flush(null, { status: 403, statusText: 'Forbidden' });
  });

  it('getVariantStock() parses the per-location breakdown', (done) => {
    service.getVariantStock(VARIANT).subscribe((detail) => {
      expect(detail.levels).toHaveLength(1);
      expect(detail.levels[0].location.name).toBe('Lyon Warehouse');
      expect(detail.variant?.product?.id).toBe('prod-1');
      done();
    });
    const req = http.expectOne(`/api/v1/admin/inventory/variant/${VARIANT}`);
    expect(req.request.method).toBe('GET');
    req.flush({
      data: {
        variant: {
          id: VARIANT,
          sku: 'SKU-1',
          product: { id: 'prod-1', name: { default: 'Brosse' } },
        },
        levels: [stockFixture],
      },
    });
  });

  /**
   * The shape change that motivated the envelope: a variant with no rows still
   * has to carry the product, or the screen has nothing to link to.
   */
  it('getVariantStock() keeps the product when there are no stock rows', (done) => {
    service.getVariantStock(VARIANT).subscribe((detail) => {
      expect(detail.levels).toEqual([]);
      expect(detail.variant?.product?.id).toBe('prod-1');
      done();
    });
    http.expectOne(`/api/v1/admin/inventory/variant/${VARIANT}`).flush({
      data: {
        variant: {
          id: VARIANT,
          sku: 'SKU-1',
          product: { id: 'prod-1', name: { default: 'Brosse' } },
        },
        levels: [],
      },
    });
  });

  it('getVariantStock() surfaces 404', (done) => {
    service.getVariantStock(VARIANT).subscribe({
      next: () => done(new Error('should not succeed')),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/inventory/variant/${VARIANT}`);
    req.flush(
      { error: { code: 'NOT_FOUND', message: 'Variant not found' } },
      { status: 404, statusText: 'Not Found' },
    );
  });

  it('adjustInventory() PATCHes with a narrowed AdjustmentReason', (done) => {
    service
      .adjustInventory({
        variantId: VARIANT,
        locationId: LOCATION_A,
        quantity: -5,
        reason: 'DAMAGE',
      })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/inventory/adjust');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.reason).toBe('DAMAGE');
    req.flush({ data: null });
  });

  it('adjustInventory() sends the X-Idempotency-Key the endpoint requires', (done) => {
    service
      .adjustInventory({
        variantId: VARIANT,
        locationId: LOCATION_A,
        quantity: 1,
        reason: 'RECOUNT',
      })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/inventory/adjust');
    // Without it the endpoint 400s and the Adjust dialog can never submit.
    expect(req.request.headers.get('X-Idempotency-Key')).toMatch(/[0-9a-f-]{36}/i);
    req.flush({ data: null });
  });

  it('adjustInventory() mints a fresh key per call', () => {
    const keys: string[] = [];
    for (let i = 0; i < 2; i++) {
      service
        .adjustInventory({
          variantId: VARIANT,
          locationId: LOCATION_A,
          quantity: 1,
          reason: 'RECOUNT',
        })
        .subscribe();
      const req = http.expectOne('/api/v1/admin/inventory/adjust');
      keys.push(req.request.headers.get('X-Idempotency-Key') ?? '');
      req.flush({ data: null });
    }
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('adjustInventory() rejects an unknown reason at the schema layer', () => {
    expect(() =>
      service
        .adjustInventory({
          variantId: VARIANT,
          locationId: LOCATION_A,
          quantity: -1,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          reason: 'damaged' as any,
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/inventory/adjust');
  });

  it('adjustInventory() surfaces 400 when the backend refuses the delta', (done) => {
    service
      .adjustInventory({
        variantId: VARIANT,
        locationId: LOCATION_A,
        quantity: -500,
        reason: 'DAMAGE',
      })
      .subscribe({
        next: () => done(new Error('should not succeed')),
        error: (err: HttpErrorResponse) => {
          expect(err.status).toBe(400);
          done();
        },
      });
    const req = http.expectOne('/api/v1/admin/inventory/adjust');
    req.flush(
      { error: { code: 'BAD_REQUEST', message: 'Adjustment would drive onHand below zero' } },
      { status: 400, statusText: 'Bad Request' },
    );
  });

  it('transferInventory() POSTs a valid payload', (done) => {
    service
      .transferInventory({
        variantId: VARIANT,
        fromLocationId: LOCATION_A,
        toLocationId: LOCATION_B,
        quantity: 3,
      })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/inventory/transfer');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Idempotency-Key')).toMatch(/[0-9a-f-]{36}/i);
    req.flush({ data: null });
  });

  it('transferInventory() rejects zero quantity at the schema layer', () => {
    expect(() =>
      service
        .transferInventory({
          variantId: VARIANT,
          fromLocationId: LOCATION_A,
          toLocationId: LOCATION_B,
          quantity: 0,
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/inventory/transfer');
  });

  it('transferInventory() surfaces 400 when source stock is insufficient', (done) => {
    service
      .transferInventory({
        variantId: VARIANT,
        fromLocationId: LOCATION_A,
        toLocationId: LOCATION_B,
        quantity: 999999,
      })
      .subscribe({
        next: () => done(new Error('should not succeed')),
        error: (err: HttpErrorResponse) => {
          expect(err.status).toBe(400);
          done();
        },
      });
    const req = http.expectOne('/api/v1/admin/inventory/transfer');
    req.flush(
      { error: { code: 'BAD_REQUEST', message: 'Insufficient available stock' } },
      { status: 400, statusText: 'Bad Request' },
    );
  });

  it('listAlerts() parses alertType-tagged rows', (done) => {
    service.listAlerts({ page: 1, pageSize: 5 }).subscribe((res) => {
      expect(res.data[0].alertType).toBe('LOW_STOCK');
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/inventory/alerts');
    expect(req.request.params.get('pageSize')).toBe('5');
    req.flush({ data: [alertFixture], meta: { page: 1, pageSize: 5, total: 1 } });
  });

  it('listAlerts() returns an empty list when the seed holds no alerts', (done) => {
    service.listAlerts().subscribe((res) => {
      expect(res.data).toHaveLength(0);
      expect(res.meta.total).toBe(0);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/inventory/alerts');
    req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it('listMovements() narrows MovementType at the query layer', (done) => {
    service.listMovements({ type: 'ADJUSTMENT' }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/inventory/movements');
    expect(req.request.params.get('type')).toBe('ADJUSTMENT');
    req.flush({ data: [movementFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listMovements() rejects an unknown MovementType', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      service.listMovements({ type: 'UNKNOWN' as any }).subscribe(),
    ).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/inventory/movements');
  });

  it('listLocations() GETs with pagination defaults', (done) => {
    service.listLocations().subscribe((res) => {
      expect(res.data).toHaveLength(1);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/inventory/locations');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [locationFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('createLocation() validates the code regex', () => {
    expect(() => service.createLocation({ name: 'X', code: 'bad code!' }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/inventory/locations');
  });

  it('createLocation() POSTs a valid body', (done) => {
    service.createLocation({ name: 'Lyon Warehouse', code: 'LYON-01' }).subscribe((loc) => {
      expect(loc.code).toBe('LYON-01');
      done();
    });
    const req = http.expectOne('/api/v1/admin/inventory/locations');
    expect(req.request.method).toBe('POST');
    req.flush({ data: locationFixture });
  });

  it('createLocation() surfaces 409 when the code is already in use', (done) => {
    service.createLocation({ name: 'Duplicate', code: 'LYON-01' }).subscribe({
      next: () => done(new Error('should not succeed')),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(409);
        done();
      },
    });
    const req = http.expectOne('/api/v1/admin/inventory/locations');
    req.flush(
      { error: { code: 'CONFLICT', message: 'Location code already exists' } },
      { status: 409, statusText: 'Conflict' },
    );
  });

  it('updateLocation() PATCHes a partial body', (done) => {
    service.updateLocation(LOCATION_A, { isActive: false }).subscribe((loc) => {
      expect(loc.id).toBe(LOCATION_A);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/inventory/locations/${LOCATION_A}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ isActive: false });
    req.flush({ data: { ...locationFixture, isActive: false } });
  });

  it('deleteLocation() DELETEs', (done) => {
    service.deleteLocation(locationFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/inventory/locations/${locationFixture.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('deleteLocation() surfaces 409 when stock is still present', (done) => {
    service.deleteLocation(LOCATION_A).subscribe({
      next: () => done(new Error('should not succeed')),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(400);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/inventory/locations/${LOCATION_A}`);
    req.flush(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'Cannot delete a location that holds stock',
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
  });

  describe('adjust modes', () => {
    it('sends a set-to body with its expected value', (done) => {
      service
        .adjustInventory({
          variantId: VARIANT,
          locationId: LOCATION_A,
          setTo: 25,
          expectedOnHand: 20,
          reason: 'RECOUNT',
        })
        .subscribe(() => done());
      const req = http.expectOne('/api/v1/admin/inventory/adjust');
      expect(req.request.body).toMatchObject({ setTo: 25, expectedOnHand: 20 });
      expect(req.request.body.quantity).toBeUndefined();
      req.flush({ data: null });
    });

    /**
     * Mirrors the server rule rather than trusting it, so an impossible body
     * never leaves the browser. The parse throws synchronously.
     */
    it('refuses a body carrying both modes', () => {
      expect(() =>
        service
          .adjustInventory({
            variantId: VARIANT,
            locationId: LOCATION_A,
            quantity: 5,
            setTo: 25,
            expectedOnHand: 20,
            reason: 'RECOUNT',
          })
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/inventory/adjust');
    });

    it('refuses a body carrying neither mode', () => {
      expect(() =>
        service
          .adjustInventory({
            variantId: VARIANT,
            locationId: LOCATION_A,
            reason: 'RECOUNT',
          } as never)
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/inventory/adjust');
    });

    it('refuses set-to without the expected value, which would be a blind write', () => {
      expect(() =>
        service
          .adjustInventory({
            variantId: VARIANT,
            locationId: LOCATION_A,
            setTo: 25,
            reason: 'RECOUNT',
          })
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/inventory/adjust');
    });

    /**
     * The double-apply defect. A fresh key per call means two clicks are two
     * distinct requests to the server, so both apply; reusing one key across
     * retries of the same intent is the only thing that makes a retry a replay.
     */
    it('reuses a caller-supplied idempotency key across retries of one intent', (done) => {
      const key = 'intent-key-1';
      service
        .adjustInventory(
          {
            variantId: VARIANT,
            locationId: LOCATION_A,
            setTo: 25,
            expectedOnHand: 20,
            reason: 'RECOUNT',
          },
          key,
        )
        .subscribe(() => {
          service
            .adjustInventory(
              {
                variantId: VARIANT,
                locationId: LOCATION_A,
                setTo: 25,
                expectedOnHand: 20,
                reason: 'RECOUNT',
              },
              key,
            )
            .subscribe(() => done());
          const second = http.expectOne('/api/v1/admin/inventory/adjust');
          expect(second.request.headers.get('X-Idempotency-Key')).toBe(key);
          second.flush({ data: null });
        });
      const first = http.expectOne('/api/v1/admin/inventory/adjust');
      expect(first.request.headers.get('X-Idempotency-Key')).toBe(key);
      first.flush({ data: null });
    });
  });
});
