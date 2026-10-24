import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, SkeletonComponent, type BadgeTone } from '@admin-ui';
import { LicenseService, type LicenseVerdict } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

/** What each status is called on screen, and how loudly. */
const STATUS_LABELS: Record<string, string> = {
  valid: 'Valid',
  expiring: 'Expiring',
  grace: 'In grace period',
  expired: 'Expired',
  invalid: 'Invalid',
  missing: 'Not installed',
};

/**
 * `/settings/license` — what license this engine is running under.
 *
 * Read-only except for the replace control: the file is signed, so the only
 * way to change any of this is to install a different file, and the engine
 * verifies the signature before it accepts one.
 *
 * Nothing here is a threat. An expired license shows as expired and the
 * install keeps working, which is what DR-31 says and what the engine
 * actually does.
 */
@Component({
  selector: 'app-settings-license-page',
  standalone: true,
  imports: [RouterLink, AdminDatePipe, BadgeComponent, ButtonComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl" data-testid="settings-license-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/settings"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Settings
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">License</span>
      </nav>

      <header>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight">License</h1>
        <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
          The license this engine is running under. It is verified offline against a key baked into
          the build, and an expired one is reported rather than enforced: nothing here switches
          anything off.
        </p>
      </header>

      <div role="status" aria-live="polite" data-testid="settings-license-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">{{ error() }}</p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="settings-license-notice">
        @if (notice()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">{{ notice() }}</p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="10rem" width="100%" />
        </div>
      } @else if (verdict(); as current) {
        <dl class="flex flex-col gap-4" data-testid="settings-license-summary">
          <div class="flex items-center gap-3">
            <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Status</dt>
            <dd>
              <app-badge [tone]="badgeTone()" [ariaLabel]="'License status: ' + statusLabel()">
                {{ statusLabel() }}
              </app-badge>
            </dd>
          </div>

          @if (current.reason) {
            <div class="flex gap-3">
              <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Reason</dt>
              <dd class="tabular text-sm text-ink" data-testid="settings-license-reason">
                {{ current.reason }}
              </dd>
            </div>
          }

          @if (current.claims; as claims) {
            <div class="flex gap-3">
              <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Licensee</dt>
              <dd class="tabular text-sm text-ink" data-testid="settings-license-licensee">
                {{ claims.licensee }}
              </dd>
            </div>
            <div class="flex gap-3">
              <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Plan</dt>
              <dd class="tabular text-sm text-ink" data-testid="settings-license-plan">
                {{ claims.plan }} · {{ claims.storeCap }} store(s)
              </dd>
            </div>
            <div class="flex gap-3">
              <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Bound domains</dt>
              <dd class="tabular text-sm text-ink" data-testid="settings-license-domains">
                {{ claims.domains.join(', ') }}
              </dd>
            </div>
            <div class="flex gap-3">
              <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Issued</dt>
              <dd class="tabular text-sm text-ink" data-testid="settings-license-issued">
                {{ claims.issuedAt | adminDate }}
              </dd>
            </div>
            <div class="flex gap-3">
              <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Expires</dt>
              <dd class="tabular text-sm text-ink" data-testid="settings-license-expires">
                {{ claims.expiresAt | adminDate }}
                @if (current.daysToExpiry !== null) {
                  <span class="text-ink-muted">({{ expiryPhrase() }})</span>
                }
              </dd>
            </div>
          }

          @if (current.graceEndsAt) {
            <div class="flex gap-3">
              <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Grace ends</dt>
              <dd class="tabular text-sm text-ink" data-testid="settings-license-grace">
                {{ current.graceEndsAt | adminDate }}
              </dd>
            </div>
          }

          <div class="flex gap-3">
            <dt class="text-xs tracking-widest uppercase text-ink-muted w-40">Verified</dt>
            <dd class="tabular text-sm text-ink-muted" data-testid="settings-license-verified">
              {{ current.verifiedAt | adminDate }}
            </dd>
          </div>
        </dl>

        @if (canManage()) {
          <section class="flex flex-col gap-3" aria-labelledby="license-replace-heading">
            <h2
              id="license-replace-heading"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              Replace the license
            </h2>
            <p class="tabular text-xs text-ink-muted">
              A signed <code class="font-mono">.json</code> license file. The engine verifies the
              signature and the bound domains before it writes anything; a file that does not verify
              is refused with the reason and nothing on this install changes.
            </p>
            <input
              type="file"
              accept="application/json,.json"
              class="tabular text-sm text-ink file:me-3 file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-xs file:uppercase file:tracking-widest file:text-ink"
              [attr.aria-label]="'License file'"
              [disabled]="uploading()"
              (change)="onFile($event)"
              data-testid="settings-license-file"
            />
            <p
              role="status"
              aria-live="polite"
              class="tabular text-xs text-ink"
              data-testid="settings-license-selected"
            >
              @if (selected(); as file) {
                Chosen: {{ file.name }}
              }
            </p>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="primary"
                size="md"
                [disabled]="!selected() || uploading()"
                [loading]="uploading()"
                (clicked)="upload()"
                data-testid="settings-license-upload"
              >
                Install
              </app-button>
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="refreshing()"
                (clicked)="reverify()"
                data-testid="settings-license-reverify"
              >
                Re-verify
              </app-button>
            </div>
          </section>
        }
      }
    </section>
  `,
})
export class SettingsLicensePage implements OnInit, OnDestroy {
  private readonly service = inject(LicenseService);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly refreshing = signal(false);
  readonly verdict = signal<LicenseVerdict | null>(null);
  readonly selected = signal<File | null>(null);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['license:manage']));

  readonly statusLabel = computed(() => {
    const status = this.verdict()?.status;
    return status ? (STATUS_LABELS[status] ?? status) : '';
  });

  readonly badgeTone = computed<BadgeTone>(() => {
    const status = this.verdict()?.status;
    if (status === 'valid') return 'success';
    if (status === 'expiring' || status === 'grace') return 'warning';
    return 'error';
  });

  readonly expiryPhrase = computed(() => {
    const days = this.verdict()?.daysToExpiry;
    if (days === null || days === undefined) return '';
    if (days >= 0) return `in ${days} day(s)`;
    return `${Math.abs(days)} day(s) ago`;
  });

  ngOnInit(): void {
    this.fetch(false);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selected.set(input.files?.[0] ?? null);
    this.error.set(null);
    this.notice.set(null);
  }

  upload(): void {
    const file = this.selected();
    if (!file || this.uploading()) return;
    this.uploading.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.service.install(file).subscribe({
      next: (next) => {
        this.uploading.set(false);
        this.selected.set(null);
        this.verdict.set(next);
        this.notice.set('License installed.');
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        // The engine's refusal reason is the whole value of this path: a
        // generic failure would leave the operator guessing between a wrong
        // key, a wrong domain and an expired file.
        this.error.set(this.formatError(err, 'The engine refused this license file.'));
      },
    });
  }

  reverify(): void {
    this.refreshing.set(true);
    this.fetch(true);
  }

  private fetch(fresh: boolean): void {
    this.loading.set(this.verdict() === null);
    this.error.set(null);
    this.service
      .current(fresh)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (next) => {
          this.verdict.set(next);
          this.loading.set(false);
          this.refreshing.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.refreshing.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown, fallback = 'Could not read the license.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to read the license.';
    if (err instanceof ApiNotFoundError) return 'No license endpoint on this engine.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
