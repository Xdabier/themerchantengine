import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { SeoAnalytics } from '@admin-services';
import { SeoPerformanceBlockComponent } from './seo-performance-block.component';

expect.extend(toHaveNoViolations);

const ANALYTICS: SeoAnalytics = {
  state: 'ok',
  detail: '28 day(s)',
  range: '28d',
  asOf: '2026-06-26',
  totals: { clicks: 1234, impressions: 56789, ctr: 0.0217, position: 12.4 },
  series: [
    { date: '2026-06-01', clicks: 10, impressions: 200, ctr: 0.05, position: 7 },
    { date: '2026-06-02', clicks: 12, impressions: 240, ctr: 0.05, position: 6.5 },
  ],
  topQueries: [{ query: 'fraise dentaire', clicks: 40, impressions: 800, ctr: 0.05, position: 4 }],
  topPages: [
    {
      page: 'https://demo.example/fr/catalogue/produit/fraise-dentaire',
      clicks: 25,
      impressions: 500,
      ctr: 0.05,
      position: 3,
    },
  ],
};

describe('SeoPerformanceBlockComponent', () => {
  let fixture: ComponentFixture<SeoPerformanceBlockComponent>;

  const setup = (inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(SeoPerformanceBlockComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [SeoPerformanceBlockComponent] }));

  it('renders the totals, the daily series and both top-10 tables', () => {
    const el = setup({ analytics: ANALYTICS });
    const metrics = el.querySelector('[data-testid="seo-performance-metrics"]')!;
    expect(metrics).not.toBeNull();
    // 1234 → grouped thousands; CTR fraction → percentage; position → 1 decimal.
    expect(metrics.textContent).toContain('1,234');
    expect(metrics.textContent).toContain('2.2%');
    expect(metrics.textContent).toContain('12.4');
    expect(el.querySelector('[data-testid="seo-performance-queries"]')!.textContent).toContain(
      'fraise dentaire',
    );
    expect(el.querySelector('[data-testid="seo-performance-pages"]')!.textContent).toContain(
      '/catalogue/produit/fraise-dentaire',
    );
    // Two series rows.
    expect(el.textContent).toContain('2026-06-01');
    expect(el.textContent).toContain('2026-06-02');
  });

  it('renders the as-of settling note when asOf is set', () => {
    const el = setup({ analytics: ANALYTICS });
    const note = el.querySelector('[data-testid="seo-performance-asof"]')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('2026-06-26');
  });

  it('shows the not-connected degrade copy when state is disabled', () => {
    const el = setup({
      analytics: {
        state: 'disabled',
        detail: 'GSC disabled',
        range: '28d',
        asOf: null,
        totals: null,
        series: [],
        topQueries: [],
        topPages: [],
      },
    });
    const degrade = el.querySelector('[data-testid="seo-performance-degrade"]')!;
    expect(degrade.textContent).toMatch(/not connected/i);
    expect(el.querySelector('[data-testid="seo-performance-metrics"]')).toBeNull();
  });

  it('shows the error degrade copy + detail when state is error', () => {
    const el = setup({
      analytics: {
        state: 'error',
        detail: 'insufficient permission',
        range: '28d',
        asOf: null,
        totals: null,
        series: [],
        topQueries: [],
        topPages: [],
      },
    });
    const degrade = el.querySelector('[data-testid="seo-performance-degrade"]')!;
    expect(degrade.textContent).toMatch(/could not load/i);
    expect(degrade.textContent).toContain('insufficient permission');
  });

  it('renders null totals as em-dashes without throwing', () => {
    const el = setup({
      analytics: {
        ...ANALYTICS,
        totals: { clicks: null, impressions: null, ctr: null, position: null },
      },
    });
    expect(el.querySelector('[data-testid="seo-performance-metrics"]')!.textContent).toContain('—');
  });

  it('shows the no-series message when ok but the series is empty', () => {
    const el = setup({
      analytics: { ...ANALYTICS, series: [], topQueries: [], topPages: [] },
    });
    expect(el.querySelector('[data-testid="seo-performance-no-series"]')).not.toBeNull();
  });

  it('renders the unavailable fallback when analytics is null', () => {
    const el = setup({ analytics: null });
    expect(el.querySelector('[data-testid="seo-performance-empty"]')).not.toBeNull();
  });

  it('renders the skeleton (not the metrics) and sets aria-busy while loading', () => {
    const el = setup({ loading: true });
    expect(el.querySelector('app-skeleton')).not.toBeNull();
    expect(el.querySelector('[data-testid="seo-performance-metrics"]')).toBeNull();
    expect(
      el.querySelector('[data-testid="seo-performance-block"]')!.getAttribute('aria-busy'),
    ).toBe('true');
  });

  // A degraded fixture reused across the degrade axe cases.
  const degraded = (state: 'disabled' | 'error', detail: string): SeoAnalytics => ({
    state,
    detail,
    range: '28d',
    asOf: null,
    totals: null,
    series: [],
    topQueries: [],
    topPages: [],
  });

  it('is axe-clean with data', async () => {
    const el = setup({ analytics: ANALYTICS });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean when disabled (degrade)', async () => {
    const el = setup({ analytics: degraded('disabled', 'GSC disabled') });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean when error (degrade)', async () => {
    const el = setup({ analytics: degraded('error', 'insufficient permission') });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean with null totals', async () => {
    const el = setup({
      analytics: {
        ...ANALYTICS,
        totals: { clicks: null, impressions: null, ctr: null, position: null },
      },
    });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean with an empty series + breakdowns (ok but no data yet)', async () => {
    const el = setup({ analytics: { ...ANALYTICS, series: [], topQueries: [], topPages: [] } });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean with the unavailable fallback (null analytics)', async () => {
    const el = setup({ analytics: null });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean while loading', async () => {
    const el = setup({ loading: true });
    expect(await axe(el)).toHaveNoViolations();
  });
});
