import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, PaginationComponent, SkeletonComponent } from '@admin-ui';
import {
  NotificationTemplatesService,
  type ListLogQuery,
  type LogStatus,
  type NotificationLogEntry,
  type TemplateChannel,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { humanizeCode } from '../../shared/format/enum-label';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

/** Friendly label for a notification log `status` (e.g. "enqueue-failed" → "Enqueue failed"). */
function statusLabel(s: string): string {
  switch (s) {
    case 'queued':
      return 'Queued';
    case 'sent':
      return 'Sent';
    case 'delivered':
      return 'Delivered';
    case 'bounced':
      return 'Bounced';
    case 'complained':
      return 'Complained';
    case 'failed':
      return 'Failed';
    case 'suppressed':
      return 'Suppressed';
    case 'skipped':
      return 'Skipped';
    case 'enqueue-failed':
      return 'Enqueue failed';
    default:
      return humanizeCode(s);
  }
}

function channelLabel(c: string): string {
  switch (c) {
    case 'email':
      return 'Email';
    case 'sms':
      return 'SMS';
    case 'push':
      return 'Push';
    default:
      return c;
  }
}

function statusTone(s: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  switch (s) {
    case 'delivered':
      return 'success';
    case 'sent':
      return 'info';
    case 'bounced':
      return 'warning';
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

/**
 * `/notifications/log` — per-send audit trail. Resend writes a new log row;
 * actual dispatch is delegated to whichever provider subscribes on the API.
 */
@Component({
  selector: 'app-log-list-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    SkeletonComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="log-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Notifications</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Send log</h1>
          <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
            Every outbound message we've recorded. Status reflects what the provider told us;
            resending appends a fresh row.
          </p>
        </div>
        <a
          routerLink="/notifications/templates"
          class="inline-flex h-10 items-center border border-line px-4 text-xs tracking-widest uppercase text-ink-muted hover:border-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          data-testid="log-go-to-templates"
        >
          Templates
        </a>
      </header>

      <div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by channel">
        @for (opt of channelOptions; track opt.value) {
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="channelFilter() === opt.value"
            [class.text-ink]="channelFilter() === opt.value"
            [class.border-line]="channelFilter() !== opt.value"
            [class.text-ink-muted]="channelFilter() !== opt.value"
            [attr.aria-pressed]="channelFilter() === opt.value"
            [attr.data-testid]="'log-channel-' + (opt.value ?? 'all')"
            (click)="setChannel(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by status">
        @for (opt of statusOptions; track opt.value) {
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="statusFilter() === opt.value"
            [class.text-ink]="statusFilter() === opt.value"
            [class.border-line]="statusFilter() !== opt.value"
            [class.text-ink-muted]="statusFilter() !== opt.value"
            [attr.aria-pressed]="statusFilter() === opt.value"
            [attr.data-testid]="'log-status-' + (opt.value ?? 'all')"
            (click)="setStatus(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <div role="alert" data-testid="log-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="log-notice">
        @if (notice()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">
            {{ notice() }}
          </p>
        }
      </div>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Notification send log
            </caption>
            <thead class="border-b border-line">
              <tr class="text-start">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Sent
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Template
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Channel
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Recipient
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Status
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of [0, 1, 2, 3, 4, 5]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td colspan="6" class="px-4 py-16 text-center text-ink-muted tabular text-sm">
                    No log entries match these filters.
                  </td>
                </tr>
              } @else {
                @for (l of rows(); track l.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated"
                    [attr.data-testid]="'log-row-' + l.id"
                  >
                    <td class="px-4 py-3 tabular-nums text-xs text-ink-muted">
                      {{ l.sentAt | adminDate }}
                    </td>
                    <td class="px-4 py-3 tabular text-xs font-mono text-ink">
                      @if (l.templateId) {
                        <a
                          [routerLink]="['/notifications/templates', l.templateId]"
                          class="text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                          [attr.data-testid]="'log-template-link-' + l.id"
                        >
                          {{ l.templateCode }}
                        </a>
                      } @else {
                        {{ l.templateCode }}
                      }
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ channelLabel(l.channel) }}
                    </td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted break-all max-w-xs">
                      {{ l.recipient }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge [tone]="statusTone(l.status)" [ariaLabel]="statusLabel(l.status)">
                        {{ statusLabel(l.status) }}
                      </app-badge>
                      @if (l.error) {
                        <p class="mt-1 text-xs tabular text-ink">{{ l.error }}</p>
                      }
                    </td>
                    <td class="px-4 py-3 text-end">
                      @if (canResend()) {
                        <app-button
                          variant="ghost"
                          size="sm"
                          [disabled]="resendingId() === l.id || resendingId() !== null"
                          [loading]="resendingId() === l.id"
                          (clicked)="resend(l)"
                          [attr.data-testid]="'log-resend-' + l.id"
                          [ariaLabel]="'Resend to ' + l.recipient"
                        >
                          Resend
                        </app-button>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>

      <app-pagination
        [page]="page()"
        [pageSize]="pageSize()"
        [total]="total()"
        [loading]="loading()"
        testIdPrefix="log"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class LogListPage implements OnInit, OnDestroy {
  private readonly service = inject(NotificationTemplatesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2, 3];
  protected readonly channelLabel = channelLabel;
  protected readonly statusLabel = statusLabel;
  protected readonly statusTone = statusTone;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly rows = signal<readonly NotificationLogEntry[]>([]);
  readonly total = signal(0);
  readonly resendingId = signal<string | null>(null);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly channelFilter = computed<TemplateChannel | null>(() => {
    const raw = this.queryParams()['channel'];
    return raw === 'email' || raw === 'sms' || raw === 'push' ? (raw as TemplateChannel) : null;
  });
  readonly statusFilter = computed<LogStatus | null>(() => {
    const raw = this.queryParams()['status'];
    return raw === 'sent' || raw === 'delivered' || raw === 'bounced' || raw === 'failed'
      ? (raw as LogStatus)
      : null;
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly canResend = computed(() => this.authStore.hasAnyPermission(['notifications:manage']));

  readonly channelOptions: ReadonlyArray<{ value: TemplateChannel | null; label: string }> = [
    { value: null, label: 'All channels' },
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'push', label: 'Push' },
  ];

  readonly statusOptions: ReadonlyArray<{ value: LogStatus | null; label: string }> = [
    { value: null, label: 'All status' },
    { value: 'sent', label: 'Sent' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'bounced', label: 'Bounced' },
    { value: 'failed', label: 'Failed' },
  ];

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setChannel(value: TemplateChannel | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { channel: value, page: null },
      queryParamsHandling: 'merge',
    });
  }

  setStatus(value: LogStatus | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status: value, page: null },
      queryParamsHandling: 'merge',
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  resend(entry: NotificationLogEntry): void {
    if (this.resendingId()) return;
    this.resendingId.set(entry.id);
    this.error.set(null);
    this.notice.set(null);
    this.service.resend(entry.id).subscribe({
      next: (res) => {
        this.resendingId.set(null);
        this.notice.set(`Queued resend to ${res.recipient}.`);
        this.fetch();
        setTimeout(() => this.notice.set(null), 3500);
      },
      error: (err: unknown) => {
        this.resendingId.set(null);
        this.error.set(this.formatError(err, 'Could not resend.'));
      },
    });
  }

  private fetch(): void {
    const query: ListLogQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    if (this.channelFilter()) query.channel = this.channelFilter() as TemplateChannel;
    if (this.statusFilter()) query.status = this.statusFilter() as LogStatus;

    this.loading.set(true);
    this.error.set(null);
    this.service
      .listLog(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown, fallback = 'Could not load the send log.'): string {
    if (err instanceof ApiNotFoundError) return 'Log entry not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view the send log.';
    if (err instanceof ApiError) return err.message;
    return fallback;
  }
}
