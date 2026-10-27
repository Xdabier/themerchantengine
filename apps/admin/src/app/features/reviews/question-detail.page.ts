import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, SkeletonComponent } from '@admin-ui';
import { AuthStore } from '../../core/stores/auth.store';
import { ReviewsService, type Question } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError, pickTranslation } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { openQuestionAnswerDialog } from './question-answer-dialog.component';
import { openReviewModerateDialog } from './review-moderate-dialog.component';
import { canApprove, canReject, reviewAuthorLabel, reviewStatusTone } from './reviews.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/questions/:id` — single question detail + moderation + answer actions.
 *
 * Approve + reject mirror the review detail surface. Answer opens a dedicated
 * dialog with a 5000-char textarea and an `isAdminAnswer` toggle defaulted on.
 */
@Component({
  selector: 'app-question-detail-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent, AdminDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="question-detail-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/questions" class="hover:underline">Questions</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">Detail</span>
      </nav>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="question-detail-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>
      <span
        class="sr-only"
        role="status"
        data-testid="question-saved"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ saved() ? 'Saved' : '' }}
      </span>
      @if (loading()) {
        <div class="flex flex-col gap-3">
          <app-skeleton height="2.5rem" />
          <app-skeleton height="1rem" />
          <app-skeleton height="6rem" />
        </div>
      } @else if (question(); as q) {
        <header class="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 class="text-3xl md:text-4xl font-bold tracking-tight">Question</h1>
            <p class="mt-2 text-sm text-ink-muted">
              by {{ authorLabel(q) }} ·
              <span class="tabular tabular-nums">{{ q.createdAt | adminDate }}</span>
            </p>
          </div>
          <app-badge [tone]="statusTone(q.status)" [ariaLabel]="'Question status: ' + q.status">
            <span data-testid="question-status">{{ q.status }}</span>
          </app-badge>
        </header>

        <section
          class="border border-line bg-surface p-6 flex flex-col gap-4"
          aria-labelledby="question-body-heading"
        >
          <h2 id="question-body-heading" class="text-xs tracking-widest uppercase text-ink-muted">
            Question
          </h2>
          <p class="text-sm text-ink whitespace-pre-line" data-testid="question-body">
            {{ questionText(q) }}
          </p>
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div>
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Product</dt>
              <dd class="mt-1 text-sm">
                <a
                  [routerLink]="['/products', q.productId]"
                  class="text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  data-testid="question-product-link"
                >
                  {{ q.product?.slug ?? q.productId }}
                </a>
              </dd>
            </div>
            <div>
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Helpful</dt>
              <dd class="mt-1 text-sm text-ink tabular-nums">
                {{ q.helpfulCount ?? 0 }}
              </dd>
            </div>
          </dl>
        </section>

        @if (answerText(q)) {
          <section
            class="border border-line bg-surface p-6 flex flex-col gap-3"
            aria-labelledby="question-answer-heading"
          >
            <h2
              id="question-answer-heading"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              Answer
              @if (q.isAdminAnswer) {
                <span class="ml-2">
                  <app-badge
                    tone="info"
                    ariaLabel="Admin answer"
                    data-testid="question-answer-admin-badge"
                  >
                    Admin
                  </app-badge>
                </span>
              }
            </h2>
            <p class="text-sm text-ink whitespace-pre-line" data-testid="question-answer-body">
              {{ answerText(q) }}
            </p>
          </section>
        }

        @if (canManage()) {
          <section
            class="border border-line bg-surface p-6 flex items-center justify-between gap-4 flex-wrap"
            data-testid="question-actions"
            aria-labelledby="question-actions-heading"
          >
            <h2
              id="question-actions-heading"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              Actions
            </h2>
            <div class="flex items-center gap-3 flex-wrap">
              <span
                class="text-xs text-ink-muted tabular-nums"
                data-testid="question-saved-visible"
                aria-hidden="true"
              >
                {{ saved() ? 'Saved' : '' }}
              </span>
              <app-button
                data-testid="question-approve"
                variant="primary"
                [disabled]="!canApproveNow() || !!busy()"
                [loading]="busy() === 'approve'"
                (clicked)="approve()"
              >
                Approve
              </app-button>
              <app-button
                data-testid="question-reject"
                variant="destructive"
                [disabled]="!canRejectNow() || !!busy()"
                [loading]="busy() === 'reject'"
                (clicked)="reject()"
              >
                Reject
              </app-button>
              <app-button
                data-testid="question-answer-open"
                variant="secondary"
                [disabled]="!!busy()"
                [loading]="busy() === 'answer'"
                (clicked)="answer()"
              >
                Answer
              </app-button>
            </div>
          </section>
        }
      }
    </section>
  `,
})
export class QuestionDetailPage implements OnInit, OnDestroy {
  private readonly reviewsService = inject(ReviewsService);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(Dialog);
  private readonly destroy$ = new Subject<void>();

  readonly question = signal<Question | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<'approve' | 'reject' | 'answer' | null>(null);
  readonly saved = signal(false);

  readonly canManage = computed(() => this.auth.hasPermission('reviews:update'));
  readonly canApproveNow = computed(() => canApprove(this.question()?.status));
  readonly canRejectNow = computed(() => canReject(this.question()?.status));
  protected readonly statusTone = reviewStatusTone;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  authorLabel(q: Question): string {
    return reviewAuthorLabel(q.asker ?? null, q.askedById ?? null);
  }

  /** Resolve the Translatable `question` to the active locale for display. */
  questionText(q: Question): string {
    return pickTranslation(q.question, this.auth.locale(), '', this.storeSettings.defaultLocale());
  }

  /** Resolve the Translatable `answer` — empty string when unanswered. */
  answerText(q: Question): string {
    return pickTranslation(q.answer, this.auth.locale(), '', this.storeSettings.defaultLocale());
  }

  approve(): void {
    const current = this.question();
    if (!current || this.busy()) return;
    this.busy.set('approve');
    this.reviewsService
      .approveQuestion(current.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => this.applyResult(updated),
        error: (err: unknown) => this.failAction(err),
      });
  }

  async reject(): Promise<void> {
    const current = this.question();
    if (!current || this.busy()) return;
    const result = await openReviewModerateDialog(this.dialog, { subject: 'question' });
    if (!result) return;
    this.busy.set('reject');
    this.reviewsService
      .rejectQuestion(current.id, result)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => this.applyResult(updated),
        error: (err: unknown) => this.failAction(err),
      });
  }

  async answer(): Promise<void> {
    const current = this.question();
    if (!current || this.busy()) return;
    const result = await openQuestionAnswerDialog(this.dialog, {
      // Resolve the Translatable to the active locale before prefilling the
      // single-line answer dialog; '' (no answer yet) collapses to null.
      existing: this.answerText(current) || null,
      status: current.status,
    });
    if (!result) return;
    const { publish, ...payload } = result;
    this.busy.set('answer');
    this.reviewsService
      .answerQuestion(current.id, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => {
          // Approve in the same gesture when the operator asked for it.
          // Answering alone leaves the question PENDING, which is how an
          // answered question ends up invisible to every customer.
          if (publish && canApprove(updated.status)) {
            this.reviewsService
              .approveQuestion(current.id)
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: (approved) => this.applyResult({ ...updated, ...approved }),
                error: (err: unknown) => this.failAction(err),
              });
            return;
          }
          this.applyResult(updated);
        },
        error: (err: unknown) => this.failAction(err),
      });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    // Same pattern as reviews-detail: filter the list by id client-side. The
    // backend has no GET-one endpoint.
    this.reviewsService
      .listQuestions({ pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const match = res.data.find((q) => q.id === id) ?? null;
          if (!match) {
            this.error.set('Question not found.');
            this.loading.set(false);
            return;
          }
          this.question.set(match);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private applyResult(updated: Question): void {
    this.question.update((prev) => (prev ? { ...prev, ...updated } : updated));
    this.busy.set(null);
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 3000);
  }

  private failAction(err: unknown): void {
    this.busy.set(null);
    this.error.set(this.formatError(err));
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to moderate this question.';
    if (err instanceof ApiNotFoundError) return 'Question not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save the change. Please retry.';
  }
}
