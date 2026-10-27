import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import { ApiConflictError, ApiForbiddenError, ApiError } from '@admin-types';
import { SeoService, type RedirectType } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';

const SAFE_PATH = /^\/(?!\/|\\)/;

function leadingSlash(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) return null;
  return SAFE_PATH.test(value) ? null : { leadingSlash: true };
}

@Component({
  selector: 'app-seo-redirect-new-page',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="seo-redirect-new-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/seo/redirects" class="hover:underline">Redirects</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">New</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">SEO</p>
        <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">Create redirect</h1>
        <p class="mt-3 text-sm text-ink-muted">
          Route an old URL to a new one. Both paths must begin with
          <code class="font-mono text-ink">/</code>.
        </p>
      </header>

      @if (topError()) {
        <p
          class="text-xs p-3 border border-status-error text-ink"
          role="alert"
          data-testid="seo-redirect-top-error"
        >
          {{ topError() }}
        </p>
      }

      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="flex flex-col gap-6 border border-line bg-surface p-6 md:p-8 max-w-2xl"
        novalidate
      >
        <app-form-field
          label="From path"
          [fieldId]="fromId"
          [error]="fromError()"
          hint="The old URL path that should redirect."
          [required]="true"
        >
          <app-input
            [id]="fromId"
            formControlName="fromPath"
            placeholder="/old"
            autocomplete="off"
            [invalid]="!!fromError()"
            data-testid="seo-redirect-from"
          />
        </app-form-field>

        <app-form-field
          label="To path"
          [fieldId]="toId"
          [error]="toError()"
          hint="The destination path."
          [required]="true"
        >
          <app-input
            [id]="toId"
            formControlName="toPath"
            placeholder="/new"
            autocomplete="off"
            [invalid]="!!toError()"
            data-testid="seo-redirect-to"
          />
        </app-form-field>

        <app-form-field
          label="Redirect type"
          [fieldId]="typeId"
          hint="301 is permanent and preferred for SEO; 302 is temporary."
        >
          <select
            [id]="typeId"
            formControlName="type"
            class="min-h-[44px] w-full md:w-64 px-3 py-2 bg-surface border border-line text-ink text-sm tabular focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            data-testid="seo-redirect-type"
          >
            <option value="MOVED_PERMANENTLY">301 — Moved Permanently</option>
            <option value="FOUND">302 — Found</option>
          </select>
        </app-form-field>

        <div class="flex items-center justify-end gap-3 pt-2">
          <a
            routerLink="/seo/redirects"
            class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-transparent text-ink hover:bg-surface-elevated px-5 py-3 text-sm min-h-[44px]"
            data-testid="seo-redirect-cancel"
          >
            Cancel
          </a>
          <app-button
            type="submit"
            [disabled]="form.invalid || form.pristine || saving()"
            [loading]="saving()"
            data-testid="seo-redirect-submit"
          >
            Create redirect
          </app-button>
        </div>
      </form>
    </section>
  `,
})
export class SeoRedirectNewPage implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  private readonly destroy$ = new Subject<void>();

  readonly fromId = 'seo-redirect-from';
  readonly toId = 'seo-redirect-to';
  readonly typeId = 'seo-redirect-type';

  readonly form = this.fb.nonNullable.group({
    fromPath: ['', [Validators.required, Validators.maxLength(500), leadingSlash]],
    toPath: ['', [Validators.required, Validators.maxLength(500), leadingSlash]],
    type: this.fb.nonNullable.control<RedirectType>('MOVED_PERMANENTLY'),
  });

  readonly saving = signal(false);
  readonly topError = signal<string | null>(null);
  readonly conflict = signal(false);

  fromError(): string | null {
    const c = this.form.controls.fromPath;
    if (this.conflict()) return 'A redirect from this path already exists.';
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('required')) return 'From path is required.';
    if (c.hasError('leadingSlash')) return 'Must start with / and not // or /\\.';
    if (c.hasError('maxlength')) return 'Must be 500 characters or fewer.';
    return null;
  }

  toError(): string | null {
    const c = this.form.controls.toPath;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('required')) return 'To path is required.';
    if (c.hasError('leadingSlash')) return 'Must start with / and not // or /\\.';
    if (c.hasError('maxlength')) return 'Must be 500 characters or fewer.';
    return null;
  }

  constructor() {
    this.form.controls.fromPath.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.conflict()) this.conflict.set(false);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    if (this.saving()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      const firstInvalid = this.form.controls.fromPath.invalid
        ? this.fromId
        : this.form.controls.toPath.invalid
          ? this.toId
          : null;
      if (firstInvalid) {
        queueMicrotask(() => document.getElementById(firstInvalid)?.focus());
      }
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    this.topError.set(null);
    this.seo
      .createRedirect({
        fromPath: value.fromPath.trim(),
        toPath: value.toPath.trim(),
        type: value.type,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.saving.set(false);
          void this.router.navigate(['/seo/redirects']);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          if (err instanceof ApiConflictError) {
            this.conflict.set(true);
            this.form.controls.fromPath.setErrors({ conflict: true });
            this.form.controls.fromPath.markAsTouched();
            return;
          }
          this.topError.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to create redirects.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not create the redirect. Please retry.';
  }
}
