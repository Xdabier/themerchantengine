import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { GiftCardsService } from './gift-cards.service';

const giftCardFixture = {
  id: '74f5c9a4-1a1a-4a4a-8a8a-777777777777',
  code: 'GC-ABCDEFGH',
  initialBalance: 100,
  currentBalance: 100,
  currency: 'USD',
  isActive: true,
  createdAt: '2026-04-15T12:00:00.000Z',
};

describe('GiftCardsService', () => {
  let service: GiftCardsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        GiftCardsService,
      ],
    });
    service = TestBed.inject(GiftCardsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() forwards pagination + filters', (done) => {
    service.list({ page: 1, recipientEmail: 'a@b.com' }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/gift-cards');
    expect(req.request.params.get('recipientEmail')).toBe('a@b.com');
    req.flush({ data: [giftCardFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('issue() rejects non-ISO currency via Zod', () => {
    expect(() => service.issue({ initialBalance: 100, currency: 'usd' }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/gift-cards');
  });

  it('issue() rejects non-positive initial balance', () => {
    expect(() => service.issue({ initialBalance: 0, currency: 'USD' }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/gift-cards');
  });

  it('issue() POSTs a valid body', (done) => {
    service.issue({ initialBalance: 100, currency: 'USD', code: 'GIFT12345' }).subscribe((gc) => {
      expect(gc.code).toBe(giftCardFixture.code);
      done();
    });
    const req = http.expectOne('/api/v1/admin/gift-cards');
    expect(req.request.method).toBe('POST');
    req.flush({ data: giftCardFixture });
  });

  it('update() toggles isActive', (done) => {
    service.update(giftCardFixture.id, { isActive: false }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/gift-cards/${giftCardFixture.id}`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: { ...giftCardFixture, isActive: false } });
  });

  it('update() accepts an empty body', (done) => {
    service.update(giftCardFixture.id, {}).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/gift-cards/${giftCardFixture.id}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({});
    req.flush({ data: giftCardFixture });
  });

  it('update() strips unknown keys via Zod before PATCHing', (done) => {
    service
      .update(giftCardFixture.id, { isActive: false, amount: 999 } as unknown as {
        isActive?: boolean;
      })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/gift-cards/${giftCardFixture.id}`);
    expect(req.request.body).toEqual({ isActive: false });
    expect(req.request.body).not.toHaveProperty('amount');
    req.flush({ data: { ...giftCardFixture, isActive: false } });
  });

  it('update() propagates a 403 Forbidden response', (done) => {
    service.update(giftCardFixture.id, { isActive: false }).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/gift-cards/${giftCardFixture.id}`);
    req.flush(
      { error: { code: 'FORBIDDEN', message: 'nope' } },
      { status: 403, statusText: 'Forbidden' },
    );
  });

  it('update() propagates a 404 Not Found response', (done) => {
    service.update(giftCardFixture.id, { isActive: true }).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/gift-cards/${giftCardFixture.id}`);
    req.flush(
      { error: { code: 'NOT_FOUND', message: 'missing' } },
      { status: 404, statusText: 'Not Found' },
    );
  });

  it('adjustBalance() rejects zero amount via Zod', () => {
    expect(() =>
      service.adjustBalance(giftCardFixture.id, { amount: 0, reason: 'noop' }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/gift-cards/${giftCardFixture.id}/adjust`);
  });

  it('adjustBalance() rejects short reason via Zod', () => {
    expect(() =>
      service.adjustBalance(giftCardFixture.id, { amount: 5, reason: 'no' }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/gift-cards/${giftCardFixture.id}/adjust`);
  });

  it('adjustBalance() POSTs to the /:id/adjust route', (done) => {
    service
      .adjustBalance(giftCardFixture.id, { amount: -10, reason: 'Partial refund correction' })
      .subscribe((gc) => {
        expect(gc.id).toBe(giftCardFixture.id);
        done();
      });
    const req = http.expectOne(`/api/v1/admin/gift-cards/${giftCardFixture.id}/adjust`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ amount: -10, reason: 'Partial refund correction' });
    req.flush({ data: giftCardFixture });
  });

  it('resendEmail() POSTs an empty body and parses the status envelope', (done) => {
    service.resendEmail(giftCardFixture.id).subscribe((res) => {
      expect(res.status).toBe('queued');
      expect(res.recipientEmail).toBe('r@example.com');
      done();
    });
    const req = http.expectOne(`/api/v1/admin/gift-cards/${giftCardFixture.id}/resend`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ data: { status: 'queued', recipientEmail: 'r@example.com' } });
  });
});
