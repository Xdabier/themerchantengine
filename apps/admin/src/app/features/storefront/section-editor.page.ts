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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError, ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TranslatableInputComponent,
} from '@admin-ui';
import {
  StorefrontConfigService,
  sectionTypeSchema,
  type CategoryShowcaseConfig,
  type CreateSectionRequest,
  type FeaturedProductsConfig,
  type HeroSectionConfig,
  type PromotionalBannerConfig,
  type SectionType,
  type StorefrontSection,
  type TrustSignalsConfig,
  type UpdateSectionRequest,
} from '@admin-services';
import {
  CategoryShowcaseSectionEditorComponent,
  FeaturedProductsSectionEditorComponent,
  HeroSectionEditorComponent,
  PromotionalBannerSectionEditorComponent,
  TrustSignalsSectionEditorComponent,
  buildCategoryShowcaseForm,
  buildFeaturedProductsForm,
  buildHeroSectionForm,
  buildPromotionalBannerForm,
  buildTrustSignalsForm,
  type CategoryShowcaseForm,
  type FeaturedProductsForm,
  type HeroSectionForm,
  type PromotionalBannerForm,
  type TrustSignalsForm,
} from './section-editors';
import { sectionTypeLabel } from './storefront.utils';

type ConfigForm =
  | HeroSectionForm
  | PromotionalBannerForm
  | CategoryShowcaseForm
  | FeaturedProductsForm
  | TrustSignalsForm;

/**
 * `/storefront/:pageSlug/sections/new` (create) and
 * `/storefront/sections/:id/edit` (edit) — single-screen editor for a section.
 *
 * Per DR-04 / DR-05 the page dispatches to a per-type Reactive Form
 * sub-component (`HeroSectionEditorComponent`, `PromotionalBannerSectionEditorComponent`,
 * etc.). The common envelope (type, title, sortOrder, visibility window)
 * lives on the parent FormGroup; the type-specific config lives on a child
 * FormGroup built by the matching `build*Form` factory and consumed by the
 * sub-form via an `input.required<...>()` binding. Submit composes the two
 * before calling `StorefrontConfigService`.
 */
