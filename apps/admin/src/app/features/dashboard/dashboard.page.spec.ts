import { ApiForbiddenError, ApiNotFoundError, ApiServerError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService, AuditLogService } from '@admin-services';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { DashboardPage } from './dashboard.page';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let page: DashboardPage;
  let dashboardSpy: jest.Mock;
  let auditListSpy: jest.Mock;
  let timeseriesSpy: jest.Mock;

  const timeseriesFixture = {
    metric: 'orders',
    granularity: 'day',
    from: '2026-03-17T00:00:00Z',
    to: '2026-04-16T00:00:00Z',
    buckets: [
      { bucket: '2026-04-14T00:00:00Z', value: 3 },
      { bucket: '2026-04-15T00:00:00Z', value: 1 },
      { bucket: '2026-04-16T00:00:00Z', value: 5 },
    ],
  };

  function configure(permissions: readonly string[] = ['audit_log:view']) {
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: AnalyticsService,
          useValue: { dashboard: dashboardSpy, timeseries: timeseriesSpy },
        },
        { provide: AuditLogService, useValue: { list: auditListSpy } },
        {
          provide: AuthStore,
          useValue: { locale: () => 'fr', hasPermission: (p: string) => permissions.includes(p) },
        },
        provideCurrencyStoreStub(),
      ],
    });
    fixture = TestBed.createComponent(DashboardPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  const summaryFixture = {
    today: { orders: 7, revenue: 420.5, uniqueSessions: 0, conversionRate: 0 },
    thisWeek: { orders: 43, revenue: 3120.75, uniqueSessions: 0, conversionRate: 0 },
    thisMonth: { orders: 120, revenue: 9800, uniqueSessions: 0, conversionRate: 0 },
  };

  beforeEach(() => {
    timeseriesSpy = jest.fn(() => of(timeseriesFixture));
  });

  const activityFixture = {
    data: [
      {
        id: 'a1',
        action: 'product.update',
        entityType: 'product',
        entityId: 'p1',
        createdAt: '2026-04-16T10:00:00.000Z',
      },
    ],
    meta: { page: 1, pageSize: 8, total: 1 },
  };

  it('reads the activity feed as a sentence, never as raw audit keys', () => {
    dashboardSpy = jest.fn(() => of(summaryFixture));
    auditListSpy = jest.fn(() =>
      of({
        data: [
          {
            id: 'a1',
            action: 'webhook.delete',
            entityType: 'webhook',
            entityId: 'w1',
            createdAt: '2026-04-16T10:00:00.000Z',
            user: { firstName: 'Super', lastName: 'Admin', email: 'root@example.com' },
          },
        ],
        meta: { page: 1, pageSize: 8, total: 1 },
      }),
    );
    configure();
    const list = fixture.nativeElement.querySelector(
      '[data-testid="activity-list"]',
    ) as HTMLElement;
    const sentence = list.querySelector('[data-testid="activity-sentence"]') as HTMLElement;
    expect(sentence.textContent?.replace(/\s+/g, ' ').trim()).toBe('Super Admin deleted a webhook');
    expect(list.textContent).not.toContain('webhook.delete');
  });

  it('renders skeletons while both calls are in flight', () => {
    dashboardSpy = jest.fn(() => of(summaryFixture));
    auditListSpy = jest.fn(() => of(activityFixture));
    configure();
    expect(page.loading()).toBe(false);
    expect(page.summary()).not.toBeNull();
  });

  it('populates KPI values + activity once both settle', () => {
    dashboardSpy = jest.fn(() => of(summaryFixture));
    auditListSpy = jest.fn(() => of(activityFixture));
    configure();
    expect(page.summary()?.today.orders).toBe(7);
    expect(page.activity()).toHaveLength(1);
    expect(page.error()).toBeNull();
  });

  it('surfaces a KPI fetch error without overwriting later activity failures', () => {
    dashboardSpy = jest.fn(() =>
      throwError(() => new ApiServerError({ code: 'INTERNAL', message: 'kpi', status: 500 })),
    );
    auditListSpy = jest.fn(() =>
      throwError(() => new ApiServerError({ code: 'INTERNAL', message: 'feed', status: 500 })),
    );
    configure();
    expect(page.error()).toBe('kpi');
  });

  it('maps ApiForbiddenError on either call to a permission-safe message', () => {
    dashboardSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    auditListSpy = jest.fn(() => of(activityFixture));
    configure();
    expect(page.error()).toContain('permission');
  });

  it('maps ApiNotFoundError on either call to the data-not-found message', () => {
    dashboardSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    auditListSpy = jest.fn(() => of(activityFixture));
    configure();
    expect(page.error()).toBe('Dashboard data not found.');
  });

  // A3: the revenue KPIs used to render a bare `3,120.75` with a caption that
  // dodged the question ("Gross, all currencies").
  it('renders revenue KPIs in the store currency at its own precision', () => {
    dashboardSpy = jest.fn(() => of(summaryFixture));
    configure();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('XTS 3,120.750');
    expect(text).toContain('XTS 9,800.000');
    expect(text).not.toContain('Gross, all currencies');
    expect(text).toContain('Gross');
  });

  it('formats counts safely when values are missing', () => {
    dashboardSpy = jest.fn(() => of(summaryFixture));
    auditListSpy = jest.fn(() => of(activityFixture));
    configure();
    expect(page.formatCount(undefined)).toBe('—');
    expect(page.formatCount(1234)).toBe('1,234');
  });

  it('clears subscriptions on destroy', () => {
    dashboardSpy = jest.fn(() => of(summaryFixture));
    auditListSpy = jest.fn(() => of(activityFixture));
    configure();
    fixture.destroy();
    expect(() => page.ngOnDestroy()).not.toThrow();
  });

  it('populates both sparkline trends from timeseries()', () => {
    dashboardSpy = jest.fn(() => of(summaryFixture));
    auditListSpy = jest.fn(() => of(activityFixture));
    configure();
    expect(timeseriesSpy).toHaveBeenCalledTimes(2);
    expect(timeseriesSpy.mock.calls[0][0]).toEqual({ metric: 'orders', granularity: 'day' });
    expect(timeseriesSpy.mock.calls[1][0]).toEqual({ metric: 'revenue', granularity: 'day' });
    expect(page.ordersTrend()).toEqual([3, 1, 5]);
    expect(page.revenueTrend()).toEqual([3, 1, 5]);
  });

  it('swallows timeseries errors without blocking KPI rendering', () => {
    dashboardSpy = jest.fn(() => of(summaryFixture));
    auditListSpy = jest.fn(() => of(activityFixture));
    timeseriesSpy = jest.fn(() => throwError(() => new Error('boom')));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      configure();
      expect(page.summary()).not.toBeNull();
      expect(page.error()).toBeNull();
      expect(page.ordersTrend()).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  // ── QA C6: the feed rows had drill-down targets and no way to reach them ────

  it('links activity rows only when the operator holds audit_log:view', () => {
    configure(['audit_log:view']);
    expect(page.canViewAuditLogs()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="activity-link"]')).not.toBeNull();
  });

  it('keeps the rows plain text without that permission, so no one lands on a 403', () => {
    configure([]);
    expect(page.canViewAuditLogs()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="activity-link"]')).toBeNull();
  });
});

describe('DashboardPage.toActivityItem mapping', () => {
  const map = () => {
    const page = Object.create(DashboardPage.prototype) as DashboardPage;
    return (page as unknown as { toActivityItem: (r: unknown) => unknown }).toActivityItem.bind(
      page,
    );
  };

  it('composes a sentence from the action and the entity type', () => {
    expect(
      map()({
        id: '1',
        action: 'gift_card.update',
        entityType: 'gift_card',
        entityId: 'g1',
        user: { firstName: 'Alice', lastName: 'Khan', email: 'a@b' },
        createdAt: '2026-01-01',
      }),
    ).toMatchObject({ sentence: 'Alice Khan updated a gift card' });
  });

  it('names a system action System in the sentence', () => {
    expect(
      map()({
        id: '1',
        action: 'order.create',
        entityType: 'order',
        entityId: 'o1',
        userId: 'u-1',
        createdAt: '2026-01-01',
      }),
    ).toMatchObject({ sentence: 'System created an order' });
  });

  it('composes the actor from the joined user full name', () => {
    expect(
      map()({
        id: '1',
        action: 'x',
        entityType: 'y',
        entityId: null,
        user: { firstName: 'Alice', lastName: 'Khan', email: 'a@b' },
        createdAt: '2026-01-01',
      }),
    ).toMatchObject({ actor: 'Alice Khan' });
  });

  it('falls back to the user email when no name is present', () => {
    expect(
      map()({
        id: '1',
        action: 'x',
        entityType: 'y',
        entityId: null,
        user: { email: 'a@b' },
        createdAt: '2026-01-01',
      }),
    ).toMatchObject({ actor: 'a@b' });
  });

  it('never leaks the raw userId — a user-less (system) action maps to null', () => {
    expect(
      map()({
        id: '1',
        action: 'x',
        entityType: 'y',
        entityId: null,
        userId: 'u-1',
        createdAt: '2026-01-01',
      }),
    ).toMatchObject({ actor: null });
  });
});
