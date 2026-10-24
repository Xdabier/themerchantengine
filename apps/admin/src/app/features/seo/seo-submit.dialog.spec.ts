import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { SeoService, type SeoQuota, type SubmitSeoResponse } from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Observable, of, throwError } from 'rxjs';
import {
  SeoSubmitDialogComponent,
  type SeoSubmitDialogData,
  summarizeSeoSubmit,
} from './seo-submit.dialog';

expect.extend(toHaveNoViolations);

function makeResponse(over: Partial<SubmitSeoResponse> = {}): SubmitSeoResponse {
  return {
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
    ],
    ...over,
  };
}

describe('summarizeSeoSubmit', () => {
  it('reports a re-crawl success and never says "reindexed" for a sitemap', () => {
    const out = summarizeSeoSubmit(makeResponse({ targetType: 'sitemap' }));
    expect(out.tone).toBe('success');
    expect(out.message).toMatch(/re-crawl/i);
    expect(out.message).not.toMatch(/reindex/i);
  });

  it('counts submitted URLs for a products/url target', () => {
    const out = summarizeSeoSubmit(
      makeResponse({
        targetType: 'products',
        results: [
          {
            engine: 'indexnow',
            accepted: true,
            submitted: 4,
            skippedDeduped: 0,
            reason: null,
            submissionId: 's1',
          },
        ],
      }),
    );
    expect(out.message).toMatch(/4 URL/i);
  });

  it('treats submitted:0 + deduped>0 as an informational success', () => {
    const out = summarizeSeoSubmit(
      makeResponse({
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
      }),
    );
    expect(out.tone).toBe('success');
    expect(out.message).toMatch(/skipped/i);
  });

  it('reports "no active products" when a products target resolved to zero URLs', () => {
    const out = summarizeSeoSubmit(
      makeResponse({
        targetType: 'products',
        requestedCount: 0,
        results: [
          {
            engine: 'indexnow',
            accepted: true,
            submitted: 0,
            skippedDeduped: 0,
            reason: null,
            submissionId: 's1',
          },
        ],
      }),
    );
    expect(out.tone).toBe('success');
    expect(out.message).toMatch(/no active products/i);
  });

  it('reports an error tone when any engine did not accept', () => {
    const out = summarizeSeoSubmit(
      makeResponse({
        results: [
          {
            engine: 'gsc',
            accepted: false,
            submitted: 0,
            skippedDeduped: 0,
            reason: 'GSC error',
            submissionId: null,
          },
        ],
      }),
    );
    expect(out.tone).toBe('error');
    expect(out.message).toMatch(/did not complete/i);
  });
});

