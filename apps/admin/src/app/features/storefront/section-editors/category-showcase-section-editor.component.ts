import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, TranslatableInputComponent } from '@admin-ui';
import { CategoriesService, type Category } from '@admin-services';

import { AuthStore } from '../../../core/stores/auth.store';
import { EntitySelectComponent } from '../../../shared/entity-select/entity-select.component';
import { createCategorySource } from '../section-picker-sources';
import { collectLiveIds } from './live-ids';
import { unknownIdValidator } from './dead-id.validator';
import type { CategoryShowcaseForm } from './build-config-forms';
import { StoreSettingsStore } from '../../../core/stores/store-settings.store';

const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `CATEGORY_SHOWCASE` sub-form per DR-04 / DR-05. Drives
 * `CategoriesGridComponent` on the storefront.
 *
 * Phase B10 replaced the paste-a-UUID text rows with the shared entity picker
 * (AD14). The form contract is unchanged, `categoryIds: string[]`, so nothing
 * downstream moves: only the control that produces each string changed.
 *
 * The editor also resolves the configured ids on load and marks any that no
 * longer exists, blocking save. Before this, a category deleted after the
 * section was configured left a dead reference that surfaced only on the
 * storefront, and after plan B phase B2 stopped substituting pool content for
 * it, only as an empty rail.
 */
@Component({
  selector: 'app-category-showcase-section-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    TranslatableInputComponent,
    EntitySelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col gap-5"
      [formGroup]="form()"
      data-testid="category-showcase-section-editor"
    >
      <app-form-field
        label="Heading (optional)"
        fieldId="category-showcase-heading"
        hint="Override the default 'Categories' heading on the storefront grid."
      >
        <app-translatable-input
          formControlName="heading"
          label="Heading"
          inputId="category-showcase-heading"
          idPrefix="category-showcase-heading"
          testId="category-showcase-heading"
        ></app-translatable-input>
      </app-form-field>

      <fieldset class="flex flex-col gap-3 border border-line p-4" formArrayName="categoryIds">
        <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">
          Categories (1-12)
        </legend>
        @if (lookupFailed()) {
          <p class="text-xs text-warning" role="status" data-testid="category-id-lookup-failed">
            Could not load the category list, so the ids below were not checked.
          </p>
        }
        @for (control of categoryIdsControls(); track $index) {
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <app-form-field
                [label]="'Category ' + ($index + 1)"
                [fieldId]="'category-id-' + $index"
                [required]="true"
              >
                <app-entity-select
                  [id]="'category-id-' + $index"
                  [testId]="'category-id-' + $index"
                  ariaLabel="Category"
                  listboxLabel="Categories"
                  placeholder="Search categories"
                  [formControlName]="$index"
                  [source]="categorySource"
                />
              </app-form-field>
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="categoryIdsControls().length <= 1"
                [ariaLabel]="'Remove category ' + ($index + 1)"
                (clicked)="removeAt($index)"
                [attr.data-testid]="'category-id-remove-' + $index"
              >
                Remove
              </app-button>
            </div>
            @if (control.hasError('deadId')) {
              <p
                class="text-xs text-danger"
                role="alert"
                [attr.data-testid]="'category-id-dead-' + $index"
              >
                This category no longer exists. Pick another, or remove the row.
              </p>
            }
          </div>
        }
        <div>
          <app-button
            type="button"
            variant="secondary"
            size="sm"
            [disabled]="categoryIdsControls().length >= 12"
            ariaLabel="Add another category to the showcase"
            (clicked)="addRow()"
            data-testid="category-id-add"
          >
            Add another
          </app-button>
        </div>
      </fieldset>
    </div>
  `,
})
export class CategoryShowcaseSectionEditorComponent {
  private readonly fb = inject(FormBuilder);
  private readonly categories = inject(CategoriesService);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = input.required<CategoryShowcaseForm>();

  readonly categoryIdsControls = computed(() => this.form().controls.categoryIds.controls);

  /** Every live category id. Null until the first lookup settles. */
  private readonly liveIds = signal<ReadonlySet<string> | null>(null);

  /**
   * The lookup failed. Surfaced rather than swallowed: an operator who cannot
   * see that the check did not run would read a clean form as "verified".
   */
  protected readonly lookupFailed = signal(false);

  protected readonly categorySource = createCategorySource(
    this.categories,
    () => this.auth.locale(),
    () => this.storeSettings.defaultLocale(),
  );

  constructor() {
    this.categories
      .tree()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tree: Category[]) => {
          this.liveIds.set(collectLiveIds(tree));
          this.lookupFailed.set(false);
        },
        // A failed lookup must not invent dead ids: leaving `liveIds` null
        // keeps every row valid, so an outage cannot block an unrelated save.
        // It is reported instead of swallowed, so the operator knows the ids
        // went unchecked.
        error: () => {
          this.liveIds.set(null);
          this.lookupFailed.set(true);
        },
      });

    effect(() => {
      if (this.liveIds() === null) return;
      for (const control of this.form().controls.categoryIds.controls) {
        control.addValidators(unknownIdValidator(() => this.liveIds()));
        control.updateValueAndValidity({ emitEvent: false });
      }
    });
  }

  addRow(): void {
    const ids = this.form().controls.categoryIds;
    if (ids.length >= 12) return;
    ids.push(
      this.fb.nonNullable.control('', [
        Validators.required,
        Validators.pattern(ENTITY_ID),
        unknownIdValidator(() => this.liveIds()),
      ]),
    );
    ids.markAsDirty();
    this.form().markAsDirty();
  }

  removeAt(index: number): void {
    const ids = this.form().controls.categoryIds;
    if (ids.length <= 1) return;
    ids.removeAt(index);
    ids.markAsDirty();
    this.form().markAsDirty();
  }
}
