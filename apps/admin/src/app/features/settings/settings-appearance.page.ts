import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
} from '@admin-ui';
import {
  SettingsService,
  type SettingsResponse,
  type UpdateSettingsRequest,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { readSetting } from './settings.utils';

/**
 * `/settings/appearance` — logo + favicon URLs. Theme is locked to
 * the brutalist dark palette per the brand constitution — surfaced as
 * a read-only badge rather than a colour picker.
 *
 * Appearance does not embed the asset uploader; operators paste URLs
 * from the /assets library so this screen stays a pure URL editor.
 */
@Component({
  selector: 'app-settings-appearance-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl"
      data-testid="settings-appearance-page"
    >
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/settings"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Settings
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Appearance</span>
      </nav>

      <header>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight">Appearance</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          Brand assets that surface in the admin shell + storefront. The admin theme is locked to
          the brutalist palette.
        </p>
      </header>

      <div role="status" aria-live="polite" data-testid="settings-appearance-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="settings-appearance-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">Appearance saved.</p>
        }
      </div>

      <div class="flex items-center gap-3">
        <span class="text-xs tracking-widest uppercase text-ink-muted">Theme</span>
        <app-badge tone="neutral" [ariaLabel]="'Theme: Brutalist Dark (locked)'">
          Brutalist Dark · locked
        </app-badge>
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="10rem" width="100%" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-5" novalidate>
          <app-form-field
            label="Logo URL"
            fieldId="appearance-logo"
            [error]="urlError('logoUrl')"
            hint="Served from the assets library or a CDN — paste the full URL."
          >
            <app-input
              id="appearance-logo"
              type="url"
              formControlName="logoUrl"
              [invalid]="!!urlError('logoUrl')"
            ></app-input>
          </app-form-field>

          @if (form.controls.logoUrl.value) {
            <div class="border border-line p-4">
              <p class="text-xs tracking-widest uppercase text-ink-muted">Logo preview</p>
              <img
                [src]="form.controls.logoUrl.value"
                alt="Current store logo"
                class="mt-3 max-h-24 max-w-xs"
                data-testid="appearance-logo-preview"
              />
            </div>
          }

          <app-form-field
            label="Favicon URL"
            fieldId="appearance-favicon"
            [error]="urlError('faviconUrl')"
            hint="32×32 or 64×64 PNG/ICO. Served at /favicon.ico if empty."
          >
            <app-input
              id="appearance-favicon"
              type="url"
              formControlName="faviconUrl"
              [invalid]="!!urlError('faviconUrl')"
            ></app-input>
          </app-form-field>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
          >
            <p class="text-xs tabular text-ink-muted">
              {{ form.dirty ? 'Unsaved changes' : 'No changes' }}
            </p>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy() || !form.dirty"
                (clicked)="revert()"
                data-testid="settings-appearance-revert"
              >
                Revert
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || !form.dirty || !canManage()"
                [loading]="busy()"
                data-testid="settings-appearance-save"
              >
                Save
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class SettingsAppearancePage implements OnInit, OnDestroy {
  private readonly service = inject(SettingsService);
  private readonly authStore = inject(AuthStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly current = signal<SettingsResponse | null>(null);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['settings:manage']));

  readonly form = this.fb.nonNullable.group({
    logoUrl: this.fb.nonNullable.control(''),
    faviconUrl: this.fb.nonNullable.control(''),
  });

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  urlError(control: 'logoUrl' | 'faviconUrl'): string | null {
    const c = this.form.controls[control];
    if (!c.touched) return null;
    const value = c.value.trim();
    if (value.length === 0) return null;
    try {
      // eslint-disable-next-line no-new
      new URL(value);
      return null;
    } catch {
      return 'Enter a full URL (https://…).';
    }
  }

  revert(): void {
    const s = this.current();
    if (s) this.seedForm(s);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.busy() || !this.form.dirty) return;
    if (this.urlError('logoUrl') || this.urlError('faviconUrl')) return;

    const raw = this.form.getRawValue();
    // Plain `UpdateSettingsRequest` now, no cast: both keys are on the request
    // schema, so they survive the parse instead of being stripped into an
    // empty body the API answered 200 to. Empty clears with '' rather than
    // null, because `StoreSetting.value` is a non-nullable Json column.
    const body: UpdateSettingsRequest = {};
    if (this.form.controls.logoUrl.dirty) body.logoUrl = raw.logoUrl.trim();
    if (this.form.controls.faviconUrl.dirty) body.faviconUrl = raw.faviconUrl.trim();

    this.busy.set(true);
    this.error.set(null);
    this.service.update(body).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.current.set(res);
        this.seedForm(res);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save appearance.'));
      },
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .getAll()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.current.set(res);
          this.seedForm(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(settings: SettingsResponse): void {
    this.form.reset(
      {
        logoUrl: readSetting<string>(settings, 'appearance', 'logoUrl', ''),
        faviconUrl: readSetting<string>(settings, 'appearance', 'faviconUrl', ''),
      },
      { emitEvent: false },
    );
  }

  private formatError(err: unknown, fallback = 'Could not load appearance settings.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage appearance.';
    if (err instanceof ApiNotFoundError) return 'Appearance settings not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