@Component({
  selector: 'app-storefront-section-editor-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatableInputComponent,
    HeroSectionEditorComponent,
    PromotionalBannerSectionEditorComponent,
    CategoryShowcaseSectionEditorComponent,
    FeaturedProductsSectionEditorComponent,
    TrustSignalsSectionEditorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="storefront-section-editor-page">
      <header class="flex flex-col gap-3">
        <a
          [routerLink]="backLink()"
          class="text-xs tracking-widest uppercase text-ink-muted hover:text-ink"
          data-testid="storefront-editor-back"
        >
          <span aria-hidden="true">←</span> Back to sections
        </a>
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Section</p>
          <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
            {{ isEdit() ? 'Edit section' : 'New section' }}
          </h1>
        </div>
      </header>

      <div role="alert" aria-live="assertive" data-testid="storefront-editor-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="16rem" width="100%" />
        </div>
      } @else {
        <form
          [formGroup]="envelopeForm"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          <app-form-field label="Type" fieldId="section-type" [required]="true">
            <select
              id="section-type"
              class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed"
              formControlName="type"
              [attr.disabled]="isEdit() ? true : null"
              data-testid="section-type-select"
              (change)="onTypeChange()"
            >
              @for (t of sectionTypes; track t) {
                <option [value]="t">{{ sectionTypeLabel(t) }}</option>
              }
            </select>
          </app-form-field>

          <app-form-field label="Title" fieldId="section-title">
            <app-translatable-input
              formControlName="title"
              label="Title"
              inputId="section-title"
              idPrefix="section-title"
              testId="section-title"
            ></app-translatable-input>
          </app-form-field>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field
              label="Sort order"
              fieldId="section-sort"
              hint="Lower renders first. Leave blank to append."
            >
              <app-input
                id="section-sort"
                type="number"
                formControlName="sortOrder"
                inputmode="numeric"
              ></app-input>
            </app-form-field>
            <div class="flex items-center pt-6">
              <label class="inline-flex items-center gap-3 text-sm tabular">
                <input
                  type="checkbox"
                  formControlName="isVisible"
                  class="h-4 w-4 accent-ink"
                  data-testid="section-visible"
                />
                Visible on storefront
              </label>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field
              label="Visible from"
              fieldId="section-visible-from"
              hint="Optional ISO timestamp."
            >
              <app-input
                id="section-visible-from"
                type="datetime-local"
                formControlName="visibleFrom"
              ></app-input>
            </app-form-field>
            <app-form-field
              label="Visible until"
              fieldId="section-visible-until"
              hint="Optional ISO timestamp."
            >
              <app-input
                id="section-visible-until"
                type="datetime-local"
                formControlName="visibleUntil"
              ></app-input>
            </app-form-field>
          </div>

          <section class="border-t border-line pt-5" data-testid="section-config-pane">
            <h2 class="text-xs tracking-widest uppercase text-ink-muted mb-4">
              {{ sectionTypeLabel(activeType()) }} configuration
            </h2>
            @switch (activeType()) {
              @case ('HERO') {
                @if (heroForm()) {
                  <app-hero-section-editor [form]="heroForm()!" />
                }
              }
              @case ('PROMOTIONAL_BANNER') {
                @if (promotionalBannerForm()) {
                  <app-promotional-banner-section-editor [form]="promotionalBannerForm()!" />
                }
              }
              @case ('CATEGORY_SHOWCASE') {
                @if (categoryShowcaseForm()) {
                  <app-category-showcase-section-editor [form]="categoryShowcaseForm()!" />
                }
              }
              @case ('FEATURED_PRODUCTS') {
                @if (featuredProductsForm()) {
                  <app-featured-products-section-editor [form]="featuredProductsForm()!" />
                }
              }
              @case ('TRUST_SIGNALS') {
                @if (trustSignalsForm()) {
                  <app-trust-signals-section-editor [form]="trustSignalsForm()!" />
                }
              }
            }
          </section>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
          >
            <p class="text-xs tabular text-ink-muted">
              {{ isDirty() ? 'Unsaved changes' : 'No changes' }}
            </p>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy()"
                [routerLink]="backLink()"
                data-testid="section-editor-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="!canSave()"
                [loading]="busy()"
                data-testid="section-editor-save"
              >
                {{ isEdit() ? 'Save changes' : 'Create section' }}
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class StorefrontSectionEditorPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(StorefrontConfigService);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly sectionTypes = sectionTypeSchema.options;
  protected readonly sectionTypeLabel = sectionTypeLabel;

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly pageSlug = signal<string>('');
  readonly sectionId = signal<string | null>(null);
  readonly isEdit = computed(() => this.sectionId() !== null);

  // Per-type config forms — exactly one is populated at a time, switched
  // when the operator changes the type selector in create mode.
  readonly heroForm = signal<HeroSectionForm | null>(null);
  readonly promotionalBannerForm = signal<PromotionalBannerForm | null>(null);
  readonly categoryShowcaseForm = signal<CategoryShowcaseForm | null>(null);
  readonly featuredProductsForm = signal<FeaturedProductsForm | null>(null);
  readonly trustSignalsForm = signal<TrustSignalsForm | null>(null);

  readonly envelopeForm = this.fb.nonNullable.group({
    type: this.fb.nonNullable.control<SectionType>('HERO', Validators.required),
    title: this.fb.nonNullable.control<Record<string, string>>({ default: '' }),
    sortOrder: this.fb.control<number | null>(null),
    isVisible: this.fb.nonNullable.control(true),
    visibleFrom: this.fb.nonNullable.control(''),
    visibleUntil: this.fb.nonNullable.control(''),
  });

  /**
   * `activeType` is a manual signal kept in sync with the envelope `type`
   * control via `(change)` + `hydrate`. A `computed` wrapper around the
   * Reactive Form control would not re-evaluate because `FormControl.value`
   * is not a signal — Angular's signal-forms API is not stable yet on 21.
   */
  readonly activeType = signal<SectionType>('HERO');

  readonly activeConfigForm = computed<ConfigForm | null>(() => {
    switch (this.activeType()) {
      case 'HERO':
        return this.heroForm();
      case 'PROMOTIONAL_BANNER':
        return this.promotionalBannerForm();
      case 'CATEGORY_SHOWCASE':
        return this.categoryShowcaseForm();
      case 'FEATURED_PRODUCTS':
        return this.featuredProductsForm();
      case 'TRUST_SIGNALS':
        return this.trustSignalsForm();
    }
  });

  /**
   * Save-gate as a plain method rather than a `computed` because Angular
   * Reactive Forms expose state as mutable getters rather than signals;
   * a `computed` cache would not invalidate when `form.invalid` flips
   * between calls. Templates call this each CD cycle (OnPush re-checks on
   * form input events), so the live form state always wins.
   */
  canSave(): boolean {
    if (this.busy()) return false;
    const config = this.activeConfigForm();
    if (!config) return false;
    if (this.envelopeForm.invalid) return false;
    if (config.invalid) return false;
    if (!this.envelopeForm.dirty && !config.dirty) return false;
    return true;
  }

  isDirty(): boolean {
    const config = this.activeConfigForm();
    return this.envelopeForm.dirty || (config?.dirty ?? false);
  }

  backLink(): unknown[] {
    const slug = this.pageSlug();
    return slug ? ['/storefront', slug] : ['/storefront'];
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const sectionId = params.get('id');
      if (sectionId) {
        this.sectionId.set(sectionId);
        this.loadSection(sectionId);
      } else {
        const base = params.get('pageSlug') ?? '';
        const rest = params.get('rest');
        const slug = rest ? `${base}/${rest}` : base;
        this.pageSlug.set(slug);
        this.installConfigFormForType('HERO');
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onTypeChange(): void {
    if (this.isEdit()) return;
    const next = this.envelopeForm.controls.type.value as SectionType;
    this.activeType.set(next);
    this.installConfigFormForType(next);
  }

  private installConfigFormForType(type: SectionType, hydrate?: unknown): void {
    this.heroForm.set(null);
    this.promotionalBannerForm.set(null);
    this.categoryShowcaseForm.set(null);
    this.featuredProductsForm.set(null);
    this.trustSignalsForm.set(null);
    switch (type) {
      case 'HERO':
        this.heroForm.set(buildHeroSectionForm(this.fb, hydrate as HeroSectionConfig | undefined));
        break;
      case 'PROMOTIONAL_BANNER':
        this.promotionalBannerForm.set(
          buildPromotionalBannerForm(this.fb, hydrate as PromotionalBannerConfig | undefined),
        );
        break;
      case 'CATEGORY_SHOWCASE':
        this.categoryShowcaseForm.set(
          buildCategoryShowcaseForm(this.fb, hydrate as CategoryShowcaseConfig | undefined),
        );
        break;
      case 'FEATURED_PRODUCTS':
        this.featuredProductsForm.set(
          buildFeaturedProductsForm(this.fb, hydrate as FeaturedProductsConfig | undefined),
        );
        break;
      case 'TRUST_SIGNALS':
        this.trustSignalsForm.set(
          buildTrustSignalsForm(this.fb, hydrate as TrustSignalsConfig | undefined),
        );
        break;
    }
  }

  private loadSection(id: string): void {
    // There's no single-section GET; grab the sections list for every known
    // page and find the one we want. This is a one-shot fetch on open; the
    // seed set is small and the API is wildcard-slug so we scope by id.
    this.loading.set(true);
    this.service.listPages().subscribe({
      next: (pagesRes) => {
        const pages = pagesRes.data;
        const tryPage = (index: number): void => {
          if (index >= pages.length) {
            this.loading.set(false);
            this.error.set('Section not found on any known page.');
            return;
          }
          this.service.listSections(pages[index], { pageSize: 100 }).subscribe({
            next: (res) => {
              const hit = res.data.find((s) => s.id === id);
              if (hit) {
                this.pageSlug.set(pages[index]);
                this.hydrate(hit);
                this.loading.set(false);
              } else tryPage(index + 1);
            },
            // query-error-guard: allow — page walker; a failed page just
            // advances to the next one and the caller reports the outcome.
            error: () => tryPage(index + 1),
          });
        };
        tryPage(0);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  private hydrate(s: StorefrontSection): void {
    this.envelopeForm.patchValue({
      type: s.type,
      title: (s.title as Record<string, string> | null) ?? { default: '' },
      sortOrder: s.sortOrder,
      isVisible: s.isVisible,
      visibleFrom: this.toLocalDatetime(s.visibleFrom ?? null),
      visibleUntil: this.toLocalDatetime(s.visibleUntil ?? null),
    });
    this.activeType.set(s.type);
    this.installConfigFormForType(s.type, s.config);
    this.envelopeForm.markAsPristine();
  }

  save(): void {
    const config = this.activeConfigForm();
    if (!config) return;
    if (config.invalid || this.envelopeForm.invalid) return;

    const envelope = this.envelopeForm.getRawValue();
    const trimmedTitle = this.trimTitle(envelope.title);

    this.busy.set(true);
    this.error.set(null);

    if (this.isEdit()) {
      const body: UpdateSectionRequest = {
        type: this.activeType(),
        config: this.cleanConfig(config.getRawValue()) as never,
        title: trimmedTitle,
        sortOrder: envelope.sortOrder ?? undefined,
        isVisible: envelope.isVisible,
        visibleFrom: this.toIsoOrUndef(envelope.visibleFrom),
        visibleUntil: this.toIsoOrUndef(envelope.visibleUntil),
      } as UpdateSectionRequest;
      this.service.updateSection(this.sectionId()!, body).subscribe({
        next: (s) => {
          this.busy.set(false);
          this.envelopeForm.markAsPristine();
          config.markAsPristine();
          void this.router.navigate(['/storefront', s.pageSlug]);
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(this.formatError(err));
        },
      });
    } else {
      const body: CreateSectionRequest = {
        type: this.activeType(),
        config: this.cleanConfig(config.getRawValue()) as never,
        title: trimmedTitle,
        sortOrder: envelope.sortOrder ?? undefined,
        isVisible: envelope.isVisible,
        visibleFrom: this.toIsoOrUndef(envelope.visibleFrom),
        visibleUntil: this.toIsoOrUndef(envelope.visibleUntil),
      } as CreateSectionRequest;
      this.service.createSection(this.pageSlug(), body).subscribe({
        next: () => {
          this.busy.set(false);
          void this.router.navigate(['/storefront', this.pageSlug()]);
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(this.formatError(err));
        },
      });
    }
  }

  /**
   * Strips optional empty translatable objects (`{ default: '' }`) and empty
   * strings from the raw form value before it is sent to the backend.
   *
   * The backend's class-validator treats `@IsOptional()` as "skip when
   * `null` or `undefined`". An empty-string `ctaHref: ''` or a
   * `{ default: '' }` translatable object still triggers `@IsNotEmpty()` on
   * the nested `default` field — so those must be omitted entirely from the
   * request body rather than sent as empty values.
   */
  private cleanConfig(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === '' || value === null || value === undefined) continue;
      if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>)['default'] === ''
      ) {
        // Only strip if ALL locale keys are empty; if any locale has content, keep the object.
        const allEmpty = Object.values(value as Record<string, string>).every(
          (v) => typeof v === 'string' && v.trim() === '',
        );
        if (allEmpty) continue;
      }
      // FormArray values (productIds, categoryIds, items) and scalar values
      // both pass through unchanged once they survive the empty-string and
      // empty-Translatable filters above.
      out[key] = value;
    }
    return out;
  }

  private trimTitle(
    raw: Record<string, string>,
  ): { default: string; [locale: string]: string } | undefined {
    const entries = Object.entries(raw).filter(([, v]) => v && v.trim().length > 0);
    if (entries.length === 0) return undefined;
    const out: Record<string, string> = Object.fromEntries(entries);
    const defaultValue = out['default'] ?? entries[0][1];
    return { ...out, default: defaultValue };
  }

  private toLocalDatetime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private toIsoOrUndef(local: string): string | undefined {
    if (!local) return undefined;
    const d = new Date(local);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to edit sections.';
    if (err instanceof ApiNotFoundError) return 'Section not found.';
    if (err instanceof ApiValidationError)
      return err.message || 'The request was rejected by the server.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save the section. Please retry.';
  }
}
