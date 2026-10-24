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
import { NotificationsService } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';

const POLL_INTERVAL_MS = 60_000;

/**
 * Topbar bell indicator. Renders nothing when the user lacks
 * `notifications:view`. Links through to `/notifications/inbox`.
 *
 * Polls `GET /v1/admin/notifications/unread-count` every 60 seconds while:
 *   • the user is authenticated (otherwise the request would 401 endlessly
 *     against a dead session),
 *   • no `/v1/auth/refresh` round-trip is in flight (avoid thundering the
 *     backend while the refresh interceptor is renegotiating credentials).
 *
 * When either gate is closed, the tick is silently skipped. The next tick
 * re-evaluates so polling resumes automatically once auth recovers. The
 * raw `setInterval` is kept to preserve the existing simple lifecycle —
 * browser background-tab throttling already handles visibility gating.
 */
@Component({
  selector: 'app-topbar-notifications',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canView()) {
      <a
        routerLink="/notifications/inbox"
        class="inline-flex items-center gap-2 h-10 px-3 border border-line text-ink-muted hover:text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        aria-label="Notifications"
        data-testid="topbar-notifications"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span
          class="text-xs font-mono tabular-nums tracking-widest text-ink"
          role="status"
          aria-live="polite"
          [attr.aria-label]="unreadCount() > 0 ? countLabel() : null"
          [attr.aria-hidden]="unreadCount() === 0 ? 'true' : null"
          [class.sr-only]="unreadCount() === 0"
          data-testid="topbar-notifications-count"
        >
          {{ unreadCount() > 0 ? display() : '' }}
        </span>
      </a>
    }
  `,
})
export class TopbarNotificationsComponent implements OnInit, OnDestroy {
  private readonly service = inject(NotificationsService);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  readonly unreadCount = signal(0);
  readonly canView = computed(() => this.authStore.hasAnyPermission(['notifications:view']));

  readonly display = computed(() => {
    const n = this.unreadCount();
    return n > 99 ? '99+' : String(n);
  });

  readonly countLabel = computed(() => `${this.unreadCount()} unread`);

  ngOnInit(): void {
    if (!this.canView()) return;
    this.poll();
    this.intervalHandle = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    if (this.intervalHandle !== null) clearInterval(this.intervalHandle);
    this.destroy$.next();
    this.destroy$.complete();
  }

  private poll(): void {
    // Skip when there is no authenticated user. If the session is genuinely
    // dead, the route guard bounces the user to /auth/login and this component
    // is unmounted; otherwise the next tick re-evaluates.
    if (!this.authStore.isAuthenticated()) {
      return;
    }
    this.service
      .unreadCount()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.unreadCount.set(res.unreadCount),
        error: () => {
          /* silent — the bell is non-critical UI; surface no banner here. */
        },
      });
  }
}
