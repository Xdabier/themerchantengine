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
import { FEATURED_PRODUCTS_VARIANTS, ProductsService } from '@admin-services';

import { AuthStore } from '../../../core/stores/auth.store';
import { EntitySelectComponent } from '../../../shared/entity-select/entity-select.component';
import { createProductSource } from '../section-picker-sources';
import { deadIdValidator } from './dead-id.validator';
import type { FeaturedProductsForm } from './build-config-forms';
import { StoreSettingsStore } from '../../../core/stores/store-settings.store';

const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `FEATURED_PRODUCTS` sub-form per DR-04 / DR-05. Drives
 * `ProductRailComponent` on the storefront with the `variant` flag selecting
 * between the horizontal scroll rail and the responsive grid.
 *
 * Phase B10 replaced the paste-a-UUID rows with the shared entity picker
 * (AD14). The form contract is unchanged, `productIds: string[]`.
 *
 * Configured ids are resolved on load and any that no longer exist are marked,
 * blocking save. A hard-deleted product used to leave a dead reference that
 * only showed up on the storefront, and after phase B2 stopped substituting
 * pool content for it, only as an empty rail.
 */
@Component({
  selector: 'app-featured-products-section-editor',
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
      data-testid="featured-products-section-editor"
    >
      <app-form-field label="Eyebrow (optional)" fieldId="featured-products-eyebrow">
        <app-translatable-input
          formControlName="eyebrow"
          label="Eyebrow"
          inputId="featured-products-eyebrow"
          idPrefix="featured-products-eyebrow"
          testId="featured-products-eyebrow"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field label="Heading (optional)" fieldId="featured-products-heading">
        <app-translatable-input
          formControlName="heading"
          label="Heading"
          inputId="featured-products-heading"
          idPrefix="featured-products-heading"
          testId="featured-products-heading"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field label="Layout variant" fieldId="featured-products-variant" [required]="true">
        <select
          id="featured-products-variant"
          class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed"
          formControlName="variant"
          data-testid="featured-products-variant"
        >
          @for (v of variantOptions; track v) {
            <option [value]="v">{{ v }}</option>
          }
        </select>
      </app-form-field>

      <fieldset class="flex flex-col gap-3 border border-line p-4" formArrayName="productIds">
        <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">
          Products (1-12)
        </legend>
        @if (lookupFailed()) {
          <p class="text-xs text-warning" role="status" data-testid="product-id-lookup-failed">
            Could not check the configured products, so the ids below were not verified.
          </p>
        }
        @for (control of productIdsControls(); track $index) {
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <app-form-field
                [label]="'Product ' + ($index + 1)"
                [fieldId]="'product-id-' + $index"
                [required]="true"
              >
                <app-entity-select
                  [id]="'product-id-' + $index"
                  [testId]="'product-id-' + $index"
                  ariaLabel="Product"
                  listboxLabel="Products"
                  placeholder="Search by name or slug"
                  [formControlName]="$index"
                  [source]="productSource"
                />
              </app-form-field>
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="productIdsControls().length <= 1"
                [ariaLabel]="'Remove product ' + ($index + 1)"
                (clicked)="removeAt($index)"
                [attr.data-testid]="'product-id-remove-' + $index"
              >
                Remove
              </app-button>
            </div>
            @if (control.hasError('deadId')) {
              <p
                class="text-xs text-danger"
                role="alert"
                [attr.data-testid]="'product-id-dead-' + $index"
              >
                This product no longer exists. Pick another, or remove the row.
              </p>
            }
          </div>
        }
        <div>
          <app-button
            type="button"
            variant="secondary"
            size="sm"
            [disabled]="productIdsControls().length >= 12"
            ariaLabel="Add another product to the rail"
            (clicked)="addRow()"
            data-testid="product-id-add"
          >
            Add another
          </app-button>
        </div>
      </fieldset>
    </div>
  `,
})
export class FeaturedProductsSectionEditorComponent {
  private readonly fb = inject(FormBuilder);
  private readonly products = inject(ProductsService);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = input.required<FeaturedProductsForm>();
  readonly variantOptions = FEATURED_PRODUCTS_VARIANTS;

  readonly productIdsControls = computed(() => this.form().controls.productIds.controls);

  /**
   * Configured ids the catalogue no longer resolves. Null until the lookup
   * settles. Only the ids present at load are ever checked, so this is a
   * known-dead set, never a known-live one: an id picked after load was never
   * in the batch and must not be condemned for it.
   */
  private readonly deadIds = signal<ReadonlySet<string> | null>(null);

  /**
   * The lookup failed. Surfaced rather than swallowed: an operator who cannot
   * see that the check did not run would read a clean form as "verified".
   */
  protected readonly lookupFailed = signal(false);

  protected readonly productSource = createProductSource(
    this.products,
    () => this.auth.locale(),
    () => this.storeSettings.defaultLocale(),
  );

  /** Guards the one-shot resolve below against an effect re-run. */
  private resolveStarted = false;

  constructor() {
    // `form` is a required input, so it cannot be read in the constructor
    // body: NG8118. The resolve therefore runs in an effect, on the first
    // pass where the input is bound.
    //
    // Unlike categories there is no whole-catalogue fetch to test membership
    // against, so the configured ids are resolved directly. The source treats
    // a 404 as "dead", which is exactly what the lookup needs to know.
    effect(() => {
      const form = this.form();
      if (this.resolveStarted) return;
      this.resolveStarted = true;

      const configured = form.controls.productIds.controls
        .map((c) => c.value)
        .filter((v): v is string => typeof v === 'string' && v.length > 0);

      if (configured.length === 0) {
        this.deadIds.set(new Set());
        return;
      }

      this.productSource.resolve!(configured)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (options) => {
            const resolved = new Set(options.map((o) => o.id));
            this.deadIds.set(new Set(configured.filter((id) => !resolved.has(id))));
            this.lookupFailed.set(false);
          },
          // A failed lookup must not invent dead ids, so an outage cannot
          // block an unrelated save. It is reported instead of swallowed, so
          // the operator knows the ids went unchecked.
          error: () => {
            this.deadIds.set(null);
            this.lookupFailed.set(true);
          },
        });
    });

    effect(() => {
      if (this.deadIds() === null) return;
      for (const control of this.form().controls.productIds.controls) {
        control.addValidators(deadIdValidator(() => this.deadIds()));
        control.updateValueAndValidity({ emitEvent: false });
      }
    });
  }

  addRow(): void {
    const ids = this.form().controls.productIds;
    if (ids.length >= 12) return;
    ids.push(
      this.fb.nonNullable.control('', [
        Validators.required,
        Validators.pattern(ENTITY_ID),
        deadIdValidator(() => this.deadIds()),
      ]),
    );
    ids.markAsDirty();
    this.form().markAsDirty();
  }

  removeAt(index: number): void {
    const ids = this.form().controls.productIds;
    if (ids.length <= 1) return;
    ids.removeAt(index);
    ids.markAsDirty();
    this.form().markAsDirty();
  }
}
