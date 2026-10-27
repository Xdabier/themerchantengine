import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { AnalyticsService } from './analytics.service';

const summaryFixture = {
  today: { orders: 2, revenue: 120, uniqueSessions: 45, conversionRate: 0.044 },
  thisWeek: { orders: 15, revenue: 1200, uniqueSessions: 320, conversionRate: 0.047 },
  thisMonth: { orders: 60, revenue: 4500, uniqueSessions: 1350, conversionRate: 0.044 },
};

const funnelFixture = [
  { step: 'product_view', count: 100, dropOffRate: 0, overallConversionRate: 100 },
  { step: 'add_to_cart', count: 40, dropOffRate: 60, overallConversionRate: 40 },
  { step: 'purchase', count: 10, dropOffRate: 75, overallConversionRate: 10 },
];

const productsFixture = [
  {
    productId: 'p1',
    name: { default: 'Shirt', en: 'Shirt' },
    slug: 'shirt',
    views: 200,
    carts: 50,
    purchases: 10,
    viewToCartRate: 25,
    conversionRate: 5,
    revenue: 500,
  },
];

const revenueFixture = {
  grossRevenue: 1200,
  netRevenue: 980,
  totalDiscounts: 120,
  totalRefunds: 100,
  orderCount: 12,
  aov: 100,
  uniqueSessions: 300,
  revenuePerVisitor: 4,
};

const customersFixture = {
  totalCustomers: 20,
  newCustomers: 8,
  returningCustomers: 12,
  retentionRate: 60,
  avgCustomerRevenue: 75,
};

const searchFixture = {
  totalSearches: 42,
  topQueries: [{ query: 'shirt', count: 10 }],
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        AnalyticsService,
      ],
    });
    service = TestBed.inject(AnalyticsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('dashboard() parses the today/week/month envelope', (done) => {
    service.dashboard().subscribe((res) => {
      expect(res.today.orders).toBe(2);
      expect(res.thisMonth.revenue).toBe(4500);
      done();
    });
    http.expectOne('/api/v1/admin/analytics/dashboard').flush({ data: summaryFixture });
  });

  it('dashboard() surfaces HTTP errors as observable errors', (done) => {
    service.dashboard().subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(500);
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/analytics/dashboard')
      .flush({ error: { code: 'INTERNAL' } }, { status: 500, statusText: 'Server Error' });
  });

  it('funnel() parses the array response and attaches date params', (done) => {
    service
      .funnel({ from: '2026-04-01T00:00:00Z', to: '2026-04-15T00:00:00Z' })
      .subscribe((res) => {
        expect(res).toHaveLength(3);
        expect(res[1].step).toBe('add_to_cart');
        expect(res[1].dropOffRate).toBe(60);
        done();
      });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/analytics/funnel');
    expect(req.request.params.get('from')).toBe('2026-04-01T00:00:00Z');
    expect(req.request.params.get('to')).toBe('2026-04-15T00:00:00Z');
    req.flush({ data: funnelFixture });
  });

  it('products() parses the typed product row array', (done) => {
    service.products().subscribe((res) => {
      expect(res).toHaveLength(1);
      expect(res[0].name.default).toBe('Shirt');
      expect(res[0].views).toBe(200);
      done();
    });
    http.expectOne('/api/v1/admin/analytics/products').flush({ data: productsFixture });
  });

  it('revenue() parses the revenue metrics object', (done) => {
    service
      .revenue({ from: '2026-04-01T00:00:00Z', to: '2026-04-15T00:00:00Z' })
      .subscribe((res) => {
        expect(res.grossRevenue).toBe(1200);
        expect(res.aov).toBe(100);
        done();
      });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/analytics/revenue');
    expect(req.request.params.get('from')).toBe('2026-04-01T00:00:00Z');
    expect(req.request.params.get('to')).toBe('2026-04-15T00:00:00Z');
    req.flush({ data: revenueFixture });
  });

  it('customers() parses the customer metrics object', (done) => {
    service.customers().subscribe((res) => {
      expect(res.totalCustomers).toBe(20);
      expect(res.retentionRate).toBe(60);
      done();
    });
    http.expectOne('/api/v1/admin/analytics/customers').flush({ data: customersFixture });
  });

  it('search() parses totalSearches + topQueries', (done) => {
    service.search().subscribe((res) => {
      expect(res.totalSearches).toBe(42);
      expect(res.topQueries[0].query).toBe('shirt');
      done();
    });
    http.expectOne('/api/v1/admin/analytics/search').flush({ data: searchFixture });
  });

  it('getPixels() handles the double-envelope backend quirk', (done) => {
    service.getPixels().subscribe((res) => {
      expect(res.googleAnalyticsId).toBe('G-ABC123');
      done();
    });
    http
      .expectOne('/api/v1/admin/analytics/pixels')
      .flush({ data: { data: { googleAnalyticsId: 'G-ABC123' } } });
  });

  it('getPixels() accepts an empty config (all IDs absent)', (done) => {
    service.getPixels().subscribe((res) => {
      expect(res).toEqual({});
      done();
    });
    http.expectOne('/api/v1/admin/analytics/pixels').flush({ data: { data: {} } });
  });

  it('updatePixels() rejects invalid tracking ids via Zod', () => {
    expect(() => service.updatePixels({ googleAnalyticsId: 'not$valid!' }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/analytics/pixels');
  });

  it('updatePixels() round-trips a valid payload and parses the response', (done) => {
    service.updatePixels({ googleAnalyticsId: 'G-NEW-123' }).subscribe((res) => {
      expect(res.googleAnalyticsId).toBe('G-NEW-123');
      done();
    });
    const req = http.expectOne('/api/v1/admin/analytics/pixels');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ googleAnalyticsId: 'G-NEW-123' });
    req.flush({ data: { data: { googleAnalyticsId: 'G-NEW-123' } } });
  });

  it('timeseries() attaches metric + granularity + window params', (done) => {
    service
      .timeseries({
        metric: 'orders',
        granularity: 'day',
        from: '2026-04-01T00:00:00Z',
        to: '2026-04-15T00:00:00Z',
      })
      .subscribe((res) => {
        expect(res.metric).toBe('orders');
        expect(res.buckets).toHaveLength(2);
        done();
      });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/analytics/timeseries');
    expect(req.request.params.get('metric')).toBe('orders');
    expect(req.request.params.get('granularity')).toBe('day');
    req.flush({
      data: {
        metric: 'orders',
        granularity: 'day',
        from: '2026-04-01T00:00:00Z',
        to: '2026-04-15T00:00:00Z',
        buckets: [
          { bucket: '2026-04-01T00:00:00Z', value: 3 },
          { bucket: '2026-04-02T00:00:00Z', value: 0 },
        ],
      },
    });
  });

  it('timeseries() rejects an unknown metric at the client boundary', () => {
    expect(() => service.timeseries({ metric: 'views' as never }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/analytics/timeseries');
  });
});
