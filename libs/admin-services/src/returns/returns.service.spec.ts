import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { ReturnsService } from './returns.service';

const returnFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-cc0000000001',
  returnNumber: 'RET-2026-0001',
  orderId: '34f5c9a4-1a1a-4a4a-8a8a-333333333333',
  customerId: 'c4f5c9a4-1a1a-4a4a-8a8a-cccccccccccc',
  status: 'REQUESTED',
  reason: 'WRONG_SIZE',
  createdAt: '2026-04-15T12:00:00.000Z',
};

const detailFixture = {
  ...returnFixture,
  adminNotes: null,
  items: [
    {
      id: 'a4f5c9a4-1a1a-4a4a-8a8a-cc0000000099',
      orderItemId: 'a4f5c9a4-1a1a-4a4a-8a8a-cc0000000088',
      quantity: 1,
      restockDecision: 'RESTOCK',
    },
  ],
  photos: [],
};

const analyticsFixture = {
  totalReturns: 3,
  totalOrders: 12,
  returnRate: 25,
  byStatus: [{ status: 'REQUESTED', count: 2 }],
  byReason: [{ reason: 'WRONG_SIZE', count: 1 }],
  refundsByMethod: [{ method: 'ORIGINAL_PAYMENT', count: 1 }],
  topReturnedVariants: [
    { variantId: 'v4f5c9a4-1a1a-4a4a-8a8a-v00000000001', totalQuantityReturned: 2 },
  ],
};

describe('ReturnsService', () => {
  let service: ReturnsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        ReturnsService,
      ],
    });
    service = TestBed.inject(ReturnsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ── list() ────────────────────────────────────────────────────────────────

  it('list() applies status filter', (done) => {
    service.list({ status: 'APPROVED' }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/returns');
    expect(req.request.params.get('status')).toBe('APPROVED');
    req.flush({ data: [returnFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('list() issues a plain GET when no filters are passed', (done) => {
    service.list().subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/returns');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().length).toBe(0);
    req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  // ── get() ─────────────────────────────────────────────────────────────────

  it('get() fetches detail at /:id and parses the envelope', (done) => {
    service.get(returnFixture.id).subscribe((res) => {
      expect(res.id).toBe(returnFixture.id);
      expect(res.items?.[0]?.restockDecision).toBe('RESTOCK');
      done();
    });
    const req = http.expectOne(`/api/v1/admin/returns/${returnFixture.id}`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: detailFixture });
  });

  // ── analytics() ───────────────────────────────────────────────────────────

  it('analytics() parses typed response', (done) => {
    service.analytics().subscribe((res) => {
      expect(res.totalReturns).toBe(3);
      expect(res.byStatus[0].status).toBe('REQUESTED');
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/returns/analytics');
    expect(req.request.method).toBe('GET');
    req.flush({ data: analyticsFixture });
  });

  it('analytics() propagates a 500 HTTP error', (done) => {
    service.analytics().subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(500);
        done();
      },
    });
    http
      .expectOne((r) => r.url === '/api/v1/admin/returns/analytics')
      .flush({}, { status: 500, statusText: 'Internal Server Error' });
  });

  // ── get() error path ──────────────────────────────────────────────────────

  it('get() propagates a 404 HTTP error', (done) => {
    service.get(returnFixture.id).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/returns/${returnFixture.id}`)
      .flush({}, { status: 404, statusText: 'Not Found' });
  });

  // ── approve() / close() ───────────────────────────────────────────────────

  it('approve() PATCHes the action route', (done) => {
    service.approve(returnFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/returns/${returnFixture.id}/approve`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: returnFixture });
  });

  it('approve() propagates a 409 conflict (forbidden transition)', (done) => {
    service.approve(returnFixture.id).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(409);
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/returns/${returnFixture.id}/approve`)
      .flush({}, { status: 409, statusText: 'Conflict' });
  });

  it('close() PATCHes /close', (done) => {
    service.close(returnFixture.id).subscribe(() => done());
    http
      .expectOne(`/api/v1/admin/returns/${returnFixture.id}/close`)
      .flush({ data: returnFixture });
  });

  it('close() propagates a 409 conflict when the return is already closed', (done) => {
    service.close(returnFixture.id).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(409);
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/returns/${returnFixture.id}/close`)
      .flush({}, { status: 409, statusText: 'Conflict' });
  });

  // ── reject() ──────────────────────────────────────────────────────────────

  it('reject() requires a reason via Zod', () => {
    expect(() => service.reject(returnFixture.id, { reason: '' }).subscribe()).toThrow();
    http.expectNone(`/api/v1/admin/returns/${returnFixture.id}/reject`);
  });

  it('reject() happy path PATCHes with the reason body', (done) => {
    service
      .reject(returnFixture.id, { reason: 'Item outside return window.' })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/returns/${returnFixture.id}/reject`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ reason: 'Item outside return window.' });
    req.flush({ data: { ...returnFixture, status: 'REJECTED' } });
  });

  // ── receive() ─────────────────────────────────────────────────────────────

  it('receive() rejects empty item array', () => {
    expect(() => service.receive(returnFixture.id, { items: [] as never }).subscribe()).toThrow();
    http.expectNone(`/api/v1/admin/returns/${returnFixture.id}/receive`);
  });

  it('receive() rejects legacy DISCARD enum (Prisma uses DISPOSE)', () => {
    expect(() =>
      service
        .receive(returnFixture.id, {
          items: [
            {
              returnItemId: 'a4f5c9a4-1a1a-4a4a-8a8a-cc0000000002',
              // cast past the type guard to exercise the Zod boundary
              restockDecision: 'DISCARD' as never,
            },
          ],
        })
        .subscribe(),
    ).toThrow();
  });

  it('receive() accepts DISPOSE restock decision', (done) => {
    service
      .receive(returnFixture.id, {
        items: [
          {
            returnItemId: 'a4f5c9a4-1a1a-4a4a-8a8a-cc0000000002',
            restockDecision: 'DISPOSE',
          },
        ],
      })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/returns/${returnFixture.id}/receive`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: returnFixture });
  });

  it('receive() accepts DAMAGED restock decision', (done) => {
    service
      .receive(returnFixture.id, {
        items: [
          {
            returnItemId: 'a4f5c9a4-1a1a-4a4a-8a8a-cc0000000002',
            restockDecision: 'DAMAGED',
            notes: 'Seam split along toe box.',
          },
        ],
      })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/returns/${returnFixture.id}/receive`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: returnFixture });
  });

  // ── refund() ──────────────────────────────────────────────────────────────

  it('refund() forwards STORE_CREDIT refundMethod', (done) => {
    service.refund(returnFixture.id, { refundMethod: 'STORE_CREDIT' }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/returns/${returnFixture.id}/refund`);
    expect(req.request.method).toBe('PATCH');
    // The endpoint requires it; without the header every refund 400s.
    expect(req.request.headers.get('X-Idempotency-Key')).toMatch(/[0-9a-f-]{36}/i);
    req.flush({ data: returnFixture });
  });

  it('refund() forwards EXCHANGE refundMethod', (done) => {
    service.refund(returnFixture.id, { refundMethod: 'EXCHANGE' }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/returns/${returnFixture.id}/refund`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ refundMethod: 'EXCHANGE' });
    req.flush({ data: returnFixture });
  });

  it('refund() rejects unknown refundMethod via Zod', () => {
    expect(() =>
      service.refund(returnFixture.id, { refundMethod: 'PAYPAL' as never }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/returns/${returnFixture.id}/refund`);
  });
});
