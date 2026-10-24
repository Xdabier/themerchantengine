import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  Optional,
  computed,
  inject,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, TextareaComponent } from '@admin-ui';

export type ModerateSubject = 'review' | 'question';

export interface ModerateDialogData {
  subject: ModerateSubject;
  titleId?: string;
}

export type ModerateDialogResult = { reason?: string } | null;

let moderateDialogSeq = 0;

@Component({
  selector: 'app-review-moderate-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, FormFieldComponent, TextareaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full max-w-lg bg-surface border border-line p-6">
      <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
        {{ title() }}
      </h2>
      <p class="mt-2 text-xs text-ink-muted">
        Reason is optional and shown to staff in the audit trail. 1000 character maximum.
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-4" novalidate>
        <app-form-field
          label="Reason"
          [fieldId]="reasonId"
          [hint]="counter()"
          [error]="maxLengthError()"
        >
          <app-textarea
            [id]="reasonId"
            formControlName="reason"
            [rows]="4"
            data-testid="moderate-reason"
          ></app-textarea>
        </app-form-field>

        <div class="flex items-center justify-end gap-3 pt-2">
          <app-button
            variant="ghost"
            type="button"
            (clicked)="close(null)"
            data-testid="moderate-cancel"
          >
            Cancel
          </app-button>
          <app-button
            type="submit"
            variant="destructive"
            [disabled]="form.invalid"
            data-testid="moderate-submit"
          >
            {{ submitLabel() }}
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class ReviewModerateDialogComponent {
  private readonly fb = inject(FormBuilder);

  readonly titleId: string;
  readonly reasonId: string;

  readonly form = this.fb.nonNullable.group({
    reason: ['', [Validators.maxLength(1000)]],
  });

  readonly title = computed(() =>
    this.data?.subject === 'question' ? 'Reject this question' : 'Reject this review',
  );
  readonly submitLabel = computed(() =>
    this.data?.subject === 'question' ? 'Reject question' : 'Reject review',
  );

  // Plain methods, not computed(): Reactive-Forms getters (value/hasError) read
  // their backing signal through untracked(), so a computed() over them never
  // recomputes on typing under zoneless CD and would freeze at its initial value.
  // A method re-evaluates each CD pass — the one the textarea (input) already
  // schedules — so the counter and maxlength error track live input.
  counter(): string {
    return `${this.form.controls.reason.value.length} / 1000`;
  }

  maxLengthError(): string | null {
    return this.form.controls.reason.hasError('maxlength')
      ? 'Reason must be 1000 characters or fewer.'
      : null;
  }

  constructor(
    private readonly ref: DialogRef<ModerateDialogResult>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: ModerateDialogData,
  ) {
    this.titleId = data?.titleId ?? `moderate-${++moderateDialogSeq}`;
    this.reasonId = `${this.titleId}-reason`;
  }

  submit(): void {
    if (this.form.invalid) return;
    const reason = this.form.controls.reason.value.trim();
    this.ref.close(reason ? { reason } : {});
  }

  close(value: ModerateDialogResult): void {
    this.ref.close(value);
  }
}

export async function openReviewModerateDialog(
  dialog: Dialog,
  data: ModerateDialogData,
): Promise<ModerateDialogResult> {
  const titleId = data.titleId ?? `moderate-${++moderateDialogSeq}`;
  const ref = dialog.open<ModerateDialogResult>(ReviewModerateDialogComponent, {
    data: { ...data, titleId },
    ariaLabelledBy: titleId,
    ariaModal: true,
    hasBackdrop: true,
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    autoFocus: 'first-tabbable',
  });
  return await new Promise<ModerateDialogResult>((resolve) => {
    const sub = ref.closed.subscribe((value) => {
      resolve(value ?? null);
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}
