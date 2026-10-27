import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  ButtonComponent,
  DropzoneComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TranslatableInputComponent,
  TranslatableRichTextComponent,
  type DropzoneFileRejection,
} from '@admin-ui';
import {
  AssetsService,
  ProductsService,
  type Asset,
  type Attribute,
  type CreateProductRequest,
  type ProductType,
} from '@admin-services';
import {
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  ApiValidationError,
  moneyScaleFactor,
} from '@admin-types';
import { Subject, forkJoin, of, takeUntil } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CurrencyStore } from '../../core/stores/currency.store';
import { MoneyAffixStore } from '../../core/stores/money-affix.store';
import { pickTranslation, type Translatable } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { CategoryPickerComponent } from '../../shared/components/category-picker.component';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';
import { ProductSpecsMatrixComponent } from './product-specs-matrix.component';
import { createSpecLabelSource } from './product-specs.source';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

type TranslatableValue = { default: string; [loc: string]: string };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function typeLabel(pt: ProductType, locale: string, defaultLocale: string): string {
  return pickTranslation(
    pt.name as Translatable | string | null | undefined,
    locale,
    pt.code,
    defaultLocale,
  );
}

function attrLabel(
  a: Pick<Attribute, 'name' | 'code'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    a.name as Translatable | string | null | undefined,
    locale,
    a.code,
    defaultLocale,
  );
}

function valueLabel(
  v: NonNullable<Attribute['values']>[number],
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    v.value as Translatable | string | null | undefined,
    locale,
    v.code,
    defaultLocale,
  );
}

