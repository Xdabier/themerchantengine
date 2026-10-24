import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Inject, Optional, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, TextareaComponent } from '@admin-ui';
import type { AnswerQuestionRequest } from '@admin-services';
import { canApprove } from './reviews.utils';

export interface AnswerDialogData {
  existing?: string | null;
  /** The question's current moderation status, so the dialog can offer publish. */
  status?: string | null;
  titleId?: string;
}

export type AnswerDialogResult = (AnswerQuestionRequest & { publish: boolean }) | null;

let answerDialogSeq = 0;

@Component({
  selector: 'app-question-answer-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, FormFieldComponent, TextareaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full max-w-lg bg-surface border border-line p-6">
      <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
        Answer this question
      </h2>
      <p class="mt-2 text-xs text-ink-muted">
        Posted answers are visible on the storefront. 5000 character maximum.
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
        <app-form-field
          label="Answer"
          [fieldId]="answerId"
          [hint]="counter()"
          [error]="answerError()"
        >
          <app-textarea
            [id]="answerId"
            formControlName="answer"
            [rows]="6"
            data-testid="answer-body"
          ></app-textarea>
        </app-form-field>

        <label class="flex items-center gap-2 min-h-[44px] text-sm text-ink">
          <input
            type="checkbox"
            formControlName="isAdminAnswer"
            class="min-h-[20px] min-w-[20px] accent-ink"
            data-testid="answer-admin-toggle"
          />
          <span>Post as an official admin answer</span>
        </label>

        @if (canPublish) {
          <label class="flex items-center gap-2 min-h-[44px] text-sm text-ink">
            <input
              type="checkbox"
              formControlName="publish"
              class="min-h-[20px] min-w-[20px] accent-ink"
              data-testid="answer-publish-toggle"
            />
            <span>Publish this question after posting</span>
          </label>
        }

        <div class="flex items-center justify-end gap-3 pt-2">
          <app-button
            variant="ghost"
            type="button"
            (clicked)="close(null)"
            data-testid="answer-cancel"
          >
            Cancel
          </app-button>
          <app-button
            type="submit"
            variant="primary"
            [disabled]="form.invalid"
            data-testid="answer-submit"
          >
            Post answer
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class QuestionAnswerDialogComponent {
  private readonly fb = inject(FormBuilder);

  readonly titleId: string;
  readonly answerId: string;

  /**
   * Whether the question is still awaiting moderation, and can therefore be
   * published as part of answering it.
   *
   * Answering only wrote the answer; Approve was a separate button on the
   * detail page. An operator who answered and moved on left an answered
   * question no customer could see.
   */
  readonly canPublish: boolean;

  readonly form = this.fb.nonNullable.group({
    answer: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(5000)]],
    isAdminAnswer: [true],
    publish: [false],
  });

  // Plain methods, not computed(): Reactive-Forms getters read their backing
  // signal through untracked(), so a computed() over them freezes at its initial
  // value under zoneless CD. A method re-evaluates each CD pass — the one the
  // textarea (input) already schedules — so the counter and error track live input.
  counter(): string {
    return `${this.form.controls.answer.value.length} / 5000`;
  }

  answerError(): string | null {
    const ctrl = this.form.controls.answer;
    if (!ctrl.touched) return null;
    if (ctrl.hasError('required') || ctrl.hasError('minlength')) return 'Answer is required.';
    if (ctrl.hasError('maxlength')) return 'Answer must be 5000 characters or fewer.';
    return null;
  }

  constructor(
    private readonly ref: DialogRef<AnswerDialogResult>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: AnswerDialogData | null,
  ) {
    this.titleId = data?.titleId ?? `answer-${++answerDialogSeq}`;
    this.answerId = `${this.titleId}-body`;
    this.canPublish = canApprove(data?.status);
    if (this.canPublish) {
      this.form.controls.publish.setValue(true);
    }
    if (data?.existing) {
      this.form.controls.answer.setValue(data.existing);
    }
  }

  submit(): void {
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    this.ref.close({
      answer: value.answer.trim(),
      isAdminAnswer: value.isAdminAnswer,
      publish: this.canPublish && value.publish,
    });
  }

  close(value: AnswerDialogResult): void {
    this.ref.close(value);
  }
}

export async function openQuestionAnswerDialog(
  dialog: Dialog,
  data: AnswerDialogData = {},
): Promise<AnswerDialogResult> {
  const titleId = data.titleId ?? `answer-${++answerDialogSeq}`;
  const ref = dialog.open<AnswerDialogResult>(QuestionAnswerDialogComponent, {
    data: { ...data, titleId },
    ariaLabelledBy: titleId,
    ariaModal: true,
    hasBackdrop: true,
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    autoFocus: 'first-tabbable',
  });
  return await new Promise<AnswerDialogResult>((resolve) => {
    const sub = ref.closed.subscribe((value) => {
      resolve(value ?? null);
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}
