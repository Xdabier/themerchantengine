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
import { ButtonComponent, FormFieldComponent, InputComponent, SkeletonComponent } from '@admin-ui';
import {
  SettingsService,
  type SettingsResponse,
  type UpdateSettingsRequest,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { readSetting } from './settings.utils';

/** Mirrors the DTO: an https origin with no path, or empty. */
const HTTPS_ORIGIN = /^$|^https:\/\/[a-z0-9.-]+(:[0-9]{2,5})?$/;

type DomainKey = 'storefront' | 'admin' | 'api';

interface DomainField {
  readonly key: DomainKey;
  readonly label: string;
  readonly fallback: string;
  readonly hint: string;
}

/**
 * What these rows actually do, which is narrower than it looks.
 *
 * They populate the public runtime config the storefront reads
 * (`GET /v1/store/config`). They are not what the engine builds links against:
 * canonicals, sitemap entries, transactional email links and the CORS
 * allowlist all read the environment. The hints say so, because a screen that
 * overstates its own reach is one an operator changes and then wonders why
 * nothing moved.
 */
const DOMAIN_FIELDS: readonly DomainField[] = [
  {
    key: 'storefront',
    label: 'Storefront',
    fallback: 'SITE_URL',
    hint: 'Where customers browse, as published in the storefront runtime config.',
  },
  {
    key: 'admin',
    label: 'Admin',
    fallback: 'ADMIN_PUBLIC_BASE_URL',
    hint: 'Where this dashboard is served, as published in the storefront runtime config.',
  },
  {
    key: 'api',
    label: 'API',
    fallback: 'API_PUBLIC_BASE_URL',
    hint: 'Where the engine answers, as published in the storefront runtime config.',
  },
];

/**
 * `/settings/domains` — the three public origins the engine publishes links
 * against.
 *
 * Every field may be left empty, and empty is not "unset": it means the engine
 * reads the environment variable named beside the field instead. That rule is
 * stated on the screen rather than in a runbook, because a blank field that
 * silently means something is the kind of control an operator fills in wrongly
 * once and never revisits.
 */
@Component({
  selector: 'app-settings-domains-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl" data-testid="settings-domains-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/settings"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Settings
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Domains</span>
      </nav>

      <header>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight">Domains</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          The public origins this engine publishes links against. An
          <code class="font-mono">https://</code> origin with no path, or empty.
        </p>
      </header>

      <p
        class="border border-line p-3 tabular text-xs text-ink"
        data-testid="settings-domains-empty-rule"
      >
        Leaving a field empty is a setting, not a gap: the engine then reads the environment
        variable named under that field. Fill one in only to override the deployment. These values
        are published in the storefront runtime config; the links the engine itself builds, and the
        origins it accepts requests from, come from the environment.
      </p>

      <div role="status" aria-live="polite" data-testid="settings-domains-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">{{ error() }}</p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="settings-domains-notice">
        @if (saved()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">Domains saved.</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="10rem" width="100%" />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-5" novalidate>
          @for (field of fields; track field.key) {
            <app-form-field
              [label]="field.label"
              [fieldId]="'domain-' + field.key"
              [error]="originError(field.key)"
              [hint]="field.hint + ' Empty falls back to ' + field.fallback + '.'"
            >
              <app-input
                [id]="'domain-' + field.key"
                type="url"
                [formControlName]="field.key"
                [invalid]="!!originError(field.key)"
                [attr.data-testid]="'settings-domain-' + field.key"
              ></app-input>
            </app-form-field>
          }

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
                data-testid="settings-domains-revert"
              >
                Revert
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="busy() || !form.dirty || !canManage()"
                [loading]="busy()"
                data-testid="settings-domains-save"
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
export class SettingsDomainsPage implements OnInit, OnDestroy {
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

  protected readonly fields = DOMAIN_FIELDS;

  readonly form = this.fb.nonNullable.group({
    storefront: this.fb.nonNullable.control(''),
    admin: this.fb.nonNullable.control(''),
    api: this.fb.nonNullable.control(''),
  });

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * A plain method rather than a `computed`: Reactive-Forms getters are
   * untracked, so a computed over one memoizes its first read forever.
   */
  originError(key: DomainKey): string | null {
    const control = this.form.controls[key];
    if (!control.touched) return null;
    const value = control.value.trim();
    if (HTTPS_ORIGIN.test(value)) return null;
    return 'An https:// origin with no path, e.g. https://example.com. Empty is allowed.';
  }

  revert(): void {
    const settings = this.current();
    if (settings) this.seedForm(settings);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.busy() || !this.form.dirty) return;
    if (DOMAIN_FIELDS.some((field) => this.originError(field.key))) return;

    const raw = this.form.getRawValue();
    const body: UpdateSettingsRequest = {};
    for (const field of DOMAIN_FIELDS) {
      if (this.form.controls[field.key].dirty) body[field.key] = raw[field.key].trim();
    }

    this.busy.set(true);
    this.error.set(null);
    this.service.update(body).subscribe({
      next: (next) => {
        this.busy.set(false);
        this.current.set(next);
        this.seedForm(next);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.formatError(err, 'Could not save domains.'));
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
        next: (settings) => {
          this.current.set(settings);
          this.seedForm(settings);
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
        storefront: readSetting<string>(settings, 'domains', 'storefront', ''),
        admin: readSetting<string>(settings, 'domains', 'admin', ''),
        api: readSetting<string>(settings, 'domains', 'api', ''),
      },
      { emitEvent: false },
    );
  }

  private formatError(err: unknown, fallback = 'Could not load domains.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage domains.';
    if (err instanceof ApiNotFoundError) return 'Domain settings not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
