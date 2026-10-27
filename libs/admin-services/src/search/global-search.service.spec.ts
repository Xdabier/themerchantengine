import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { GlobalSearchService } from './global-search.service';

const hitFixture = {
  groups: [
    {
      type: 'product',
      total: 1,
      items: [{ id: 'p1', title: 'Sneaker', subtitle: '/sneaker', url: '/products/p1' }],
    },
  ],
  query: 'sneak',
};

describe('GlobalSearchService', () => {
  let service: GlobalSearchService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        GlobalSearchService,
      ],
    });
    service = TestBed.inject(GlobalSearchService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('search() forwards q + types CSV + limit', (done) => {
    service.search({ q: 'sneak', types: ['product', 'order'], limit: 10 }).subscribe((res) => {
      expect(res.groups.length).toBe(1);
      expect(res.query).toBe('sneak');
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search');
    expect(req.request.params.get('q')).toBe('sneak');
    expect(req.request.params.get('types')).toBe('product,order');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({ data: hitFixture });
  });

  it('search() rejects queries under 2 chars via Zod', () => {
    expect(() => service.search({ q: 'a' }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/search');
  });

  it('search() omits types param when empty', (done) => {
    service.search({ q: 'ada' }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search');
    expect(req.request.params.has('types')).toBe(false);
    req.flush({ data: { groups: [], query: 'ada' } });
  });

  it('search() rejects limit below 1 via Zod', () => {
    expect(() => service.search({ q: 'ada', limit: 0 }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/search');
  });

  it('search() rejects limit above 20 via Zod', () => {
    expect(() => service.search({ q: 'ada', limit: 21 }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/search');
  });

  it('search() omits limit param when undefined', (done) => {
    service.search({ q: 'ada' }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search');
    expect(req.request.params.has('limit')).toBe(false);
    req.flush({ data: { groups: [], query: 'ada' } });
  });

  it('search() omits types param when explicitly empty array', (done) => {
    service.search({ q: 'ada', types: [] }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search');
    expect(req.request.params.has('types')).toBe(false);
    req.flush({ data: { groups: [], query: 'ada' } });
  });

  it('search() Zod-rejects an unknown type enum value', () => {
    expect(() => service.search({ q: 'ada', types: ['invoice' as never] }).subscribe()).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/search');
  });

  it('search() surfaces a 403 network error to the subscriber', (done) => {
    service.search({ q: 'ada' }).subscribe({
      next: () => done.fail('expected error'),
      error: (err: unknown) => {
        expect(err).toBeDefined();
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search');
    req.flush(
      { error: { code: 'FORBIDDEN', message: 'nope' } },
      { status: 403, statusText: 'Forbidden' },
    );
  });
});
