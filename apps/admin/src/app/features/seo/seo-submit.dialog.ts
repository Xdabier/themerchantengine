import { CommonModule } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ButtonComponent } from '@admin-ui';
import {
  SeoService,
  type SeoQuota,
  type SeoSubmissionEngine,
  type SubmitSeoRequest,
  type SubmitSeoResponse,
} from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';

export const SEO_SUBMIT_DIALOG_TITLE_ID = 'seo-submit-dialog-title';
export const SEO_SUBMIT_DIALOG_DESC_ID = 'seo-submit-dialog-description';

export interface SeoSubmitDialogData {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly request: SubmitSeoRequest;
}

export type SeoSubmitDialogResult = SubmitSeoResponse;

const ENGINE_LABEL: Record<SeoSubmissionEngine, string> = {
  indexnow: 'IndexNow',
  gsc: 'Google',
  bing: 'Bing',
};

/**
 * Builds the post-submit status line. Copy discipline (plan §9): "Submitted for
 * re-crawl," never "Reindexed." A `submitted:0 + skippedDeduped>0` outcome is an
 * INFORMATIONAL success (the URL was pushed recently), distinct from a failure.
 */
export function summarizeSeoSubmit(res: SubmitSeoResponse): {
  tone: 'success' | 'error';
  message: string;
} {
  const failed = res.results.filter((r) => !r.accepted);
  if (failed.length > 0) {
    const engines = failed.map((r) => ENGINE_LABEL[r.engine]).join(', ');
    return {
      tone: 'error',
      message: `Submission did not complete for ${engines}. See the indexing log.`,
    };
  }
  // A products target that resolved to nothing (all selected products inactive /
  // draft / deleted) — honest "nothing to do" rather than "Submitted 0 URL(s)".
  if (res.targetType === 'products' && res.requestedCount === 0) {
    return { tone: 'success', message: 'No active products to submit for re-crawl.' };
  }
  const submitted = res.results.reduce((sum: number, r) => sum + r.submitted, 0);
  const deduped = res.results.reduce((sum: number, r) => sum + r.skippedDeduped, 0);
  if (submitted === 0 && deduped > 0) {
    return {
      tone: 'success',
      message: `Already submitted for re-crawl recently — ${deduped} URL(s) skipped (within the 5-minute window).`,
    };
  }
  if (res.targetType === 'sitemap') {
    return { tone: 'success', message: 'Sitemap submitted for re-crawl.' };
  }
  return { tone: 'success', message: `Submitted ${submitted} URL(s) for re-crawl.` };
}

