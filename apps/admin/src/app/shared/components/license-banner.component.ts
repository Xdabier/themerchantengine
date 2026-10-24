import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LicenseService, type LicenseVerdict } from '@admin-services';
import { AuthStore } from '../../core/stores/auth.store';

/** Dismissed for this tab only. A new session sees the banner again. */
const DISMISS_KEY = 'admin.license-banner.dismissed';

/**
 * The license banner in the admin shell (plan E3.5.2).
 *
 * It says what the verdict is and nothing more, because nothing more is true:
 * DR-31 and plan E1.5 both hold that an expired license shows a banner and
 * cuts nothing off. The storefront keeps serving, the admin keeps working, and
 * copy implying otherwise would be a threat the engine does not carry out.
 *
 * Dismissal is per session, not per install: an operator who hides it today
 * sees it again tomorrow, which is the point of a banner about something that
 * has a deadline. It is held in `sessionStorage` rather than in a token store,
 * because it is a preference about a banner and not a credential.
 */
@Component({
  selector: 'app-license-banner',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div
        role="status"
        aria-live="polite"
        class="border-b px-4 py-2 flex items-center justify-between gap-3 flex-wrap"
        [class.border-status-warning]="tone() === 'warning'"
        [class.border-status-error]="tone() === 'error'"
        data-testid="license-banner"
      >
        <p class="tabular text-xs text-ink" data-testid="license-banner-message">
          {{ message() }}
        </p>
        <span class="flex items-center gap-3">
          @if (canView()) {
            <a
              routerLink="/settings/license"
              class="tabular text-xs text-ink underline underline-offset-4 hover:text-ink-emphasis focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="license-banner-link"
            >
              License
            </a>
          }
          <button
            type="button"
            class="text-xs uppercase tracking-widest text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            (click)="dismiss()"
            data-testid="license-banner-dismiss"
          >
            Dismiss
          </button>
        </span>
      </div>
    }
  `,
})
export class LicenseBannerComponent {
  private readonly service = inject(LicenseService);
  private readonly auth = inject(AuthStore);

  private readonly verdict = signal<LicenseVerdict | null>(null);
  private readonly dismissed = signal(readDismissed());
  private attempted = false;

  readonly canView = computed(() => this.auth.hasAnyPermission(['license:view']));

  readonly visible = computed(() => {
    const current = this.verdict();
    return !!current && current.status !== 'valid' && !this.dismissed();
  });

  readonly tone = computed(() => {
    const status = this.verdict()?.status;
    return status === 'expiring' ? 'warning' : 'error';
  });

  readonly message = computed(() => {
    const current = this.verdict();
    if (!current) return '';
    const licensee = current.claims?.licensee;
    const suffix = licensee ? ` Licensed to ${licensee}.` : '';
    switch (current.status) {
      case 'expiring':
        return `This engine license expires in ${current.daysToExpiry ?? 0} day(s). Renew it before then; nothing stops working if you do not.${suffix}`;
      case 'grace':
        return `This engine license expired and is inside its grace period${
          current.graceEndsAt ? ` until ${formatDay(current.graceEndsAt)}` : ''
        }. Nothing has been switched off.${suffix}`;
      case 'expired':
        return `This engine license has expired. Nothing has been switched off, and nothing will be, but the install is unlicensed.${suffix}`;
      case 'invalid':
        return `This engine license did not verify: ${current.reason ?? 'no reason given'}`;
      case 'missing':
        return `This engine has no license installed. ${current.reason ?? ''}`.trim();
      default:
        return '';
    }
  });

  constructor() {
    // The banner is the only reader, so it fetches its own verdict rather than
    // adding a store the rest of the admin would never touch. Guarded so a
    // failure is not retried on every change detection.
    if (this.auth.isAuthenticated() && this.canView()) this.load();
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // A browser with storage disabled still gets a working dismiss for the
      // life of the view; there is nothing to recover here.
    }
  }

  private load(): void {
    if (this.attempted) return;
    this.attempted = true;
    this.service.current().subscribe({
      next: (verdict) => this.verdict.set(verdict),
      error: () => {
        // Non-blocking: the shell renders without a banner rather than failing
        // on a status read.
        this.verdict.set(null);
      },
    });
  }
}

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}
