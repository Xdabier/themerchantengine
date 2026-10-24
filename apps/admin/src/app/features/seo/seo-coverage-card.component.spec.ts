import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { SeoCoverage } from '@admin-services';
import { SeoCoverageCardComponent } from './seo-coverage-card.component';

expect.extend(toHaveNoViolations);

const COVERAGE: SeoCoverage = {
  gsc: {
    state: 'ok',
    detail: '1 sitemap(s)',
    sitemaps: [
      {
        path: 'https://demo.example/sitemap-products.xml',
        submitted: 120,
        lastDownloaded: '2026-06-27T00:00:00.000Z',
        errors: 0,
        warnings: 2,
        isPending: false,
      },
    ],
  },
  bing: {
    state: 'ok',
    detail: '1 feed(s)',
    feeds: [{ url: 'https://demo.example/sitemap_index.xml', lastCrawled: null, urlCount: 134 }],
  },
};

describe('SeoCoverageCardComponent', () => {
  let fixture: ComponentFixture<SeoCoverageCardComponent>;

  const setup = (inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(SeoCoverageCardComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [SeoCoverageCardComponent] }));

  it('renders the GSC sitemap table with the submitted count', () => {
    const el = setup({ coverage: COVERAGE });
    const gsc = el.querySelector('[data-testid="seo-coverage-gsc"]')!;
    expect(gsc.textContent).toContain('sitemap-products.xml');
    expect(gsc.textContent).toContain('120');
  });

  it('renders Bing feeds with the URL count', () => {
    const el = setup({ coverage: COVERAGE });
    const bing = el.querySelector('[data-testid="seo-coverage-bing"]')!;
    expect(bing.textContent).toContain('sitemap_index.xml');
    expect(bing.textContent).toContain('134');
  });

  it('shows the degrade detail for a disabled engine', () => {
    const el = setup({
      coverage: {
        gsc: { state: 'disabled', detail: 'GSC disabled', sitemaps: [] },
        bing: { state: 'disabled', detail: 'BING_API_KEY unset', feeds: [] },
      },
    });
    expect(el.textContent).toContain('GSC disabled');
    expect(el.textContent).toContain('BING_API_KEY unset');
  });

  it('shows the empty-registry message when GSC is ok but has no sitemaps', () => {
    const el = setup({
      coverage: {
        gsc: { state: 'ok', detail: '0 sitemap(s)', sitemaps: [] },
        bing: { state: 'ok', detail: '0 feed(s)', feeds: [] },
      },
    });
    expect(el.textContent).toMatch(/no sitemaps registered/i);
    expect(el.textContent).toMatch(/no sitemap feed registered/i);
  });

  it('renders sitemap errors as a contrast-safe error badge when errors > 0', () => {
    const withErrors: SeoCoverage = {
      ...COVERAGE,
      gsc: { ...COVERAGE.gsc, sitemaps: [{ ...COVERAGE.gsc.sitemaps[0], errors: 3 }] },
    };
    const el = setup({ coverage: withErrors });
    const gsc = el.querySelector('[data-testid="seo-coverage-gsc"]')!;
    expect(gsc.textContent).toContain('3');
    // The non-zero count renders as an app-badge (bg-status-error-tint / text-on-status-error),
    // not red text on the surface — keeps the small count above the 4.5:1 AA threshold.
    expect(gsc.querySelector('app-badge')).not.toBeNull();
  });

  it('shows the error detail when an engine probe errored', () => {
    const el = setup({
      coverage: {
        gsc: { state: 'error', detail: 'insufficient permission', sitemaps: [] },
        bing: { state: 'error', detail: 'GetFeeds returned 403', feeds: [] },
      },
    });
    expect(el.textContent).toContain('insufficient permission');
    expect(el.textContent).toContain('GetFeeds returned 403');
  });

  it('renders the unavailable fallback when coverage is null', () => {
    const el = setup({ coverage: null });
    expect(el.querySelector('[data-testid="seo-coverage-empty"]')).not.toBeNull();
  });

  it('is axe-clean', async () => {
    const el = setup({ coverage: COVERAGE });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean when a sitemap has errors > 0', async () => {
    const withErrors: SeoCoverage = {
      ...COVERAGE,
      gsc: { ...COVERAGE.gsc, sitemaps: [{ ...COVERAGE.gsc.sitemaps[0], errors: 3 }] },
    };
    const el = setup({ coverage: withErrors });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean while loading', async () => {
    const el = setup({ loading: true });
    expect(await axe(el)).toHaveNoViolations();
  });
});