@Component({
  selector: 'app-seo-submit-dialog',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full max-w-lg bg-surface border border-line p-6 flex flex-col gap-6"
      data-testid="seo-submit-dialog"
    >
      <header class="flex flex-col gap-2">
        <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
          {{ data.title }}
        </h2>
        <p [id]="descId" class="text-sm text-ink-muted">{{ data.description }}</p>
      </header>

      <div
        class="flex flex-col gap-1 text-sm"
        data-testid="seo-submit-preview"
        aria-live="polite"
        aria-atomic="true"
      >
        @if (previewing()) {
          <p class="text-ink-muted">Checking what will be submitted…</p>
        } @else {
          @if (previewSummary(); as summary) {
            <p class="text-ink">{{ summary }}</p>
          }
          @if (quotaSummary(); as quota) {
            <p class="text-ink-muted text-xs" data-testid="seo-submit-quota">{{ quota }}</p>
          }
        }
      </div>

      <p
        class="text-xs border p-3 min-h-[2.5rem]"
        [class.border-status-error]="!!errorMessage()"
        [class.border-surface]="!errorMessage()"
        [class.text-ink]="!!errorMessage()"
        [class.text-ink-muted]="!errorMessage()"
        role="alert"
        data-testid="seo-submit-dialog-error"
      >
        {{ errorMessage() || ' ' }}
      </p>

      <div class="flex items-center justify-end gap-3">
        <app-button
          variant="ghost"
          type="button"
          (clicked)="cancel()"
          data-testid="seo-submit-cancel"
        >
          Cancel
        </app-button>
        <app-button
          variant="primary"
          type="button"
          [disabled]="confirmDisabled()"
          (clicked)="confirm()"
          data-testid="seo-submit-confirm"
        >
          {{ submitting() ? 'Submitting…' : data.confirmLabel }}
        </app-button>
      </div>
    </div>
  `,
})
export class SeoSubmitDialogComponent implements OnInit {
  private readonly dialogRef = inject<DialogRef<SeoSubmitDialogResult | null>>(DialogRef);
  private readonly seoService = inject(SeoService);

  readonly titleId = SEO_SUBMIT_DIALOG_TITLE_ID;
  readonly descId = SEO_SUBMIT_DIALOG_DESC_ID;
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  /** dryRun preview (URL count + dedup-skip estimate) + live quota, fetched on open. */
  readonly previewing = signal(true);
  readonly preview = signal<SubmitSeoResponse | null>(null);
  readonly quota = signal<SeoQuota | null>(null);

  /** Human preview line: "N URL(s) will be submitted…" or the sitemap variant. */
  readonly previewSummary = computed<string | null>(() => {
    const p = this.preview();
    if (!p) return null;
    if (p.targetType === 'sitemap') {
      const engines = p.results.map((r) => ENGINE_LABEL[r.engine]).join(' + ');
      return `The whole sitemap will be resubmitted to ${engines}.`;
    }
    const indexnow = p.results.find((r) => r.engine === 'indexnow');
    const toSubmit = indexnow?.submitted ?? p.requestedCount;
    const skipped = indexnow?.skippedDeduped ?? 0;
    const base = `${toSubmit} URL(s) will be submitted for re-crawl.`;
    return skipped > 0
      ? `${base} ${skipped} already submitted recently (skipped, within the 5-minute window).`
      : base;
  });

  /**
   * Informational quota context shown under the preview. This is purely a
   * readout — NOT a confirm gate. Neither manual-submit path spends the Bing
   * URL-submission quota that `GetUrlSubmissionQuota` reports: IndexNow
   * (url/products) has no hard quota, and a sitemap resubmit uses Bing
   * `SubmitFeed` / GSC `sitemaps.submit`, which do not draw down that quota
   * (it governs the deferred `SubmitUrl`/`SubmitUrlBatch` path — DR-16). So the
   * dialog surfaces the remaining quota for context but never blocks confirm on
   * it; a `dailyQuota` of 0 (the Bing quota is adaptive and can be single
   * digits — plan §12) must not block a quota-free sitemap resubmit.
   */
  readonly quotaSummary = computed<string | null>(() => {
    const q = this.quota();
    if (!q || q.bing.state !== 'ok' || q.bing.dailyQuota === null) return null;
    return `Bing daily quota remaining: ${q.bing.dailyQuota}.`;
  });

  readonly confirmDisabled = computed(() => this.submitting() || this.previewing());

  constructor(@Inject(DIALOG_DATA) public readonly data: SeoSubmitDialogData) {}

  ngOnInit(): void {
    // dryRun preview is read-only (spends nothing); best-effort — a failure just
    // leaves the confirm enabled with no preview line.
    this.seoService.submitManual({ ...this.data.request, dryRun: true }).subscribe({
      next: (res) => {
        this.preview.set(res);
        this.previewing.set(false);
      },
      // query-error-guard: allow — dryRun preview is a bonus line inside the
      // dialog; without it the confirm button still works and reports.
      error: () => this.previewing.set(false),
    });
    // Quota context is best-effort too; no quota → no guard.
    this.seoService.getQuota().subscribe({
      next: (q) => this.quota.set(q),
      // query-error-guard: allow — optional context line in a dialog.
      error: () => undefined,
    });
  }

  confirm(): void {
    if (this.confirmDisabled()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.seoService.submitManual(this.data.request).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.dialogRef.close(res);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(this.formatError(err));
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to request indexing.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not submit the indexing request. Please retry.';
  }
}
