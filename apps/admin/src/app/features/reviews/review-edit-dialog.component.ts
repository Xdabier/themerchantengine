import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Inject, Optional, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, InputComponent, TextareaComponent } from '@admin-ui';
import type { ReviewStatus } from '@admin-services';

export interface ReviewEditDialogData {
  reviewId: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: ReviewStatus;
  titleId?: string;
}

export interface ReviewEditDialogResult {
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  reason?: string;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: ReviewStatus; label: string }> = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'HIDDEN', label: 'Hidden' },
];

let editDialogSeq = 0;

@Component({
  selector: 'app-review-edit-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    TextareaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full max-w-xl bg-surface border border-line p-6">
      <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
        Edit review
      </h2>
      <p class="mt-2 text-xs text-ink-muted">
        Edits are saved as-is. Set status to PUBLISHED to surface immediately, or PENDING to
        re-queue for moderation.
      </p>

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="mt-6 flex flex-col gap-4"
        novalidate
        data-testid="review-edit-form"
      >
        <app-form-field label="Rating" [fieldId]="ratingId" [error]="ratingError()">
          <app-input
            [id]="ratingId"
            type="number"
            formControlName="rating"
            data-testid="review-edit-rating"
          />
        </app-form-field>

        <app-form-field label="Title" [fieldId]="titleFieldId" [error]="titleError()">
          <app-input [id]="titleFieldId" formControlName="title" data-testid="review-edit-title" />
        </app-form-field>

        <app-form-field
          label="Body"
          [fieldId]="bodyId"
          [error]="bodyError()"
          [hint]="bodyCounter()"
        >
          <app-textarea
            [id]="bodyId"
            formControlName="body"
            [rows]="6"
            data-testid="review-edit-body"
          ></app-textarea>
        </app-form-field>

        <app-form-field label="Status" [fieldId]="statusId">
          <select
            [id]="statusId"
            formControlName="status"
            data-testid="review-edit-status"
            class="w-full bg-surface border border-line text-ink p-3 text-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            @for (opt of statusOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </app-form-field>

        <app-form-field
          label="Reason (audit log)"
          [fieldId]="reasonId"
          [hint]="'Optional. Saved to the moderation audit trail.'"
          [error]="reasonError()"
        >
          <app-textarea
            [id]="reasonId"
            formControlName="reason"
            [rows]="2"
            data-testid="review-edit-reason"
          ></app-textarea>
        </app-form-field>

        <div class="flex items-center justify-end gap-3 pt-2">
          <app-button
            type="button"
            variant="ghost"
            (clicked)="cancel()"
            data-testid="review-edit-cancel"
          >
            Cancel
          </app-button>
          <app-button
            type="submit"
            variant="primary"
            [disabled]="form.invalid || form.pristine"
            data-testid="review-edit-submit"
          >
            Save changes
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class ReviewEditDialogComponent {
  private readonly fb = inject(FormBuilder);

  readonly titleId: string;
  readonly ratingId: string;
  readonly titleFieldId: string;
  readonly bodyId: string;
  readonly statusId: string;
  readonly reasonId: string;

  protected readonly statusOptions = STATUS_OPTIONS;

  readonly form = this.fb.nonNullable.group({
    rating: this.fb.nonNullable.control(5, [
      Validators.required,
      Validators.min(1),
      Validators.max(5),
    ]),
    title: this.fb.nonNullable.control('', [Validators.maxLength(200)]),
    body: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(5000)]),
    status: this.fb.nonNullable.control<ReviewStatus>('PENDING'),
    reason: this.fb.nonNullable.control('', [Validators.maxLength(1000)]),
  });

  // Plain methods, not computed(): Reactive-Forms getters read their backing
  // signal through untracked(), so a computed() over them freezes at its initial
  // value under zoneless CD and the validation errors + counter never update on
  // typing. A method re-evaluates each CD pass the input/textarea (input) schedules.
  ratingError(): string | null {
    const ctrl = this.form.controls.rating;
    if (!ctrl.touched && !ctrl.dirty) return null;
    if (ctrl.hasError('required')) return 'Rating is required.';
    if (ctrl.hasError('min') || ctrl.hasError('max')) return 'Rating must be between 1 and 5.';
    return null;
  }

  titleError(): string | null {
    return this.form.controls.title.hasError('maxlength')
      ? 'Title must be 200 characters or fewer.'
      : null;
  }

  bodyError(): string | null {
    const ctrl = this.form.controls.body;
    if (!ctrl.touched && !ctrl.dirty) return null;
    if (ctrl.hasError('required')) return 'Body is required.';
    if (ctrl.hasError('maxlength')) return 'Body must be 5000 characters or fewer.';
    return null;
  }

  bodyCounter(): string {
    return `${this.form.controls.body.value.length} / 5000`;
  }

  reasonError(): string | null {
    return this.form.controls.reason.hasError('maxlength')
      ? 'Reason must be 1000 characters or fewer.'
      : null;
  }

  constructor(
    private readonly ref: DialogRef<ReviewEditDialogResult | null>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: ReviewEditDialogData,
  ) {
    this.titleId = data?.titleId ?? `review-edit-${++editDialogSeq}`;
    this.ratingId = `${this.titleId}-rating`;
    this.titleFieldId = `${this.titleId}-title`;
    this.bodyId = `${this.titleId}-body`;
    this.statusId = `${this.titleId}-status`;
    this.reasonId = `${this.titleId}-reason`;

    if (data) {
      this.form.patchValue({
        rating: data.rating,
        title: data.title ?? '',
        body: data.body ?? '',
        status: data.status,
        reason: '',
      });
      this.form.markAsPristine();
    }
  }

  submit(): void {
    if (this.form.invalid || this.form.pristine) return;
    const raw = this.form.getRawValue();
    const reason = raw.reason.trim();
    this.ref.close({
      rating: raw.rating,
      title: raw.title.trim() === '' ? null : raw.title.trim(),
      body: raw.body.trim(),
      status: raw.status,
      ...(reason ? { reason } : {}),
    });
  }

  cancel(): void {
    this.ref.close(null);
  }
}

export async function openReviewEditDialog(
  dialog: Dialog,
  data: ReviewEditDialogData,
): Promise<ReviewEditDialogResult | null> {
  const titleId = data.titleId ?? `review-edit-${++editDialogSeq}`;
  const ref = dialog.open<ReviewEditDialogResult | null>(ReviewEditDialogComponent, {
    data: { ...data, titleId },
    ariaLabelledBy: titleId,
    ariaModal: true,
    hasBackdrop: true,
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    autoFocus: 'first-tabbable',
  });
  return await new Promise<ReviewEditDialogResult | null>((resolve) => {
    const sub = ref.closed.subscribe((value) => {
      resolve(value ?? null);
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}
