import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AnalyticsCustomersPage } from './customers.page';
import { AnalyticsFunnelPage } from './funnel.page';
import { AnalyticsProductsPage } from './products.page';
import { AnalyticsRevenuePage } from './revenue.page';
import { AnalyticsSearchPage } from './search.page';

expect.extend(toHaveNoViolations);

const funnelPayload = [
  { step: 'product_view', count: 100, dropOffRate: 0, overallConversionRate: 100 },
  { step: 'purchase', count: 10, dropOffRate: 90, overallConversionRate: 10 },
];

const productsPayload = [
  {
    productId: 'p1',
    name: { default: 'Shirt' },
    slug: 'shirt',
    views: 20,
    carts: 5,
    purchases: 1,
    viewToCartRate: 25,
    conversionRate: 5,
    revenue: 30,
  },
];

const revenuePayload = {
  grossRevenue: 100,
  netRevenue: 80,
  totalDiscounts: 10,
  totalRefunds: 10,
  orderCount: 4,
  aov: 25,
  uniqueSessions: 200,
  revenuePerVisitor: 0.5,
};

const customersPayload = {
  totalCustomers: 10,
  newCustomers: 4,
  returningCustomers: 6,
  retentionRate: 60,
  avgCustomerRevenue: 20,
};

const searchPayload = {
  totalSearches: 12,
  topQueries: [{ query: 'shirt', count: 3 }],
};

function configure<T>(
  method: keyof AnalyticsService,
  response: T,
): { spy: jest.Mock; service: Partial<AnalyticsService> } {
  const spy = jest.fn().mockReturnValue(of(response));
  return { spy, service: { [method]: spy } as Partial<AnalyticsService> };
}

describe('Analytics sub-report pages', () => {
  it.each([
    ['AnalyticsFunnelPage', AnalyticsFunnelPage, 'funnel', funnelPayload, 'analytics-funnel-chart'],
    [
      'AnalyticsProductsPage',
      AnalyticsProductsPage,
      'products',
      productsPayload,
      'analytics-products-table',
    ],
    [
      'AnalyticsRevenuePage',
      AnalyticsRevenuePage,
      'revenue',
      revenuePayload,
      'analytics-revenue-metrics',
    ],
    [
      'AnalyticsCustomersPage',
      AnalyticsCustomersPage,
      'customers',
      customersPayload,
      'analytics-customers-metrics',
    ],
    [
      'AnalyticsSearchPage',
      AnalyticsSearchPage,
      'search',
      searchPayload,
      'analytics-search-metrics',
    ],
  ] as const)(
    '%s renders the data artefact on happy path',
    (_name, component, method, payload, testid) => {
      const { service } = configure(method as keyof AnalyticsService, payload as never);
      TestBed.configureTestingModule({
        providers: [{ provide: AnalyticsService, useValue: service }],
      });
      const fixture: ComponentFixture<InstanceType<typeof component>> = TestBed.createComponent(
        component,
      ) as ComponentFixture<InstanceType<typeof component>>;
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector(`[data-testid="${testid}"]`)).not.toBeNull();
    },
  );

  it('surfaces ApiForbiddenError as a permission banner on funnel page', () => {
    const service = {
      funnel: jest
        .fn()
        .mockReturnValue(
          throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
        ),
    } as unknown as AnalyticsService;
    TestBed.configureTestingModule({
      providers: [{ provide: AnalyticsService, useValue: service }],
    });
    const fixture = TestBed.createComponent(AnalyticsFunnelPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toMatch(/permission/i);
  });

  it('surfaces ApiNotFoundError with the dedicated copy on funnel page', () => {
    const service = {
      funnel: jest
        .fn()
        .mockReturnValue(
          throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
        ),
    } as unknown as AnalyticsService;
    TestBed.configureTestingModule({
      providers: [{ provide: AnalyticsService, useValue: service }],
    });
    const fixture = TestBed.createComponent(AnalyticsFunnelPage);
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toMatch(/not found/i);
  });

  it.each([
    ['AnalyticsProductsPage', AnalyticsProductsPage, 'products'],
    ['AnalyticsRevenuePage', AnalyticsRevenuePage, 'revenue'],
    ['AnalyticsCustomersPage', AnalyticsCustomersPage, 'customers'],
    ['AnalyticsSearchPage', AnalyticsSearchPage, 'search'],
  ] as const)(
    '%s surfaces ApiForbiddenError + ApiNotFoundError via the typed branches',
    (_name, component, method) => {
      const forbiddenService = {
        [method]: jest
          .fn()
          .mockReturnValue(
            throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
          ),
      } as unknown as AnalyticsService;
      TestBed.configureTestingModule({
        providers: [{ provide: AnalyticsService, useValue: forbiddenService }],
      });
      const fixture1: ComponentFixture<InstanceType<typeof component>> = TestBed.createComponent(
        component,
      ) as ComponentFixture<InstanceType<typeof component>>;
      fixture1.detectChanges();
      expect(fixture1.componentInstance.error()).toMatch(/permission/i);
      TestBed.resetTestingModule();

      const notFoundService = {
        [method]: jest
          .fn()
          .mockReturnValue(
            throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
          ),
      } as unknown as AnalyticsService;
      TestBed.configureTestingModule({
        providers: [{ provide: AnalyticsService, useValue: notFoundService }],
      });
      const fixture2: ComponentFixture<InstanceType<typeof component>> = TestBed.createComponent(
        component,
      ) as ComponentFixture<InstanceType<typeof component>>;
      fixture2.detectChanges();
      expect(fixture2.componentInstance.error()).toMatch(/not found/i);
    },
  );

  it('revenue page is axe-clean after hydration', async () => {
    const { service } = configure('revenue', revenuePayload);
    TestBed.configureTestingModule({
      providers: [{ provide: AnalyticsService, useValue: service }],
    });
    const fixture = TestBed.createComponent(AnalyticsRevenuePage);
    fixture.detectChanges();
    const result = await axe(fixture.nativeElement);
    expect(result).toHaveNoViolations();
  });
});
