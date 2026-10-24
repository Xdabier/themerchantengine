import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, TranslatableInputComponent } from '@admin-ui';
import { TRUST_PILLAR_KINDS } from '@admin-services';
import { buildTrustSignalItemForm, type TrustSignalsForm } from './build-config-forms';

/**
 * `TRUST_SIGNALS` sub-form per DR-04 / DR-05. Drives `TrustStripComponent`
 * on the storefront. Operators pick the pillar `kind` (delivery / returns /
 * authentic / support — the four glyphs the storefront ships) and write the
 * Translatable title + subtitle. Six pillars max — beyond that the strip
 * loses visual rhythm at desktop widths.
 */
@Component({
  selector: 'app-trust-signals-section-editor',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, FormFieldComponent, TranslatableInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col gap-5"
      [formGroup]="form()"
      data-testid="trust-signals-section-editor"
    >
      <fieldset class="flex flex-col gap-4 border border-line p-4" formArrayName="items">
        <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">Pillars (1–6)</legend>
        @for (group of itemControls(); track $index; let i = $index) {
          <div class="flex flex-col gap-3 border-s-2 border-line ps-4">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs tracking-widest uppercase text-ink-muted">Pillar {{ i + 1 }}</p>
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="itemControls().length <= 1"
                [ariaLabel]="'Remove pillar ' + (i + 1)"
                (clicked)="removeAt(i)"
                [attr.data-testid]="'trust-pillar-remove-' + i"
              >
                Remove
              </app-button>
            </div>
            <ng-container [formGroupName]="i">
              <app-form-field
                [label]="'Pillar kind'"
                [fieldId]="'trust-pillar-kind-' + i"
                [required]="true"
              >
                <select
                  [id]="'trust-pillar-kind-' + i"
                  class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed"
                  formControlName="kind"
                  [attr.data-testid]="'trust-pillar-kind-' + i"
                >
                  @for (k of pillarKinds; track k) {
                    <option [value]="k">{{ k }}</option>
                  }
                </select>
              </app-form-field>

              <app-form-field
                [label]="'Title'"
                [fieldId]="'trust-pillar-title-' + i"
                [required]="true"
              >
                <app-translatable-input
                  formControlName="title"
                  label="Title"
                  [inputId]="'trust-pillar-title-' + i"
                  [idPrefix]="'trust-pillar-title-' + i"
                  [testId]="'trust-pillar-title-' + i"
                ></app-translatable-input>
              </app-form-field>

              <app-form-field
                [label]="'Subtitle'"
                [fieldId]="'trust-pillar-subtitle-' + i"
                [required]="true"
              >
                <app-translatable-input
                  formControlName="subtitle"
                  label="Subtitle"
                  [inputId]="'trust-pillar-subtitle-' + i"
                  [idPrefix]="'trust-pillar-subtitle-' + i"
                  [testId]="'trust-pillar-subtitle-' + i"
                ></app-translatable-input>
              </app-form-field>
            </ng-container>
          </div>
        }
        <div>
          <app-button
            type="button"
            variant="secondary"
            size="sm"
            [disabled]="itemControls().length >= 6"
            ariaLabel="Add another trust pillar"
            (clicked)="addRow()"
            data-testid="trust-pillar-add"
          >
            Add pillar
          </app-button>
        </div>
      </fieldset>
    </div>
  `,
})
export class TrustSignalsSectionEditorComponent {
  private readonly fb = inject(FormBuilder);

  readonly form = input.required<TrustSignalsForm>();
  readonly pillarKinds = TRUST_PILLAR_KINDS;

  readonly itemControls = computed(() => this.form().controls.items.controls);

  addRow(): void {
    const items = this.form().controls.items;
    if (items.length >= 6) return;
    items.push(buildTrustSignalItemForm(this.fb));
    items.markAsDirty();
    this.form().markAsDirty();
  }

  removeAt(index: number): void {
    const items = this.form().controls.items;
    if (items.length <= 1) return;
    items.removeAt(index);
    items.markAsDirty();
    this.form().markAsDirty();
  }
}
