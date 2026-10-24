import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { ApiError, ApiForbiddenError } from '@admin-types';
import {
  SeoService,
  type SeoAnalytics,
  type SeoCoverage,
  type SeoQuota,
  type SubmissionHealth,
  type SubmitSeoResponse,
} from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { SeoSubmissionsPage } from './seo-submissions.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

const sample = {
  id: 'sub-1',
  actorId: null,
  trigger: 'manual' as const,
  targetType: 'url' as const,
  targetRef: 'product:widget',
  engine: 'indexnow' as const,
  requestedCount: 2,
  submittedCount: 2,
  skippedDeduped: 0,
  accepted: true,
  reason: null,
  correlationId: null,
  createdAt: '2026-06-27T08:30:00.000Z',
};
const listFixture = { data: [sample], meta: { page: 1, pageSize: 20, total: 1 } };

const healthFixture: SubmissionHealth = {
  checkedAt: '2026-06-28T09:00:00.000Z',
  healthy: false,
  gsc: { state: 'ok', detail: 'lastDownloaded=2026-06-27' },
  bing: { state: 'disabled', detail: 'BING_API_KEY unset' },
  publicSitemap: { state: 'error', detail: 'HTTP 502' },
};

const coverageFixture: SeoCoverage = {
  gsc: {
    state: 'ok',
    detail: '1 sitemap(s)',
    sitemaps: [
      {
        path: 'https://demo.example/sitemap-products.xml',
        submitted: 120,
        lastDownloaded: '2026-06-27T00:00:00.000Z',
        errors: 0,
        warnings: 0,
        isPending: false,
      },
    ],
  },
  bing: { state: 'disabled', detail: 'BING_API_KEY unset', feeds: [] },
};

const quotaFixture: SeoQuota = {
  bing: { state: 'disabled', detail: 'BING_API_KEY unset', dailyQuota: null, monthlyQuota: null },
  gsc: {
    state: 'ok',
    detail: '0/2000 used (estimated)',
    inspectUsed: 0,
    inspectCap: 2000,
    source: 'estimated',
  },
  indexnow: { dedupWindowSeconds: 300 },
};

