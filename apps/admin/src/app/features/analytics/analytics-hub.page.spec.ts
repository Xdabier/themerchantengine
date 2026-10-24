import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AnalyticsHubPage } from './analytics-hub.page';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';

expect.extend(toHaveNoViolations);

const summary = {
  today: { orders: 2, revenue: 120, uniqueSessions: 40, conversionRate: 5 },
  thisWeek: { orders: 10, revenue: 1000, uniqueSessions: 300, conversionRate: 3.3 },
  thisMonth: { orders: 40, revenue: 4500, uniqueSessions: 1200, conversionRate: 3.1 },
};

describe('AnalyticsHubPage', () => {
  let fixture: ComponentFixture<AnalyticsHubPage>;
  let dashboardSpy: jest.Mock;

  function mount() {
    dashboardSpy = jest.fn().mockReturnValue(of(summary));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { dashboard: dashboardSpy } },
        provideCurrencyStoreStub(),
      ],
    });
    fixture = TestBed.createComponent(AnalyticsHubPage);
    fixture.detectChanges();
  }

  it('renders the four KPI tiles from the dashboard summary', () => {
    mount();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="analytics-kpi-grid"]')).not.toBeNull();
    expect(dashboardSpy).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('XTS 1,000.000'); // week revenue, store currency
  });

  it('renders a navigation tile for every sub-report + pixels', () => {
    mount();
    const root = fixture.nativeElement as HTMLElement;
    for (const slug of ['funnel', 'products', 'revenue', 'customers', 'search', 'pixels']) {
      expect(root.querySelector(`[data-testid="analytics-link-${slug}"]`)).not.toBeNull();
    }
  });

  it('surfaces ApiForbiddenError as a permission-specific error banner', () => {
    dashboardSpy = jest
      .fn()
      .mockReturnValue(
        throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
      );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { dashboard: dashboardSpy } },
        provideCurrencyStoreStub(),
      ],
    });
    fixture = TestBed.createComponent(AnalyticsHubPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="analytics-hub-error"]')?.textContent).toMatch(
      /permission/i,
    );
  });

  it('surfaces ApiNotFoundError with the dedicated not-found copy', () => {
    dashboardSpy = jest
      .fn()
      .mockReturnValue(
        throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
      );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { dashboard: dashboardSpy } },
        provideCurrencyStoreStub(),
      ],
    });
    fixture = TestBed.createComponent(AnalyticsHubPage);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="analytics-hub-error"]')?.textContent).toMatch(
      /not found/i,
    );
  });

  it('is axe-clean after hydration', async () => {
    mount();
    const result = await axe(fixture.nativeElement);
    expect(result).toHaveNoViolations();
  });
});
