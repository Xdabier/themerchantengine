import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@admin-services';
import { of } from 'rxjs';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import { AnalyticsFunnelPage } from './funnel.page';

const funnel = [
  { step: 'product_view', count: 1000, overallConversionRate: 100, dropOffRate: 0 },
  { step: 'add_to_cart', count: 400, overallConversionRate: 40, dropOffRate: 60 },
  { step: 'purchase', count: 120, overallConversionRate: 12, dropOffRate: 70 },
];

describe('AnalyticsFunnelPage', () => {
  let fixture: ComponentFixture<AnalyticsFunnelPage>;
  let funnelSpy: jest.Mock;

  function mount(rows: typeof funnel = funnel): HTMLElement {
    funnelSpy = jest.fn().mockReturnValue(of(rows));
    TestBed.configureTestingModule({
      providers: [
        { provide: AnalyticsService, useValue: { funnel: funnelSpy } },
        provideStoreSettingsStub(),
      ],
    });
    fixture = TestBed.createComponent(AnalyticsFunnelPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows no drop-off on the entry stage', () => {
    // Finding E7: the first stage rendered "DROP-OFF 0%", which reads as a
    // measurement rather than "there is nothing to drop off from".
    const root = mount();
    expect(root.querySelector('[data-testid="analytics-funnel-dropoff-product_view"]')).toBeNull();
    expect(
      root.querySelector('[data-testid="analytics-funnel-dropoff-add_to_cart"]'),
    ).not.toBeNull();
  });

  it('does not blame an unset range for an empty funnel', () => {
    // Finding E6: the copy said "in the selected range" before one was chosen.
    const root = mount([]);
    expect(root.querySelector('[data-testid="analytics-funnel-chart"]')?.textContent).toContain(
      'No funnel events recorded yet.',
    );
    expect(root.querySelector('[data-testid="analytics-funnel-range"]')).toBeNull();
  });

  it('echoes the applied range in the canonical admin format', () => {
    const root = mount([]);
    fixture.componentInstance.reload({
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T23:59:59.000Z',
    });
    fixture.detectChanges();

    const echo = root.querySelector('[data-testid="analytics-funnel-range"]');
    expect(echo?.textContent).toContain('1 May 2026 – 31 May 2026');
    expect(root.querySelector('[data-testid="analytics-funnel-chart"]')?.textContent).toContain(
      'No funnel events between 1 May 2026 – 31 May 2026.',
    );
  });
});
