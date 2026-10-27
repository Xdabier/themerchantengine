import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { SearchAdminService } from './search.service';

const synonymFixture = {
  id: '84f5c9a4-1a1a-4a4a-8a8a-888888888888',
  terms: ['shoe', 'sneaker', 'trainer'],
  isActive: true,
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z',
};

const ruleFixture = {
  id: '94f5c9a4-1a1a-4a4a-8a8a-999999999999',
  type: 'PIN' as const,
  query: 'shoe',
  productId: 'd4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd',
  position: 1,
  priority: 10,
  config: null,
  isActive: true,
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z',
};

const analyticsFixture = {
  topQueries: [
    { query: 'shoe', count: 42, avgResults: 12 },
    { query: 'jacket', count: 7, avgResults: 3 },
  ],
  zeroResultQueries: [{ query: 'xxyyzz', count: 4 }],
  conversionRate: 5.23,
  totalSearches: 120,
  period: 7,
};

describe('SearchAdminService', () => {
  let service: SearchAdminService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        SearchAdminService,
      ],
    });
    service = TestBed.inject(SearchAdminService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /* ── analytics() ─────────────────────────── */

  it('analytics() forwards period param and parses typed response', (done) => {
    service.analytics({ period: 7 }).subscribe((res) => {
      expect(res.topQueries).toHaveLength(2);
      expect(res.conversionRate).toBe(5.23);
      expect(res.period).toBe(7);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/analytics');
    expect(req.request.params.get('period')).toBe('7');
    req.flush({ data: analyticsFixture });
  });

  it('analytics() rejects a period outside VALID_ANALYTICS_PERIODS before the network', () => {
    expect(() => service.analytics({ period: 14 as 7 }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/search/analytics');
  });

  it('analytics() throws a ZodError when the response omits conversionRate', (done) => {
    service.analytics({ period: 30 }).subscribe({
      next: () => fail('expected error'),
      error: (err) => {
        expect(err.name).toBe('ZodError');
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/analytics');
    req.flush({
      data: {
        topQueries: [],
        zeroResultQueries: [],
        totalSearches: 0,
        period: 30,
      },
    });
  });

  it('analytics() rejects pageSize > 100 before the network', () => {
    expect(() => service.analytics({ pageSize: 200 }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/search/analytics');
  });

  /* ── zeroResults() ───────────────────────── */

  it('zeroResults() forwards period + page + pageSize params on the same request', (done) => {
    service.zeroResults({ period: 7, page: 2, pageSize: 5 }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/zero-results');
    expect(req.request.params.get('period')).toBe('7');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('5');
    req.flush({
      data: [{ query: 'xxyyzz', count: 4 }],
      meta: { page: 2, pageSize: 5, total: 4, period: 7 },
    });
  });

  it('zeroResults() parses the typed listZeroResultsResponseSchema shape', (done) => {
    service.zeroResults({ period: 30 }).subscribe((res) => {
      expect(res.data).toHaveLength(2);
      expect(res.meta.period).toBe(30);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/zero-results');
    req.flush({
      data: [
        { query: 'widget', count: 10 },
        { query: 'gadget', count: 2 },
      ],
      meta: { page: 1, pageSize: 20, total: 2, period: 30 },
    });
  });

  it('zeroResults() throws a ZodError when a row in data is malformed', (done) => {
    service.zeroResults({ period: 30 }).subscribe({
      next: () => fail('expected error'),
      error: (err) => {
        expect(err.name).toBe('ZodError');
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/zero-results');
    req.flush({
      data: [{ count: 5 }],
      meta: { page: 1, pageSize: 20, total: 1, period: 30 },
    });
  });

  /* ── reindex() ───────────────────────────── */

  it('reindex() POSTs an empty body and parses the envelope', (done) => {
    service.reindex().subscribe((res) => {
      expect(res.message).toBe('Reindex triggered');
      expect(res.reindexed).toBe(42);
      done();
    });
    const req = http.expectOne('/api/v1/admin/search/reindex');
    expect(req.request.method).toBe('POST');
    req.flush({ data: { message: 'Reindex triggered', reindexed: 42 } });
  });

  it('reindex() surfaces a backend 500 to the observer error callback', (done) => {
    service.reindex().subscribe({
      next: () => fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(500);
        done();
      },
    });
    const req = http.expectOne('/api/v1/admin/search/reindex');
    req.flush(
      { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } },
      {
        status: 500,
        statusText: 'Internal Server Error',
      },
    );
  });

  /* ── listSynonyms() ──────────────────────── */

  it('listSynonyms() is paginated and forwards both params', (done) => {
    service.listSynonyms({ page: 1, pageSize: 20 }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/synonyms');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush({ data: [synonymFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listSynonyms() rejects pageSize > 100 before the network', () => {
    expect(() => service.listSynonyms({ pageSize: 150 }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/search/synonyms');
  });

  it('listSynonyms() throws a ZodError when data[0].terms has fewer than two entries', (done) => {
    service.listSynonyms({}).subscribe({
      next: () => fail('expected error'),
      error: (err) => {
        expect(err.name).toBe('ZodError');
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/synonyms');
    req.flush({
      data: [{ ...synonymFixture, terms: ['only'] }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });

  /* ── createSynonym() ─────────────────────── */

  it('createSynonym() rejects fewer than 2 terms before the network', () => {
    expect(() => service.createSynonym({ terms: ['only one'] }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/search/synonyms');
  });

  it('createSynonym() rejects a term longer than 100 chars before the network', () => {
    const long = 'x'.repeat(101);
    expect(() => service.createSynonym({ terms: ['shoe', long] }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/search/synonyms');
  });

  it('createSynonym() POSTs raw terms and parses the envelope-wrapped group', (done) => {
    service.createSynonym({ terms: ['Shoe ', ' Sneaker '] }).subscribe((group) => {
      expect(group.terms).toHaveLength(3);
      done();
    });
    const req = http.expectOne('/api/v1/admin/search/synonyms');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ terms: ['Shoe ', ' Sneaker '] });
    req.flush({ data: synonymFixture });
  });

  /* ── deleteSynonym() ─────────────────────── */

  it('deleteSynonym() surfaces a backend 404 to the observer error callback', (done) => {
    service.deleteSynonym('missing-id').subscribe({
      next: () => fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    const req = http.expectOne('/api/v1/admin/search/synonyms/missing-id');
    expect(req.request.method).toBe('DELETE');
    req.flush(
      { error: { code: 'SYNONYM_NOT_FOUND', message: 'Synonym not found' } },
      {
        status: 404,
        statusText: 'Not Found',
      },
    );
  });

  /* ── listMerchandisingRules() ─────────────── */

  it('listMerchandisingRules() rejects pageSize > 100 before the network', () => {
    expect(() => service.listMerchandisingRules({ pageSize: 150 }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/search/merchandising');
  });

  it('listMerchandisingRules() parses a rule with type REDIRECT', (done) => {
    service.listMerchandisingRules({}).subscribe((res) => {
      expect(res.data[0].type).toBe('REDIRECT');
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/merchandising');
    req.flush({
      data: [
        {
          ...ruleFixture,
          type: 'REDIRECT',
          productId: null,
          position: null,
          config: { url: '/landing' },
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });

  it('listMerchandisingRules() throws a ZodError when data[0].type is unknown', (done) => {
    service.listMerchandisingRules({}).subscribe({
      next: () => fail('expected error'),
      error: (err) => {
        expect(err.name).toBe('ZodError');
        done();
      },
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/search/merchandising');
    req.flush({
      data: [{ ...ruleFixture, type: 'PROMOTE' }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });

  /* ── createMerchandisingRule() ────────────── */

  it('createMerchandisingRule() rejects { type: PIN } without position before the network', () => {
    expect(() =>
      service
        .createMerchandisingRule({ type: 'PIN', productId: ruleFixture.productId, query: 'shoe' })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/search/merchandising');
  });

  it('createMerchandisingRule() rejects { type: BOOST } without productId before the network', () => {
    expect(() =>
      service.createMerchandisingRule({ type: 'BOOST', query: 'shoe', priority: 1 }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/search/merchandising');
  });

  it('createMerchandisingRule() accepts REDIRECT without a productId', (done) => {
    service
      .createMerchandisingRule({ type: 'REDIRECT', query: 'shoe', config: { url: '/landing' } })
      .subscribe((rule) => {
        expect(rule.type).toBe('REDIRECT');
        done();
      });
    const req = http.expectOne('/api/v1/admin/search/merchandising');
    expect(req.request.method).toBe('POST');
    req.flush({
      data: {
        ...ruleFixture,
        type: 'REDIRECT',
        productId: null,
        position: null,
        config: { url: '/landing' },
      },
    });
  });

  it('createMerchandisingRule() rejects a query longer than 200 chars before the network', () => {
    const long = 'x'.repeat(201);
    expect(() =>
      service
        .createMerchandisingRule({
          type: 'BOOST',
          productId: ruleFixture.productId,
          query: long,
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/search/merchandising');
  });

  it('createMerchandisingRule() rejects a negative position before the network', () => {
    expect(() =>
      service
        .createMerchandisingRule({
          type: 'PIN',
          productId: ruleFixture.productId,
          position: -1,
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/search/merchandising');
  });

  /* ── deleteMerchandisingRule() ────────────── */

  it('deleteMerchandisingRule() DELETEs the correct URL', (done) => {
    service.deleteMerchandisingRule(ruleFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/search/merchandising/${ruleFixture.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('deleteMerchandisingRule() surfaces a backend 404 to the observer error callback', (done) => {
    service.deleteMerchandisingRule('missing-id').subscribe({
      next: () => fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    const req = http.expectOne('/api/v1/admin/search/merchandising/missing-id');
    req.flush(
      { error: { code: 'MERCHANDISING_RULE_NOT_FOUND', message: 'not found' } },
      {
        status: 404,
        statusText: 'Not Found',
      },
    );
  });
});
