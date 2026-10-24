import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  TranslatableInputComponent,
  TranslatableRichTextComponent,
  type TranslatableValue,
} from '@admin-ui';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  CmsService,
  type CmsPage,
  type CmsPageType,
  type CreatePageRequest,
  type UpdatePageRequest,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';

const SLUG_REGEX = /^\/[a-z0-9-]+$/;

function slugFormat(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return SLUG_REGEX.test(value) ? null : { slugFormat: true };
}

function leadingSlash(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.startsWith('/') ? null : { leadingSlash: true };
}

function richTextRequired(control: AbstractControl): ValidationErrors | null {
  const value = control.value as TranslatableValue | null;
  if (!value) return { richTextRequired: true };
  const def = typeof value.default === 'string' ? value.default : '';
  const stripped = def.replace(/<[^>]+>/g, '').trim();
  return stripped.length > 0 ? null : { richTextRequired: true };
}

@Component({
  selector: 'app-cms-page-editor-page',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    TranslatableInputComponent,
    TranslatableRichTextComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="cms-page-editor-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/pages" class="hover:underline">Pages</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">{{ isEditMode() ? 'Edit' : 'New' }}</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Content</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
          {{ isEditMode() ? 'Edit page' : 'Create page' }}
        </h1>
        <p class="mt-3 text-sm text-ink-muted">
          Custom content served by slug. Slugs must start with
          <code class="font-mono text-ink">/</code>
          and use lowercase letters, digits, and hyphens only.
        </p>
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="cms-page-top-error"
        [class.border]="!!topError()"
        [class.border-status-error]="!!topError()"
        [class.text-ink]="!!topError()"
        [class.p-3]="!!topError()"
      >
        {{ topError() ?? '' }}
      </p>

      @if (loadingInitial()) {
        <p role="status" aria-live="polite" class="text-sm text-ink-muted">Loading…</p>
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="flex flex-col gap-6 border border-line bg-surface p-6 md:p-8 max-w-3xl"
          novalidate
        >
          <app-form-field
            label="Slug"
            [fieldId]="slugId"
            [error]="slugError()"
            [hint]="isEditMode() ? 'Slug cannot be changed after creation.' : 'Example: /about'"
            [required]="!isEditMode()"
          >
            <app-input
              [id]="slugId"
              formControlName="slug"
              placeholder="/about"
              autocomplete="off"
              [invalid]="!!slugError()"
              data-testid="cms-page-slug"
            />
          </app-form-field>

          <app-form-field
            label="Page type"
            [fieldId]="typeId"
            hint="STATIC for marketing/about pages, POLICY for legal, LANDING for campaigns."
          >
            <select
              [id]="typeId"
              [attr.aria-describedby]="typeId + '-hint'"
              formControlName="type"
              class="min-h-[44px] w-full md:w-64 px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="cms-page-type"
            >
              <option value="STATIC">Static</option>
              <option value="POLICY">Policy</option>
              <option value="LANDING">Landing</option>
            </select>
          </app-form-field>

          <app-form-field
            label="Title"
            [fieldId]="titleId"
            [error]="titleError()"
            hint="Default locale is required; other locales fall back to default."
            [required]="true"
          >
            <app-translatable-input
              [inputId]="titleId"
              testId="cms-page-title"
              idPrefix="cms-page-title"
              label="Page title"
              formControlName="title"
              [invalid]="!!titleError()"
            />
          </app-form-field>

          <app-form-field
            label="Content"
            [fieldId]="contentId"
            [error]="contentError()"
            hint="Rich text with a constrained tag allow-list."
            [required]="true"
          >
            <app-translatable-rich-text
              [inputId]="contentId"
              testId="cms-page-content"
              idPrefix="cms-page-content"
              label="Page content"
              formControlName="content"
              [invalid]="!!contentError()"
            />
          </app-form-field>

          <app-form-field
            label="Meta title"
            [fieldId]="metaTitleId"
            hint="Shown in browser tabs and SERP results. Falls back to the page title when empty."
          >
            <app-translatable-input
              [inputId]="metaTitleId"
              testId="cms-page-meta-title"
              idPrefix="cms-page-meta-title"
              label="Meta title"
              formControlName="metaTitle"
            />
          </app-form-field>

          <app-form-field
            label="Meta description"
            [fieldId]="metaDescId"
            hint="Shown in search-engine previews. 155 characters or fewer reads best."
          >
            <app-translatable-input
              [inputId]="metaDescId"
              testId="cms-page-meta-description"
              idPrefix="cms-page-meta-description"
              label="Meta description"
              [multiline]="true"
              [rows]="3"
              formControlName="metaDescription"
            />
          </app-form-field>

          <div class="grid gap-4 md:grid-cols-3">
            <app-form-field
              label="Sort order"
              [fieldId]="sortId"
              hint="Integer ≥ 0. Lower sorts first."
            >
              <app-input
                [id]="sortId"
                type="number"
                formControlName="sortOrder"
                data-testid="cms-page-sort"
              />
            </app-form-field>

            <app-form-field
              label="Template"
              [fieldId]="templateId"
              hint="Optional storefront template id."
            >
              <app-input
                [id]="templateId"
                formControlName="template"
                autocomplete="off"
                data-testid="cms-page-template"
              />
            </app-form-field>
          </div>

          <div class="flex flex-col gap-3">
            <label class="inline-flex items-center gap-3 min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                formControlName="isPublished"
                class="h-5 w-5 border border-line bg-surface"
                data-testid="cms-page-published"
              />
              <span class="text-sm text-ink">Published</span>
            </label>
            <label class="inline-flex items-center gap-3 min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                formControlName="showInNavigation"
                class="h-5 w-5 border border-line bg-surface"
                data-testid="cms-page-show-in-nav"
              />
              <span class="text-sm text-ink">Show in storefront navigation</span>
            </label>
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <a
              routerLink="/pages"
              class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-5 py-3 text-sm min-h-[44px]"
              data-testid="cms-page-cancel"
            >
              Cancel
            </a>
            <app-button
              type="submit"
              [disabled]="form.invalid || form.pristine || saving()"
              [loading]="saving()"
              data-testid="cms-page-submit"
            >
              {{ isEditMode() ? 'Save changes' : 'Create page' }}
            </app-button>
          </div>
        </form>
      }
    </section>
  `,
})
export class CmsPageEditorPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cms = inject(CmsService);
  private readonly destroy$ = new Subject<void>();

  readonly slugId = 'cms-page-slug';
  readonly typeId = 'cms-page-type';
  readonly titleId = 'cms-page-title';
  readonly contentId = 'cms-page-content';
  readonly metaTitleId = 'cms-page-meta-title';
  readonly metaDescId = 'cms-page-meta-description';
  readonly sortId = 'cms-page-sort';
  readonly templateId = 'cms-page-template';

  readonly editingId = signal<string | null>(null);
  readonly isEditMode = computed(() => this.editingId() !== null);
  readonly saving = signal(false);
  readonly loadingInitial = signal(false);
  readonly topError = signal<string | null>(null);
  readonly conflict = signal(false);

  readonly form = this.fb.nonNullable.group({
    slug: ['', [Validators.required, Validators.maxLength(200), leadingSlash, slugFormat]],
    type: this.fb.nonNullable.control<CmsPageType>('STATIC'),
    title: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [translatableRequired]),
    content: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [richTextRequired]),
    metaTitle: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    metaDescription: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    sortOrder: this.fb.nonNullable.control<number>(0, [Validators.min(0)]),
    showInNavigation: this.fb.nonNullable.control<boolean>(false),
    isPublished: this.fb.nonNullable.control<boolean>(false),
    template: this.fb.nonNullable.control<string>('', [Validators.maxLength(100)]),
  });

  slugError(): string | null {
    const c = this.form.controls.slug;
    if (this.conflict()) return 'A page with this slug already exists.';
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('required')) return 'Slug is required.';
    if (c.hasError('leadingSlash')) return 'Must start with /';
    if (c.hasError('slugFormat')) return 'Use lowercase letters, digits, and hyphens only.';
    if (c.hasError('maxlength')) return 'Must be 200 characters or fewer.';
    return null;
  }

  titleError(): string | null {
    const c = this.form.controls.title;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('translatableRequired')) return 'Default-locale title is required.';
    return null;
  }

  contentError(): string | null {
    const c = this.form.controls.content;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('richTextRequired')) return 'Default-locale content is required.';
    return null;
  }

  ngOnInit(): void {
    this.form.controls.slug.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.conflict()) this.conflict.set(false);
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editingId.set(id);
      this.loadingInitial.set(true);
      this.cms
        .list({ pageSize: 100 })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            const match = res.data.find((p) => p.id === id);
            if (!match) {
              this.loadingInitial.set(false);
              this.topError.set('Page not found.');
              return;
            }
            this.populateForm(match);
            this.form.controls.slug.disable({ emitEvent: false });
            this.loadingInitial.set(false);
          },
          error: (err: unknown) => {
            this.loadingInitial.set(false);
            this.topError.set(this.formatError(err));
          },
        });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      queueMicrotask(() => this.focusFirstInvalid());
      return;
    }
    this.saving.set(true);
    this.topError.set(null);
    const id = this.editingId();
    const raw = this.form.getRawValue();

    if (id) {
      const patch: UpdatePageRequest = {
        type: raw.type,
        title: raw.title,
        content: raw.content,
        isPublished: raw.isPublished,
        showInNavigation: raw.showInNavigation,
        sortOrder: raw.sortOrder,
        ...(this.hasTranslatable(raw.metaTitle) ? { metaTitle: raw.metaTitle } : {}),
        ...(this.hasTranslatable(raw.metaDescription)
          ? { metaDescription: raw.metaDescription }
          : {}),
        ...(raw.template.trim() ? { template: raw.template.trim() } : {}),
      };
      this.cms
        .update(id, patch)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.saving.set(false);
            void this.router.navigate(['/pages']);
          },
          error: (err: unknown) => {
            this.saving.set(false);
            this.topError.set(this.formatError(err));
          },
        });
      return;
    }

    const payload: CreatePageRequest = {
      slug: raw.slug.trim(),
      type: raw.type,
      title: raw.title,
      content: raw.content,
      isPublished: raw.isPublished,
      showInNavigation: raw.showInNavigation,
      sortOrder: raw.sortOrder,
      ...(this.hasTranslatable(raw.metaTitle) ? { metaTitle: raw.metaTitle } : {}),
      ...(this.hasTranslatable(raw.metaDescription)
        ? { metaDescription: raw.metaDescription }
        : {}),
      ...(raw.template.trim() ? { template: raw.template.trim() } : {}),
    };
    this.cms
      .create(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.saving.set(false);
          void this.router.navigate(['/pages']);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          if (err instanceof ApiConflictError) {
            this.conflict.set(true);
            this.form.controls.slug.setErrors({ conflict: true });
            this.form.controls.slug.markAsTouched();
            queueMicrotask(() => document.getElementById(this.slugId)?.focus());
            return;
          }
          this.topError.set(this.formatError(err));
        },
      });
  }

  private hasTranslatable(value: TranslatableValue): boolean {
    return typeof value?.default === 'string' && value.default.trim().length > 0;
  }

  private populateForm(page: CmsPage): void {
    this.form.patchValue({
      slug: page.slug,
      type: page.type,
      title: page.title,
      content: page.content,
      metaTitle: page.metaTitle ?? { default: '' },
      metaDescription: page.metaDescription ?? { default: '' },
      sortOrder: page.sortOrder ?? 0,
      showInNavigation: page.showInNavigation ?? false,
      isPublished: page.isPublished ?? false,
      template: page.template ?? '',
    });
    this.form.markAsPristine();
  }

  private focusFirstInvalid(): void {
    const order: Array<[string, AbstractControl]> = [
      [this.slugId, this.form.controls.slug],
      [this.typeId, this.form.controls.type],
      [this.titleId, this.form.controls.title],
      [this.contentId, this.form.controls.content],
      [this.sortId, this.form.controls.sortOrder],
      [this.templateId, this.form.controls.template],
    ];
    for (const [id, control] of order) {
      if (control.invalid) {
        document.getElementById(id)?.focus();
        return;
      }
    }
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage pages.';
    if (err instanceof ApiNotFoundError) return 'Page not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save the page. Please retry.';
  }
}