function autoSlug(value: TranslatableValue | null | undefined): string {
  // Seed from `default`, which the editor mirrors from the store's default
  // locale tab. Reading a named locale first pinned slug generation to whichever
  // language that literal happened to name.
  const text = (value?.['default'] ?? '').toString().trim().toLowerCase() || '';
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

@Component({
  selector: 'app-product-create-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    DropzoneComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatableInputComponent,
    TranslatableRichTextComponent,
    CategoryPickerComponent,
    ProductSpecsMatrixComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="product-create-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">
          <a
            routerLink="/products"
            class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            Products
          </a>
          &nbsp;›&nbsp;New
        </p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">New product</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Three steps: pick a product type, describe the product + variants, add media. Submit
          creates the record as draft by default.
        </p>
      </header>

      <ol
        class="flex items-center gap-3 flex-wrap"
        aria-label="Create product progress"
        data-testid="product-create-steps"
      >
        @for (s of steps; track s.index) {
          <li
            class="flex items-center gap-3"
            [attr.aria-current]="step() === s.index ? 'step' : null"
          >
            <div
              class="w-7 h-7 flex items-center justify-center border tabular text-xs"
              [class.border-ink]="step() === s.index"
              [class.text-ink]="step() === s.index"
              [class.border-line]="step() !== s.index"
              [class.text-ink-muted]="step() !== s.index"
              [attr.data-testid]="'product-create-step-indicator-' + s.index"
            >
              {{ s.index + 1 }}
            </div>
            <span
              class="text-xs tracking-widest uppercase"
              [class.text-ink]="step() === s.index"
              [class.text-ink-muted]="step() !== s.index"
            >
              {{ s.label }}
            </span>
          </li>
        }
      </ol>

      <div role="status" aria-live="polite" data-testid="product-create-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="flex flex-col gap-8 max-w-3xl"
        novalidate
      >
        @if (step() === 0) {
          <section class="flex flex-col gap-4" aria-label="Pick product type">
            <app-form-field
              label="Product type"
              fieldId="product-create-type"
              [required]="true"
              hint="Defines which attributes the variants will expose."
            >
              @if (loadingTypes()) {
                <app-skeleton height="2.75rem" />
              } @else if (productTypes().length === 0) {
                <p class="text-xs tabular text-status-warning">
                  No product types yet. Create one at
                  <a
                    routerLink="/settings/product-types"
                    class="underline hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                    >Settings › Product types</a
                  >
                  first.
                </p>
              } @else {
                <div class="flex flex-col gap-2" role="radiogroup" aria-label="Product type">
                  @for (pt of productTypes(); track pt.id; let idx = $index) {
                    <button
                      type="button"
                      role="radio"
                      class="text-left border px-4 py-3 flex flex-col gap-1 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      [class.border-ink]="form.controls.productTypeId.value === pt.id"
                      [class.border-line]="form.controls.productTypeId.value !== pt.id"
                      [attr.aria-checked]="form.controls.productTypeId.value === pt.id"
                      [attr.tabindex]="radioTabIndex(pt.id, idx)"
                      [attr.data-testid]="'product-create-type-option-' + pt.id"
                      (click)="selectProductType(pt)"
                      (keydown)="onRadioKeydown($event, idx)"
                    >
                      <span class="text-sm text-ink">{{ typeLabel(pt) }}</span>
                      <span class="tabular text-xs text-ink-muted">{{ pt.code }}</span>
                    </button>
                  }
                </div>
              }
            </app-form-field>
          </section>
        }

        @if (step() === 1) {
          <section class="flex flex-col gap-5" aria-label="Product details and variants">
            <app-form-field label="Name" fieldId="product-create-name" [required]="true">
              <app-translatable-input
                formControlName="name"
                label="Name"
                inputId="product-create-name"
                idPrefix="product-create-name"
                testId="product-create-name"
              ></app-translatable-input>
            </app-form-field>

            <app-form-field
              label="Slug"
              fieldId="product-create-slug"
              [error]="slugError()"
              [required]="true"
              hint="Lowercase letters, digits, hyphens only. Used in the public URL."
            >
              <app-input
                id="product-create-slug"
                type="text"
                formControlName="slug"
                [invalid]="!!slugError()"
              ></app-input>
            </app-form-field>

            <app-form-field label="Short description" fieldId="product-create-short-description">
              <app-translatable-input
                formControlName="shortDescription"
                label="Short description"
                inputId="product-create-short-description"
                idPrefix="product-create-short-description"
                testId="product-create-short-description"
                [multiline]="true"
              ></app-translatable-input>
            </app-form-field>

            <app-form-field label="Brand" fieldId="product-create-brand">
              <app-input id="product-create-brand" type="text" formControlName="brand"></app-input>
            </app-form-field>

            <app-category-picker
              testId="product-create-categories"
              [selectedIds]="selectedCategoryList()"
              (selectionChange)="onCategorySelectionChange($event)"
            />

            <fieldset class="border border-line p-4">
              <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">
                Specifications
              </legend>
              <p class="text-xs tabular text-ink-muted mb-3">
                Optional. They ship with the product, so a new product can be filed complete rather
                than needing a second pass on the edit screen.
              </p>
              <app-product-specs-matrix [labelSource]="specLabelSource" />
            </fieldset>

            <section
              class="flex flex-col gap-4 border border-line p-4"
              aria-label="Variants"
              formArrayName="variants"
            >
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 class="text-sm tracking-widest uppercase text-ink">Variants</h2>
                  <p class="text-xs tabular text-ink-muted">
                    At least one variant is required. The first row is marked as default.
                  </p>
                </div>
                <app-button
                  type="button"
                  variant="secondary"
                  size="sm"
                  (clicked)="addVariant()"
                  data-testid="product-create-variant-add"
                >
                  Add variant
                </app-button>
              </div>

              @for (row of variantsArray.controls; track $index; let i = $index) {
                <div
                  class="border border-line p-3 flex flex-col gap-3"
                  [formGroupName]="i"
                  [attr.data-testid]="'product-create-variant-' + i"
                >
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <app-form-field
                      [label]="'SKU'"
                      [fieldId]="'product-create-variant-' + i + '-sku'"
                      [required]="true"
                    >
                      <app-input
                        [id]="'product-create-variant-' + i + '-sku'"
                        type="text"
                        formControlName="sku"
                      ></app-input>
                    </app-form-field>
                    <app-form-field
                      [label]="'Price'"
                      [fieldId]="'product-create-variant-' + i + '-price'"
                      [required]="true"
                      [hint]="amountHint()"
                    >
                      <app-input
                        [id]="'product-create-variant-' + i + '-price'"
                        type="number"
                        inputmode="decimal"
                        [step]="moneyStep()"
                        formControlName="price"
                        [prefix]="moneyPrefix()"
                        [suffix]="moneySuffix()"
                      ></app-input>
                    </app-form-field>
                  </div>

                  @if (attributesForType().length > 0) {
                    <div class="flex flex-col gap-2">
                      <p class="text-xs tracking-widest uppercase text-ink-muted">
                        Attribute values
                      </p>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        @for (a of attributesForType(); track a.id) {
                          <app-form-field
                            [label]="attrLabel(a)"
                            [fieldId]="'product-create-variant-' + i + '-attr-' + a.id"
                          >
                            <select
                              [id]="'product-create-variant-' + i + '-attr-' + a.id"
                              class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                              [value]="variantAttrValue(i, a.id) ?? ''"
                              (change)="onAttrValueChange($event, i, a.id)"
                              [attr.data-testid]="'product-create-variant-' + i + '-attr-' + a.id"
                            >
                              <option value="">— None —</option>
                              @for (v of a.values ?? []; track v.id) {
                                <option
                                  [value]="v.id"
                                  [selected]="v.id === variantAttrValue(i, a.id)"
                                >
                                  {{ valueLabel(v) }}
                                </option>
                              }
                            </select>
                          </app-form-field>
                        }
                      </div>
                    </div>
                  }

                  @if (variantsArray.length > 1) {
                    <div class="flex items-center justify-end">
                      <app-button
                        type="button"
                        variant="ghost"
                        size="sm"
                        (clicked)="removeVariant(i)"
                        [attr.data-testid]="'product-create-variant-remove-' + i"
                      >
                        Remove variant
                      </app-button>
                    </div>
                  }
                </div>
              }
            </section>
          </section>
        }

        @if (step() === 2) {
          <section class="flex flex-col gap-5" aria-label="Media and description">
            <app-form-field
              label="Media"
              fieldId="product-create-media"
              hint="Drag-drop or click to browse. Images and video are accepted."
            >
              <app-dropzone
                testId="product-create-media-dropzone"
                [multiple]="true"
                (filesAdded)="onFilesAdded($event)"
                (filesRejected)="onFilesRejected($event)"
              ></app-dropzone>
            </app-form-field>

            @if (uploadedAssets().length > 0) {
              <ul
                class="grid grid-cols-2 sm:grid-cols-4 gap-3"
                aria-label="Uploaded media"
                data-testid="product-create-uploaded-assets"
              >
                @for (a of uploadedAssets(); track a.id) {
                  <li class="border border-line p-2 flex items-center justify-center">
                    <span class="tabular text-xs text-ink-muted truncate" [title]="a.id">
                      {{ a.id }}
                    </span>
                  </li>
                }
              </ul>
            }

            <app-form-field
              label="Long description"
              fieldId="product-create-description"
              hint="Rich text. Only safe formatting (headings, lists, links) is retained."
            >
              <app-translatable-rich-text
                formControlName="description"
                label="Long description"
                idPrefix="product-create-description"
                inputId="product-create-description"
                testId="product-create-description"
              ></app-translatable-rich-text>
            </app-form-field>

            <app-form-field label="Meta title" fieldId="product-create-meta-title">
              <app-translatable-input
                formControlName="metaTitle"
                label="Meta title"
                inputId="product-create-meta-title"
                idPrefix="product-create-meta-title"
                testId="product-create-meta-title"
              ></app-translatable-input>
            </app-form-field>

            <app-form-field label="Meta description" fieldId="product-create-meta-description">
              <app-translatable-input
                formControlName="metaDescription"
                label="Meta description"
                inputId="product-create-meta-description"
                idPrefix="product-create-meta-description"
                testId="product-create-meta-description"
                [multiline]="true"
              ></app-translatable-input>
            </app-form-field>
          </section>
        }

        <footer class="flex items-center justify-between gap-3 flex-wrap">
          <app-button
            type="button"
            variant="ghost"
            size="md"
            [disabled]="step() === 0 || busy()"
            (clicked)="prevStep()"
            data-testid="product-create-step-back"
          >
            Back
          </app-button>
          @if (step() < 2) {
            <app-button
              type="button"
              variant="primary"
              size="md"
              [disabled]="!canAdvance() || busy()"
              (clicked)="nextStep()"
              data-testid="product-create-step-next"
            >
              Next
            </app-button>
          } @else {
            <app-button
              type="submit"
              variant="primary"
              size="md"
              [disabled]="form.invalid || busy()"
              [loading]="busy()"
              data-testid="product-create-submit"
            >
              Create product
            </app-button>
          }
        </footer>
      </form>
    </section>
  `,
})
export class ProductCreatePage implements OnInit, OnDestroy {
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly products = inject(ProductsService);
  private readonly assets = inject(AssetsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  /**
   * Step the money fields by the store currency's own scale. The atom defaulted
   * to `step=1`, so under a three-decimal currency a legal price could not be
   * typed at all.
   */
  protected readonly moneyStep = computed(
    () => 1 / moneyScaleFactor(this.currencyStore.decimalPlaces()),
  );

  private readonly currencyStore = inject(CurrencyStore);

  /** Suffix for the money fields. Empty while the store currency is unknown. */
  protected readonly storeCode = this.currencyStore.code;
  /** The configured symbol and the side the store writes it on. */
  private readonly moneyAffix = inject(MoneyAffixStore);
  protected readonly moneyPrefix = this.moneyAffix.prefix;
  protected readonly moneySuffix = this.moneyAffix.suffix;

  /** The suffix is aria-hidden decoration; the hint is what screen readers get. */
  protected amountHint(): string {
    const code = this.storeCode();
    return code ? `Amount in ${code}.` : '';
  }
  private readonly destroy$ = new Subject<void>();

  protected readonly typeLabel = (pt: ProductType): string =>
    typeLabel(pt, this.authStore.locale(), this.storeSettings.defaultLocale());
  protected readonly attrLabel = (a: Pick<Attribute, 'name' | 'code'>): string =>
    attrLabel(a, this.authStore.locale(), this.storeSettings.defaultLocale());
  protected readonly valueLabel = (v: NonNullable<Attribute['values']>[number]): string =>
    valueLabel(v, this.authStore.locale(), this.storeSettings.defaultLocale());

  readonly steps: ReadonlyArray<{ index: number; label: string }> = [
    { index: 0, label: 'Product type' },
    { index: 1, label: 'Details & variants' },
    { index: 2, label: 'Media & description' },
  ];

  readonly step = signal(0);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadingTypes = signal(true);
  readonly productTypes = signal<readonly ProductType[]>([]);
  readonly attributesForType = signal<readonly Attribute[]>([]);
  readonly uploadedAssets = signal<readonly Asset[]>([]);
  /**
   * Categories live outside the form group: they are not a Reactive-Forms
   * control, and the create payload carries them only when non-empty.
   */
  readonly specsMatrix = viewChild(ProductSpecsMatrixComponent);
  readonly specLabelSource = createSpecLabelSource(
    this.products,
    () => this.authStore.locale(),
    () => this.storeSettings.defaultLocale(),
  );

  readonly selectedCategoryIds = signal<ReadonlySet<string>>(new Set());
  readonly selectedCategoryList = computed(() => [...this.selectedCategoryIds()]);

  readonly form = this.fb.group({
    productTypeId: this.fb.control<string | null>(null, [Validators.required]),
    name: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [translatableRequired]),
    slug: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(SLUG_RE)]),
    shortDescription: this.fb.control<TranslatableValue | null>(null),
    brand: this.fb.control<string | null>(null),
    description: this.fb.control<TranslatableValue | null>(null),
    metaTitle: this.fb.control<TranslatableValue | null>(null),
    metaDescription: this.fb.control<TranslatableValue | null>(null),
    variants: this.fb.array([this.makeVariantGroup()]),
  });

  onCategorySelectionChange(ids: readonly string[]): void {
    this.selectedCategoryIds.set(new Set(ids));
  }

  /**
   * Specification rows worth sending.
   *
   * A blank row is what the grid looks like the moment Add is pressed, so
   * submitting one would 400 on a label whose folded key is empty. Dropping
   * incomplete rows keeps an abandoned row from blocking the whole create.
   */
  private filledSpecs(): Array<{ label: Translatable; value: Translatable }> {
    const matrix = this.specsMatrix();
    if (!matrix) return [];
    return matrix.toSpecs().filter((row) => row.label.default && row.value.default);
  }

  get variantsArray(): FormArray<FormGroup> {
    return this.form.controls.variants as FormArray<FormGroup>;
  }

  canAdvance(): boolean {
    if (this.step() === 0) return !!this.form.controls.productTypeId.value;
    if (this.step() === 1) {
      const stepFields = [this.form.controls.name, this.form.controls.slug, this.variantsArray];
      return stepFields.every((c) => c.valid);
    }
    return true;
  }

  ngOnInit(): void {
    this.loadingTypes.set(true);
    this.products
      .listProductTypes({ pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.productTypes.set(res.data);
          this.loadingTypes.set(false);
        },
        error: (err: unknown) => {
          this.loadingTypes.set(false);
          this.error.set(this.formatError(err));
        },
      });

    this.form.controls.name.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((value) => {
      const slugCtrl = this.form.controls.slug;
      if (!slugCtrl.dirty) slugCtrl.setValue(autoSlug(value), { emitEvent: false });
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  radioTabIndex(id: string, idx: number): number {
    const selected = this.form.controls.productTypeId.value;
    if (selected) return selected === id ? 0 : -1;
    return idx === 0 ? 0 : -1;
  }

  onRadioKeydown(event: KeyboardEvent, idx: number): void {
    const types = this.productTypes();
    if (types.length === 0) return;
    let next = idx;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = (idx + 1) % types.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = (idx - 1 + types.length) % types.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = types.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const pt = types[next];
    this.selectProductType(pt);
    const host = (event.currentTarget as HTMLElement).parentElement;
    const target = host?.children.item(next) as HTMLElement | null;
    target?.focus();
  }

  selectProductType(pt: ProductType): void {
    this.form.controls.productTypeId.setValue(pt.id);
    forkJoin({
      attrs: this.products
        .listAttributes({ productTypeId: pt.id, pageSize: 100 })
        .pipe(
          catchError(() =>
            of({ data: [] as Attribute[], meta: { page: 1, pageSize: 0, total: 0 } }),
          ),
        ),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ attrs }) => {
        this.attributesForType.set(attrs.data);
        this.resetVariantAttributes();
      });
  }

  nextStep(): void {
    if (!this.canAdvance()) {
      this.form.markAllAsTouched();
      return;
    }
    this.step.update((s) => Math.min(s + 1, 2));
  }

  prevStep(): void {
    this.step.update((s) => Math.max(s - 1, 0));
  }

  addVariant(): void {
    this.variantsArray.push(this.makeVariantGroup());
  }

  removeVariant(index: number): void {
    if (this.variantsArray.length <= 1) return;
    this.variantsArray.removeAt(index);
  }

  variantAttrValue(variantIndex: number, attributeId: string): string | null {
    const group = this.variantsArray.at(variantIndex);
    const map = group.get('attributeValueMap')?.value as Record<string, string> | undefined;
    return map ? (map[attributeId] ?? null) : null;
  }

  onAttrValueChange(event: Event, variantIndex: number, attributeId: string): void {
    const value = (event.target as HTMLSelectElement).value;
    const group = this.variantsArray.at(variantIndex);
    const mapCtrl = group.get('attributeValueMap');
    const current = ((mapCtrl?.value as Record<string, string> | null) ?? {}) as Record<
      string,
      string
    >;
    const next = { ...current };
    if (value) next[attributeId] = value;
    else delete next[attributeId];
    mapCtrl?.setValue(next);
  }

  slugError(): string | null {
    const c = this.form.controls.slug;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Slug is required.';
    if (c.hasError('pattern')) return 'Slug must be lowercase letters, digits, and hyphens.';
    return null;
  }

  onFilesAdded(files: File[]): void {
    for (const file of files) {
      this.assets
        .upload(file)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (asset) => this.uploadedAssets.update((list) => [...list, asset]),
          error: (err: unknown) => this.error.set(this.formatError(err)),
        });
    }
  }

  onFilesRejected(rejections: DropzoneFileRejection[]): void {
    if (rejections.length === 0) return;
    this.error.set(
      `Rejected ${rejections.length} file(s): ${rejections
        .map((r) => `${r.file.name} (${r.reason})`)
        .join(', ')}.`,
    );
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;

    const raw = this.form.getRawValue();
    if (!raw.productTypeId) return;

    const variants = (raw.variants as Array<Record<string, unknown>>).map((row, idx) => {
      const map = (row['attributeValueMap'] as Record<string, string> | null) ?? {};
      const attributeValueIds = Object.values(map).filter((id): id is string => !!id);
      const sku = String(row['sku'] ?? '').trim();
      const price = Number(row['price']);
      return {
        sku,
        price,
        isDefault: idx === 0,
        isActive: true,
        ...(attributeValueIds.length > 0 ? { attributeValueIds } : {}),
      };
    });

    const body: CreateProductRequest = {
      name: raw.name,
      slug: raw.slug.trim(),
      productTypeId: raw.productTypeId,
      ...(raw.shortDescription ? { shortDescription: raw.shortDescription } : {}),
      ...(raw.brand ? { brand: raw.brand } : {}),
      ...(raw.description ? { description: raw.description } : {}),
      ...(raw.metaTitle ? { metaTitle: raw.metaTitle } : {}),
      ...(raw.metaDescription ? { metaDescription: raw.metaDescription } : {}),
      ...(this.selectedCategoryIds().size > 0
        ? { categoryIds: [...this.selectedCategoryIds()] }
        : {}),
      ...(this.filledSpecs().length > 0 ? { specs: this.filledSpecs() } : {}),
      ...(this.uploadedAssets().length > 0
        ? { assetIds: this.uploadedAssets().map((a) => a.id) }
        : {}),
      variants,
    };

    this.busy.set(true);
    this.error.set(null);
    this.products.createProduct(body).subscribe({
      next: (product) => {
        this.busy.set(false);
        void this.router.navigate(['/products', product.id, 'edit']);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
        if (this.isStepError(err, 'name') || this.isStepError(err, 'slug')) {
          this.step.set(1);
        } else if (this.isStepError(err, 'productTypeId')) {
          this.step.set(0);
        }
      },
    });
  }

  private makeVariantGroup(): FormGroup {
    return this.fb.group({
      sku: this.fb.nonNullable.control('', [Validators.required]),
      price: this.fb.nonNullable.control<number | null>(null, [
        Validators.required,
        Validators.min(0),
      ]),
      attributeValueMap: this.fb.nonNullable.control<Record<string, string>>({}),
    });
  }

  private resetVariantAttributes(): void {
    for (const group of this.variantsArray.controls) {
      group.get('attributeValueMap')?.setValue({});
    }
  }

  private isStepError(err: unknown, field: string): boolean {
    if (!(err instanceof ApiValidationError)) return false;
    const details = (err.details as { path?: string[] } | Array<{ path?: string[] }>) ?? [];
    const arr = Array.isArray(details) ? details : [details];
    return arr.some((d) => Array.isArray(d.path) && d.path.includes(field));
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to create products.';
    if (err instanceof ApiNotFoundError) return 'Product not found.';
    if (err instanceof ApiError) {
      if (err.status === 413) return 'A file exceeds the upload size limit.';
      if (err.status === 415) return 'A file has an unsupported MIME type.';
      if (err.message) return err.message;
    }
    return 'Could not create the product. Please review the form and retry.';
  }
}
