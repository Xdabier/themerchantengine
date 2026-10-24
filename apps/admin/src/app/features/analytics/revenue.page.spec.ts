import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of } from 'rxjs';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { AnalyticsRevenuePage } from './revenue.page';

expect.extend(toHaveNoViolations);

/** `6539.2` is the exact figure QA saw rendered as a bare, truncated `6,539.2`. */
const metrics = {
  grossRevenue: 6539.2,
  netRevenue: 6100,
  totalDiscounts: 240.5,
  totalRefunds: 198.75,
  orderCount: 42,
  aov: 155.7,
  uniqueSessions: 1200,
  revenuePerVisitor: 5.45,
};

describe('AnalyticsRevenuePage', () => {
  let fixture: ComponentFixture<AnalyticsRevenuePage>;
  let revenueSpy: jest.Mock;

  function mount(): HTMLElement {
    revenueSpy = jest.fn().mockReturnValue(of(metrics));
    TestBed.configureTestingModule({
      providers: [
        { provide: AnalyticsService, useValue: { revenue: revenueSpy } },
        provideCurrencyStoreStub(),
      ],
    });
    fixture = TestBed.createComponent(AnalyticsRevenuePage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  // A2: every money tile used to render bare and truncated — `6,539.2`, with no
  // code, no symbol, and minimumFractionDigits: 0 eating the trailing decimal.
  // The store currency decides the precision; XTS carries three places.
  it('renders every money tile with the store currency at its own precision', () => {
    const root = mount();
    const text = root.textContent ?? '';

    expect(text).toContain('XTS 6,539.200');
    expect(text).toContain('XTS 6,100.000');
    expect(text).toContain('XTS 240.500');
    expect(text).toContain('XTS 198.750');
    expect(text).toContain('XTS 155.700');
    expect(text).toContain('XTS 5.450');

    expect(text).not.toContain('6,539.2 ');
    expect(text).not.toContain('6,539.20 ');
    expect(text).not.toMatch(/US\$|\$\d/);
  });

  it('leaves non-money metrics alone', () => {
    const root = mount();
    const text = root.textContent ?? '';
    expect(text).toContain('42');
    expect(text).toContain('1,200');
  });

  it('has no axe violations with the tiles rendered', async () => {
    const root = mount();
    expect(await axe(root)).toHaveNoViolations();
  });
});