describe('SeoSubmitDialogComponent', () => {
  let submitSpy: jest.Mock;
  let quotaSpy: jest.Mock;
  let closeSpy: jest.Mock;

  const quotaFixture: SeoQuota = {
    bing: { state: 'ok', detail: 'live', dailyQuota: 9000, monthlyQuota: 250000 },
    gsc: {
      state: 'disabled',
      detail: 'off',
      inspectUsed: 0,
      inspectCap: 2000,
      source: 'estimated',
    },
    indexnow: { dedupWindowSeconds: 300 },
  };

  /** Real (post-confirm) submit calls — the init dryRun preview is filtered out. */
  const realCalls = () => submitSpy.mock.calls.filter((c) => !c[0]?.dryRun);

  function configure(data: SeoSubmitDialogData) {
    closeSpy = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: SeoService, useValue: { submitManual: submitSpy, getQuota: quotaSpy } },
        { provide: DialogRef, useValue: { close: closeSpy } },
        { provide: DIALOG_DATA, useValue: data },
      ],
    });
    const fixture = TestBed.createComponent(SeoSubmitDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  const sitemapData: SeoSubmitDialogData = {
    title: 'Resubmit sitemap',
    description: 'desc',
    confirmLabel: 'Resubmit sitemap',
    request: { sitemap: true },
  };
  const productsData: SeoSubmitDialogData = {
    title: 'Request indexing',
    description: 'desc',
    confirmLabel: 'Request indexing',
    request: { productIds: ['p1'] },
  };

  beforeEach(() => {
    submitSpy = jest.fn(() => of(makeResponse()));
    quotaSpy = jest.fn(() => of(quotaFixture));
  });

  it('runs a dryRun preview + quota fetch on open', () => {
    configure(sitemapData);
    expect(submitSpy).toHaveBeenCalledWith({ sitemap: true, dryRun: true });
    expect(quotaSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the dry-run preview summary (URLs to submit + dedup skips)', () => {
    submitSpy = jest.fn(() =>
      of(
        makeResponse({
          targetType: 'products',
          requestedCount: 4,
          results: [
            {
              engine: 'indexnow',
              accepted: true,
              submitted: 4,
              skippedDeduped: 1,
              reason: 'dry run',
              submissionId: null,
            },
          ],
        }),
      ),
    );
    const fixture = configure(productsData);
    const el = fixture.nativeElement as HTMLElement;
    const preview = el.querySelector('[data-testid="seo-submit-preview"]')!;
    expect(preview.textContent).toMatch(/4 URL/i);
    expect(preview.textContent).toMatch(/skipped/i);
  });

  it('shows the Bing quota context line', () => {
    const fixture = configure(sitemapData);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="seo-submit-quota"]')!.textContent).toMatch(/9000/);
  });

  it('submits the request (no dryRun) and closes with the response on confirm', () => {
    const fixture = configure(sitemapData);
    fixture.componentInstance.confirm();
    expect(submitSpy).toHaveBeenCalledWith({ sitemap: true });
    expect(closeSpy).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'sitemap' }));
  });

  it('closes with null on cancel without a real submit', () => {
    const fixture = configure(sitemapData);
    fixture.componentInstance.cancel();
    expect(realCalls()).toHaveLength(0);
    expect(closeSpy).toHaveBeenCalledWith(null);
  });

  it('does NOT block a sitemap resubmit on a low/zero Bing quota (SubmitFeed spends no URL quota)', () => {
    submitSpy = jest.fn(() =>
      of(
        makeResponse({
          targetType: 'sitemap',
          requestedCount: 1,
          results: [
            {
              engine: 'gsc',
              accepted: true,
              submitted: 1,
              skippedDeduped: 0,
              reason: 'dry run',
              submissionId: null,
            },
            {
              engine: 'bing',
              accepted: true,
              submitted: 1,
              skippedDeduped: 0,
              reason: 'dry run',
              submissionId: null,
            },
          ],
        }),
      ),
    );
    quotaSpy = jest.fn(() =>
      of({
        ...quotaFixture,
        bing: { state: 'ok', detail: 'live', dailyQuota: 0, monthlyQuota: 0 },
      }),
    );
    const fixture = configure(sitemapData);
    const el = fixture.nativeElement as HTMLElement;
    // The quota readout still shows the (zero) remaining quota as context…
    expect(el.querySelector('[data-testid="seo-submit-quota"]')).not.toBeNull();
    // …but there is no hard guard, and confirm proceeds — a sitemap resubmit
    // does not draw down the Bing URL-submission quota.
    expect(el.querySelector('[data-testid="seo-submit-guard"]')).toBeNull();
    expect(fixture.componentInstance.confirmDisabled()).toBe(false);
    fixture.componentInstance.confirm();
    expect(realCalls()).toHaveLength(1);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('leaves confirm enabled when the preview fetch fails (best-effort)', () => {
    submitSpy = jest.fn((req: { dryRun?: boolean }) =>
      req.dryRun ? throwError(() => new Error('preview boom')) : of(makeResponse()),
    );
    const fixture = configure(sitemapData);
    expect(fixture.componentInstance.previewing()).toBe(false);
    expect(fixture.componentInstance.confirmDisabled()).toBe(false);
    fixture.componentInstance.confirm();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('shows a user-safe 403 message and stays open on a confirm error', () => {
    submitSpy = jest.fn((req: { dryRun?: boolean }) =>
      req.dryRun
        ? of(makeResponse())
        : throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' })),
    );
    const fixture = configure(sitemapData);
    fixture.componentInstance.confirm();
    expect(fixture.componentInstance.errorMessage()).toMatch(/permission/i);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('surfaces a backend message on a generic confirm error', () => {
    submitSpy = jest.fn((req: { dryRun?: boolean }) =>
      req.dryRun
        ? of(makeResponse())
        : throwError(() => new ApiError({ code: 'X', message: 'rate limited', status: 429 })),
    );
    const fixture = configure(sitemapData);
    fixture.componentInstance.confirm();
    expect(fixture.componentInstance.errorMessage()).toBe('rate limited');
  });

  it('guards against double-submission while a request is in flight', () => {
    // dryRun preview resolves; the real submit never resolves so submitting() stays true.
    submitSpy = jest.fn((req: { dryRun?: boolean }) =>
      req.dryRun ? of(makeResponse()) : new Observable(() => undefined),
    );
    const fixture = configure(sitemapData);
    fixture.componentInstance.confirm();
    fixture.componentInstance.confirm();
    expect(realCalls()).toHaveLength(1);
  });

  it('is axe-clean in the idle state (preview + quota rendered)', async () => {
    const fixture = configure(sitemapData);
    expect(await axe(fixture.nativeElement as Element)).toHaveNoViolations();
  });

  it('is axe-clean in the error state (role=alert populated)', async () => {
    submitSpy = jest.fn((req: { dryRun?: boolean }) =>
      req.dryRun
        ? of(makeResponse())
        : throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' })),
    );
    const fixture = configure(sitemapData);
    fixture.componentInstance.confirm();
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement as Element)).toHaveNoViolations();
  });
});
