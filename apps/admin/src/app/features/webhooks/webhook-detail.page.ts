import { Dialog } from '@angular/cdk/dialog';
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
import {
  BadgeComponent,
  ButtonComponent,
  PaginationComponent,
  SkeletonComponent,
  openConfirmDialog,
} from '@admin-ui';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  WebhooksService,
  type Webhook,
  type WebhookDelivery,
  type WebhookTestResult,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { deliveryStatusBadge } from './webhooks.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

@Component({
  selector: 'app-webhook-detail-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    PaginationComponent,
    SkeletonComponent,
    AdminDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="webhook-detail-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/webhooks" class="hover:underline">Webhooks</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">Detail</span>
      </nav>

      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        aria-relevant="additions"
        data-testid="webhook-secret-reveal-region"
      >
        @if (revealedSecret(); as secret) {
          <section
            class="border border-status-warning bg-surface p-6 flex flex-col gap-4"
            data-testid="webhook-secret-reveal"
          >
            <header>
              <h2 class="text-lg font-bold tracking-tight">Signing secret</h2>
              <p class="mt-2 text-sm text-ink-muted">
                Copy this secret now — it will not be shown again.
              </p>
            </header>
            <pre
              class="font-mono text-xs text-ink p-3 border border-line break-all whitespace-pre-wrap"
              data-testid="webhook-secret-value"
              >{{ secret }}</pre
            >
            <div class="flex items-center justify-end gap-3">
              <app-button
                variant="secondary"
                (clicked)="copySecret(secret)"
                data-testid="webhook-secret-copy"
              >
                {{ copied() ? 'Copied' : 'Copy secret' }}
              </app-button>
              <app-button (clicked)="dismissSecret()" data-testid="webhook-secret-dismiss">
                Dismiss
              </app-button>
            </div>
          </section>
        }
      </div>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="webhook-detail-error"
        [class.border]="!!loadError()"
        [class.border-status-error]="!!loadError()"
        [class.text-ink]="!!loadError()"
        [class.p-3]="!!loadError()"
      >
        {{ loadError() ?? '' }}
      </p>

      @if (loading()) {
        <div class="flex flex-col gap-4" data-testid="webhook-detail-loading">
          <app-skeleton height="2rem" />
          <app-skeleton height="1rem" />
          <app-skeleton height="1rem" />
        </div>
      } @else if (notFound()) {
        <div class="border border-line p-8 text-center" data-testid="webhook-not-found">
          <h1 class="text-2xl font-bold tracking-tight">Webhook not found</h1>
          <p class="mt-3 text-sm text-ink-muted">The subscription was deleted or never existed.</p>
          <a
            routerLink="/webhooks"
            class="mt-6 inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
          >
            Back to webhooks
          </a>
        </div>
      } @else if (webhook(); as w) {
        <header class="flex flex-col gap-3">
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="text-3xl md:text-4xl font-bold tracking-tight break-all">
            <span class="font-mono text-2xl md:text-3xl">{{ w.url }}</span>
          </h1>
          <div class="flex items-center gap-3 flex-wrap">
            <app-badge
              [tone]="w.isActive ? 'success' : 'warning'"
              [ariaLabel]="w.isActive ? 'Active subscription' : 'Disabled subscription'"
            >
              {{ w.isActive ? 'Active' : 'Disabled' }}
            </app-badge>
            @if (w.failureCount > 0) {
              <span
                class="text-xs text-status-warning tabular-nums"
                data-testid="webhook-failure-count"
              >
                {{ w.failureCount }} consecutive failures
              </span>
            }
            <span class="text-xs text-ink-muted tabular-nums">
              Last delivered: {{ w.lastDeliveredAt | adminDate }}
            </span>
          </div>
        </header>

        <section class="flex items-center gap-3 flex-wrap" aria-label="Webhook actions">
          @if (canManage()) {
            <app-button
              variant="secondary"
              (clicked)="sendTest()"
              [disabled]="testing()"
              [loading]="testing()"
              data-testid="webhook-test-button"
            >
              Send test event
            </app-button>
          }
          @if (canManage()) {
            <a
              [routerLink]="['/webhooks', w.id, 'edit']"
              class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
              data-testid="webhook-edit-cta"
            >
              Edit
            </a>
          }
          @if (canManage()) {
            <app-button
              variant="ghost"
              (clicked)="confirmDelete(w)"
              [disabled]="deleting()"
              [loading]="deleting()"
              data-testid="webhook-delete-cta"
            >
              Delete
            </app-button>
          }
        </section>

        <p
          class="text-xs p-3 border border-line text-ink min-h-[44px] flex items-center"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="webhook-test-result"
        >
          {{ testStatus() || 'No test event sent yet.' }}
        </p>

        <section class="flex flex-col gap-4" aria-label="Subscribed events">
          <h2 class="text-xs tracking-widest uppercase text-ink-muted">Events</h2>
          <ul class="flex flex-wrap gap-2" data-testid="webhook-event-badges">
            @for (event of w.events; track event) {
              <li>
                <app-badge tone="neutral">
                  <span class="font-mono">{{ event }}</span>
                </app-badge>
              </li>
            }
          </ul>
        </section>

        <section class="flex flex-col gap-4" aria-label="Delivery log">
          <header class="flex items-end justify-between gap-4 flex-wrap">
            <h2 class="text-xl font-bold tracking-tight">Recent deliveries</h2>
          </header>
          <div class="border border-line bg-surface">
            <div class="overflow-x-auto">
              <table
                class="w-full border-collapse"
                [attr.aria-busy]="deliveriesLoading() ? 'true' : null"
              >
                <caption class="sr-only">
                  Delivery attempts
                </caption>
                <thead class="border-b border-line">
                  <tr class="text-left">
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                    >
                      Event
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
                      Attempt
                    </th>
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                    >
                      Response
                    </th>
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                    >
                      Succeeded at
                    </th>
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                    >
                      Next retry
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @if (deliveriesLoading()) {
                    @for (_ of skeletonRows; track $index) {
                      <tr class="border-b border-line">
                        @for (__ of [0, 1, 2, 3, 4, 5]; track $index) {
                          <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                        }
                      </tr>
                    }
                  } @else if (deliveries().length === 0) {
                    <tr>
                      <td
                        colspan="6"
                        class="px-4 py-12 text-center text-ink-muted text-sm"
                        data-testid="webhook-deliveries-empty"
                      >
                        No deliveries yet.
                      </td>
                    </tr>
                  } @else {
                    @for (d of deliveries(); track d.id) {
                      <tr
                        class="border-b border-line last:border-b-0"
                        [attr.data-testid]="'delivery-row-' + d.id"
                      >
                        <td class="px-4 py-3 font-mono text-xs text-ink break-all">
                          {{ d.eventType }}
                        </td>
                        <td class="px-4 py-3">
                          <app-badge [tone]="badgeFor(d).tone">{{ badgeFor(d).label }}</app-badge>
                        </td>
                        <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                          {{ d.attempt }}
                        </td>
                        <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                          {{ d.responseStatus ?? '—' }}
                        </td>
                        <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                          {{ d.succeededAt | adminDate }}
                        </td>
                        <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                          {{ d.nextRetryAt | adminDate }}
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </div>
          <app-pagination
            [page]="deliveryPage()"
            [pageSize]="deliveryPageSize"
            [total]="deliveryTotal()"
            [loading]="deliveriesLoading()"
            testIdPrefix="deliveries"
            (pageChange)="goToDeliveryPage($event)"
          />
        </section>
      }
    </section>
  `,
})
export class WebhookDetailPage implements OnInit, OnDestroy {
  private readonly webhooksService = inject(WebhooksService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(Dialog);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2];
  protected readonly badgeFor = deliveryStatusBadge;
  protected readonly deliveryPageSize = 20;

  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly webhook = signal<Webhook | null>(null);
  readonly testing = signal(false);
  readonly testStatus = signal<string | null>(null);
  readonly deleting = signal(false);

  readonly deliveriesLoading = signal(true);
  readonly deliveries = signal<readonly WebhookDelivery[]>([]);
  readonly deliveryTotal = signal(0);

  readonly revealedSecret = signal<string | null>(null);
  readonly copied = signal(false);

  readonly id = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  readonly canManage = computed(() => this.auth.hasPermission('settings:manage'));

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly deliveryPage = computed(() => Math.max(1, Number(this.queryParams()['dp'] ?? '1')));
  readonly deliveryTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.deliveryTotal() / this.deliveryPageSize)),
  );

  ngOnInit(): void {
    const navState = this.router.getCurrentNavigation()?.extras?.state as
      | { secret?: string }
      | undefined;
    if (navState?.secret) this.revealedSecret.set(navState.secret);
    else if (
      typeof history !== 'undefined' &&
      history.state &&
      typeof (history.state as { secret?: unknown }).secret === 'string'
    ) {
      this.revealedSecret.set((history.state as { secret: string }).secret);
    }

    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.fetchWebhook(id);
        this.fetchDeliveries(id);
      }
    });
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id) this.fetchDeliveries(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  copySecret(secret: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(secret).then(
        () => this.copied.set(true),
        () => this.copied.set(false),
      );
    }
  }

  dismissSecret(): void {
    this.revealedSecret.set(null);
  }

  goToDeliveryPage(page: number): void {
    if (page < 1 || page > this.deliveryTotalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { dp: page },
      queryParamsHandling: 'merge',
    });
  }

  sendTest(): void {
    const w = this.webhook();
    if (!w || this.testing()) return;
    this.testing.set(true);
    this.testStatus.set('Queueing test event…');
    this.webhooksService
      .test(w.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result: WebhookTestResult) => {
          this.testing.set(false);
          this.testStatus.set(
            `Test event queued (delivery id: ${result.deliveryId}). Refresh to see the attempt.`,
          );
          this.fetchDeliveries(w.id);
        },
        error: (err: unknown) => {
          this.testing.set(false);
          if (err instanceof ApiError && err.message) {
            this.testStatus.set(`Test event failed: ${err.message}`);
          } else {
            this.testStatus.set('Test event failed. Please retry.');
          }
        },
      });
  }

  async confirmDelete(w: Webhook): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this webhook?',
      body: w.url,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.deleting.set(true);
    this.webhooksService
      .remove(w.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          void this.router.navigate(['/webhooks']);
        },
        error: (err: unknown) => {
          this.deleting.set(false);
          this.loadError.set(this.formatError(err));
        },
      });
  }

  private fetchWebhook(id: string): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.loadError.set(null);
    this.webhooksService
      .get(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (w) => {
          this.webhook.set(w);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          if (err instanceof ApiNotFoundError) {
            this.notFound.set(true);
            return;
          }
          if (err instanceof ApiError && err.status === 404) {
            this.notFound.set(true);
            return;
          }
          this.loadError.set(this.formatError(err));
        },
      });
  }

  private fetchDeliveries(id: string): void {
    this.deliveriesLoading.set(true);
    this.webhooksService
      .deliveries(id, { page: this.deliveryPage(), pageSize: this.deliveryPageSize })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.deliveries.set(res.data);
          this.deliveryTotal.set(res.meta.total);
          this.deliveriesLoading.set(false);
        },
        error: (err: unknown) => {
          this.deliveriesLoading.set(false);
          if (err instanceof ApiError && err.message) {
            this.loadError.set(err.message);
          }
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage webhooks.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load this webhook. Please retry.';
  }
}