const analyticsFixture: SeoAnalytics = {
  state: 'ok',
  detail: '28 day(s)',
  range: '28d',
  asOf: '2026-06-26',
  totals: { clicks: 1234, impressions: 56789, ctr: 0.0217, position: 12.4 },
  series: [{ date: '2026-06-01', clicks: 10, impressions: 200, ctr: 0.05, position: 7 }],
  topQueries: [{ query: 'sidr honey', clicks: 40, impressions: 800, ctr: 0.05, position: 4 }],
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

describe('SeoSubmissionsPage', () => {
  let fixture: ComponentFixture<SeoSubmissionsPage>;
  let page: SeoSubmissionsPage;
  let listSpy: jest.Mock;
  let healthSpy: jest.Mock;
  let coverageSpy: jest.Mock;
  let quotaSpy: jest.Mock;
  let analyticsSpy: jest.Mock;
  let recheckSpy: jest.Mock;
  let openSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let dialogResult: SubmitSeoResponse | null;

  const sitemapResponse: SubmitSeoResponse = {
    dryRun: false,
    targetType: 'sitemap',
    requestedCount: 1,
    results: [
      {
        engine: 'gsc',
        accepted: true,
        submitted: 1,
        skippedDeduped: 0,
        reason: null,
        submissionId: 's1',
      },
      {
        engine: 'bing',
        accepted: true,
        submitted: 1,
        skippedDeduped: 0,
        reason: null,
        submissionId: 's2',
      },
    ],
  };

  function configure(params: Record<string, string> = {}, perms: string[] = []) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    openSpy = jest.fn(() => ({ closed: of(dialogResult) }));
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: SeoService,
          useValue: {
            listSubmissions: listSpy,
            getSubmissionHealth: healthSpy,
            getCoverage: coverageSpy,
            getQuota: quotaSpy,
            getAnalytics: analyticsSpy,
            recheckHealth: recheckSpy,
          },
        },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams$.asObservable() } },
        { provide: Dialog, useValue: { open: openSpy } },
        {
          provide: AuthStore,
          useValue: {
            locale: () => 'fr',
            hasAnyPermission: (p: string[]) => p.some((x) => perms.includes(x)),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SeoSubmissionsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() => of(listFixture));
    healthSpy = jest.fn(() => of(healthFixture));
    coverageSpy = jest.fn(() => of(coverageFixture));
    quotaSpy = jest.fn(() => of(quotaFixture));
    analyticsSpy = jest.fn(() => of(analyticsFixture));
    recheckSpy = jest.fn(() => of({ ...healthFixture, healthy: true }));
    dialogResult = sitemapResponse;
  });

  it('fetches with defaults when URL has no filters', () => {
    configure();
    expect(listSpy).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(page.total()).toBe(1);
    expect(page.rows().length).toBe(1);
  });

  it('forwards the engine filter from the URL', () => {
    configure({ engine: 'bing' });
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ engine: 'bing' }));
  });

  it('forwards the trigger filter from the URL', () => {
    configure({ trigger: 'cron' });
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'cron' }));
  });

  it('maps outcome accepted=true → accepted true', () => {
    configure({ accepted: 'true' });
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }));
  });

  it('maps outcome accepted=false → accepted false', () => {
    configure({ accepted: 'false' });
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ accepted: false }));
  });

  it('setParam navigates with the engine param and resets page', () => {
    configure();
    const router = TestBed.inject(Router);
    const spy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    page.setParam('engine', 'gsc');
    expect(spy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ engine: 'gsc', page: null }),
      }),
    );
  });

  it('setOutcome navigates with the accepted param', () => {
    configure();
    const router = TestBed.inject(Router);
    const spy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    page.setOutcome('FAILED');
    expect(spy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ accepted: 'false' }) }),
    );
    page.setOutcome('ALL');
    expect(spy).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ accepted: null }) }),
    );
  });

  it('goToPage refuses out-of-bounds pages', () => {
    configure();
    const router = TestBed.inject(Router);
    const spy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    page.goToPage(0);
    page.goToPage(999);
    expect(spy).not.toHaveBeenCalled();
  });

  it('renders the empty state when there are no submissions', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="seo-submissions-empty"]')).not.toBeNull();
  });

  it('surfaces user-safe 403 copy when the list errors', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toMatch(/permission/i);
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  // ── Resubmit sitemap (DR-17 D2) ───────────────────────────────────────────

  const resubmitBtn = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="seo-indexing-resubmit-sitemap"]',
    );

  it('shows the Resubmit sitemap button only with seo:manage', () => {
    configure({}, ['seo:manage']);
    expect(resubmitBtn()).not.toBeNull();
  });

  it('hides the Resubmit sitemap button without seo:manage', () => {
    configure({}, ['seo:view']);
    expect(resubmitBtn()).toBeNull();
  });

  it('opens the submit dialog with the sitemap request on click', () => {
    configure({}, ['seo:manage']);
    page.openResubmitDialog();
    expect(openSpy).toHaveBeenCalledTimes(1);
    const data = openSpy.mock.calls[0][1].data;
    expect(data.request).toEqual({ sitemap: true });
  });

  it('announces a re-crawl success and refetches after a successful submit', () => {
    configure({}, ['seo:manage']);
    listSpy.mockClear();
    page.openResubmitDialog();
    expect(page.result()).toMatch(/re-crawl/i);
    expect(page.result()).not.toMatch(/reindex/i);
    expect(listSpy).toHaveBeenCalledTimes(1); // refetch so the new manual row appears
  });

  it('announces an informational skip when all URLs were recently deduped', () => {
    dialogResult = {
      dryRun: false,
      targetType: 'sitemap',
      requestedCount: 1,
      results: [
        {
          engine: 'gsc',
          accepted: true,
          submitted: 0,
          skippedDeduped: 3,
          reason: 'all deduped',
          submissionId: 's1',
        },
      ],
    };
    configure({}, ['seo:manage']);
    page.openResubmitDialog();
    expect(page.result()).toMatch(/skipped/i);
  });

  it('does not announce or refetch when the dialog is cancelled', () => {
    dialogResult = null;
    configure({}, ['seo:manage']);
    listSpy.mockClear();
    page.openResubmitDialog();
    expect(page.result()).toBeNull();
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('is axe-clean with the Resubmit sitemap button rendered', async () => {
    configure({}, ['seo:manage']);
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });

  // ── Monitoring dashboard (DR-17 D3) ───────────────────────────────────────

  it('fetches health, coverage and quota on init', () => {
    configure();
    expect(healthSpy).toHaveBeenCalledTimes(1);
    expect(coverageSpy).toHaveBeenCalledTimes(1);
    expect(quotaSpy).toHaveBeenCalledTimes(1);
    expect(page.health()).toEqual(healthFixture);
    expect(page.coverage()).toEqual(coverageFixture);
    expect(page.quota()).toEqual(quotaFixture);
  });

  it('renders the status strip, coverage card and quota readout', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="seo-status-strip"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="seo-coverage-card"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="seo-quota-readout"]')).not.toBeNull();
  });

  it('onRecheck refreshes the snapshot and announces success', () => {
    configure({}, ['seo:manage']);
    page.onRecheck();
    expect(recheckSpy).toHaveBeenCalledTimes(1);
    expect(page.health()?.healthy).toBe(true);
    expect(page.result()).toMatch(/re-checked/i);
  });

  it('onRecheck is a no-op while a re-check is already in flight', () => {
    // A never-emitting observable keeps rechecking() true across both calls.
    recheckSpy = jest.fn(() => new Observable(() => undefined));
    configure({}, ['seo:manage']);
    page.onRecheck();
    page.onRecheck();
    expect(recheckSpy).toHaveBeenCalledTimes(1);
  });

  it('onRecheck surfaces a friendly rate-limit message on 429', () => {
    recheckSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'THROTTLED', message: 'slow down', status: 429 })),
    );
    configure({}, ['seo:manage']);
    page.onRecheck();
    expect(page.result()).toMatch(/rate-limited/i);
  });

  it('keeps the dashboard usable when a monitoring read fails', () => {
    coverageSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    expect(page.coverageLoading()).toBe(false);
    expect(page.coverage()).toBeNull();
    // The history table still rendered.
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).not.toBeNull();
  });

  // ── GSC Search Analytics (DR-17 D4) ───────────────────────────────────────

  it('fetches analytics on init and populates the analytics signal', () => {
    configure();
    expect(analyticsSpy).toHaveBeenCalledTimes(1);
    expect(page.analytics()).toEqual(analyticsFixture);
  });

  it('renders the performance block when analytics is loaded', () => {
    configure();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="seo-performance-block"]'),
    ).not.toBeNull();
  });

  it('keeps the dashboard usable when the analytics read fails', () => {
    analyticsSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    expect(page.analyticsLoading()).toBe(false);
    expect(page.analytics()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).not.toBeNull();
  });
});
