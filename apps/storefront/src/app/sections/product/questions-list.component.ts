import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { LocaleService } from '../../locale.service';
import { LOCALE_INTL_TAG } from '../../../i18n/types';
import { ButtonComponent } from '../../ui/button.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { answerQuestionRequestSchema, type AnswerQuestionRequest } from '@storefront-types';

export interface QuestionAnswerRow {
  /** Localized attribution label: the store team, or the community. */
  authorName: string;
  body: string;
  isAdminAnswer: boolean;
}

export interface QuestionRow {
  id: string;
  question: string;
  authorName?: string;
  createdAt: string;
  /** The stored answer, or null. A question carries at most one. */
  answer: QuestionAnswerRow | null;
  /**
   * The locale the question was written in, when known. Customer text is
   * stored single-locale and there is no translation step, so a question
   * asked in French is shown in French on the English page. Carried here so
   * it can be rendered with the right `lang`, which is what a screen reader
   * needs to pronounce it.
   */
  questionLocale?: string | null;
  helpfulCount?: number;
  votedHelpful?: boolean;
  status?: 'PENDING' | 'PUBLISHED' | 'HIDDEN';
}

@Component({
  selector: 'product-questions-list',
  standalone: true,
  imports: [EmptyStateComponent, ButtonComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="questions"
      class="qa"
      [attr.aria-labelledby]="titleId"
      data-testid="product-questions-list"
    >
      <h2 [id]="titleId" class="title">{{ strings().product.questions.title }}</h2>

      @if (questions().length > 0) {
        <ol class="list">
          @for (q of questions(); track q.id) {
            <li class="entry">
              <div class="meta">
                <p class="question" dir="auto" [attr.lang]="q.questionLocale || null">
                  {{ q.question }}
                </p>
                <span class="asker" [attr.data-testid]="'product-question-asker-' + q.id">
                  {{ q.authorName || strings().product.questions.anonymous }}
                </span>
                <time [attr.datetime]="q.createdAt" class="time">{{
                  formatDate(q.createdAt)
                }}</time>
                @if (q.status === 'PENDING') {
                  <span
                    class="badge-pending"
                    [attr.data-testid]="'product-question-pending-' + q.id"
                  >
                    {{ strings().product.questions.pendingBadge }}
                  </span>
                }
              </div>
              @if (q.answer; as a) {
                <ul class="answers" role="list">
                  <li
                    class="answer"
                    [class.admin]="a.isAdminAnswer"
                    [attr.data-testid]="'product-question-answer-' + q.id"
                  >
                    <p class="answer-author">
                      <span
                        class="answer-badge"
                        [class.admin]="a.isAdminAnswer"
                        [attr.data-testid]="'product-question-answer-badge-' + q.id"
                      >
                        {{ a.authorName }}
                      </span>
                    </p>
                    <p class="answer-body" dir="auto" [attr.lang]="q.questionLocale || null">
                      {{ a.body }}
                    </p>
                  </li>
                </ul>
              }
              <div class="actions">
                @if (authed() && q.status !== 'PENDING') {
                  <!-- The answer column holds one value: offering the control
                       next to an existing answer offers to erase it. -->
                  <button
                    type="button"
                    class="helpful-btn"
                    [class.pressed]="q.votedHelpful"
                    [attr.aria-pressed]="q.votedHelpful ? 'true' : 'false'"
                    [attr.aria-label]="
                      q.votedHelpful
                        ? strings().product.questions.helpfulPressed
                        : strings().product.questions.helpful
                    "
                    [attr.data-testid]="'product-question-helpful-' + q.id"
                    (click)="onHelpfulClick(q)"
                  >
                    <span aria-hidden="true">👍</span>
                    <span>{{ helpfulCountLabel(q.helpfulCount ?? 0) }}</span>
                  </button>
                  @if (answeringId() === q.id) {
                    <form
                      class="answer-form"
                      [formGroup]="answerForm"
                      (ngSubmit)="onAnswerSubmit(q.id)"
                      novalidate
                      [attr.data-testid]="'product-question-answer-form-' + q.id"
                    >
                      <label class="answer-field">
                        <span class="label">{{ strings().product.questions.answer.label }}</span>
                        <textarea
                          formControlName="answer"
                          rows="3"
                          maxlength="5000"
                          required
                          [placeholder]="strings().product.questions.answer.placeholder"
                          [attr.aria-describedby]="showAnswerError() ? answerErrorId(q.id) : null"
                          [attr.aria-invalid]="showAnswerError() ? 'true' : null"
                          [attr.data-testid]="'product-question-answer-input-' + q.id"
                        ></textarea>
                        <span [id]="answerErrorId(q.id)" class="error" aria-live="polite">
                          @if (showAnswerError()) {
                            @if (answerForm.controls.answer.errors?.['required']) {
                              {{ strings().product.questions.answer.errors.required }}
                            } @else {
                              {{ strings().product.questions.answer.errors.tooLong }}
                            }
                          }
                        </span>
                      </label>
                      @if (answerError()) {
                        <p
                          class="form-error"
                          role="alert"
                          [attr.data-testid]="'product-question-answer-error-' + q.id"
                        >
                          {{ answerError() }}
                        </p>
                      }
                      <div class="answer-actions">
                        <app-button
                          type="submit"
                          variant="primary"
                          size="sm"
                          [loading]="answerSaving()"
                          [attr.data-testid]="'product-question-answer-submit-' + q.id"
                        >
                          {{
                            answerSaving()
                              ? strings().product.questions.answer.submitting
                              : strings().product.questions.answer.submit
                          }}
                        </app-button>
                        <button
                          type="button"
                          class="link-btn"
                          (click)="cancelAnswer()"
                          [attr.data-testid]="'product-question-answer-cancel-' + q.id"
                        >
                          {{ strings().product.questions.answer.cancel }}
                        </button>
                      </div>
                    </form>
                  } @else if (!q.answer) {
                    <button
                      type="button"
                      class="answer-toggle"
                      (click)="openAnswer(q.id)"
                      [attr.data-testid]="'product-question-answer-toggle-' + q.id"
                    >
                      {{ strings().product.questions.answer.toggleCta }}
                    </button>
                  }
                } @else if (!authed() && (q.helpfulCount ?? 0) > 0) {
                  <span
                    class="helpful-readonly"
                    [attr.data-testid]="'product-question-helpful-readonly-' + q.id"
                  >
                    {{ helpfulCountLabel(q.helpfulCount ?? 0) }}
                  </span>
                }
              </div>
            </li>
          }
        </ol>
        @if (hasMore()) {
          <button
            type="button"
            class="show-more"
            (click)="loadMore.emit()"
            data-testid="product-questions-show-more"
          >
            {{ strings().product.questions.showMore }}
          </button>
        }
      } @else {
        <app-empty-state [heading]="strings().product.questions.empty" />
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .qa {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .asker,
      .time {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .answer-badge {
        display: inline-block;
        font-size: var(--brand-text-micro);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--brand-text-muted);
      }
      .answer-badge.admin {
        color: var(--brand-text);
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .entry {
        background-color: var(--brand-surface);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        padding-block: 0.875rem;
        padding-inline: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .question {
        margin: 0;
        font-weight: 600;
      }
      .badge-pending {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
        border: 1px solid var(--brand-warning);
        padding-block: 0.125rem;
        padding-inline: 0.5rem;
      }
      .answers {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-inline-start: 1rem;
        border-inline-start: 2px solid var(--brand-primary);
      }
      .answer.admin {
        background-color: var(--brand-surface-strong);
        padding-inline: 0.75rem;
        padding-block: 0.5rem;
        border-radius: var(--brand-radius-sm);
      }
      .answer-author {
        margin: 0;
        font-size: var(--brand-text-micro);
        font-weight: 500;
        color: var(--brand-text-muted);
      }
      .answer-body {
        margin-block: 0.25rem 0;
        font-size: var(--brand-text-body);
        line-height: 1.5;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .helpful-btn,
      .answer-toggle {
        background: transparent;
        border: 1px solid var(--brand-border);
        color: var(--brand-text);
        cursor: pointer;
        font: inherit;
        font-size: var(--brand-text-micro);
        padding-block: 0.5rem;
        padding-inline: 0.75rem;
        min-block-size: 44px;
        min-inline-size: 44px;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
      }
      .helpful-btn.pressed {
        border-color: var(--brand-primary);
        color: var(--brand-primary);
      }
      .helpful-btn:focus-visible,
      .answer-toggle:focus-visible,
      .link-btn:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .helpful-readonly {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .answer-form {
        flex-basis: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .answer-field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .label {
        color: var(--brand-text);
        font-size: var(--brand-text-micro);
        font-weight: 500;
      }
      .answer-field textarea {
        background-color: var(--brand-surface);
        color: var(--brand-text);
        /* agent_docs/storefront/brand-tokens.md: a control resting boundary is load-bearing. */
        border: 1px solid var(--brand-border-interactive);
        padding-inline: 0.625rem;
        padding-block: 0.4rem;
        font-size: var(--brand-text-body);
        font-family: inherit;
      }
      .answer-field textarea:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .error {
        color: var(--brand-error);
        font-size: var(--brand-text-micro);
        min-block-size: 1rem;
      }
      .form-error {
        color: var(--brand-error);
        margin: 0;
      }
      .answer-actions {
        display: flex;
        align-items: center;
        gap: 0.625rem;
      }
      .link-btn {
        background: transparent;
        border: 0;
        color: var(--brand-primary);
        cursor: pointer;
        font: inherit;
        padding-block: 0.5rem;
        padding-inline: 0.25rem;
        min-block-size: 44px;
      }
      .show-more {
        align-self: flex-start;
        appearance: none;
        border: 0;
        background: none;
        cursor: pointer;
        font: inherit;
        color: var(--brand-primary);
        font-weight: 500;
        min-block-size: 44px;
        padding-block: 0.625rem;
      }
      .show-more:hover,
      .show-more:focus-visible {
        text-decoration: underline;
      }
    `,
  ],
})
export class QuestionsListComponent {
  readonly questions = input<QuestionRow[]>([]);
  /** Published questions on the product, not just the ones on screen. */
  readonly total = input<number>(0);
  readonly authed = input<boolean>(false);
  readonly answerSaving = input<boolean>(false);
  readonly answerError = input<string | null>(null);

  readonly helpfulToggle = output<{ questionId: string; nextVoted: boolean }>();
  readonly answerSubmitted = output<{ questionId: string; payload: AnswerQuestionRequest }>();
  readonly loadMore = output<void>();

  /**
   * Whether published questions remain beyond the ones on screen.
   *
   * This replaced a `href="#questions"` anchor, which resolved against
   * `<base href="/">` and sent the reader to the home page.
   */
  protected readonly hasMore = computed(() => this.questions().length < this.total());

  protected readonly titleId = `product-questions-${++questionsListId}`;
  protected readonly answeringId = signal<string | null>(null);

  private readonly localeService = inject(LocaleService);
  protected readonly strings = computed(() => this.localeService.strings());
  private readonly fb = inject(FormBuilder);

  protected readonly answerForm = this.fb.nonNullable.group({
    answer: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(5000)]),
  });

  protected formatDate(iso: string): string {
    const locale = LOCALE_INTL_TAG[this.localeService.locale()];
    try {
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  protected helpfulCountLabel(count: number): string {
    return this.strings().product.questions.helpfulCount.replace('{count}', String(count));
  }

  protected answerErrorId(questionId: string): string {
    return `product-question-answer-error-${questionId}`;
  }

  protected onHelpfulClick(q: QuestionRow): void {
    this.helpfulToggle.emit({ questionId: q.id, nextVoted: !q.votedHelpful });
  }

  protected openAnswer(questionId: string): void {
    this.answeringId.set(questionId);
    this.answerForm.reset({ answer: '' });
  }

  protected cancelAnswer(): void {
    this.answeringId.set(null);
    this.answerForm.reset({ answer: '' });
  }

  protected showAnswerError(): boolean {
    const ctrl = this.answerForm.controls.answer;
    return ctrl.invalid && (ctrl.dirty || ctrl.touched);
  }

  protected onAnswerSubmit(questionId: string): void {
    if (this.answerSaving()) return;
    if (this.answerForm.invalid) {
      this.answerForm.markAllAsTouched();
      return;
    }
    const trimmed = this.answerForm.controls.answer.value.trim();
    if (trimmed.length === 0) {
      this.answerForm.controls.answer.setErrors({ required: true });
      this.answerForm.markAllAsTouched();
      return;
    }
    const parsed = answerQuestionRequestSchema.safeParse({ answer: trimmed });
    if (!parsed.success) return;
    this.answerSubmitted.emit({ questionId, payload: parsed.data });
  }

  resetAnswerForm(): void {
    this.answeringId.set(null);
    this.answerForm.reset({ answer: '' });
  }
}

let questionsListId = 0;
