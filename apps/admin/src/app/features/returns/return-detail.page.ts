import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BadgeComponent, SkeletonComponent } from '@admin-ui';
import { ReturnsService, type Return, type ReturnDetail } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { TranslatablePipe } from '../../shared/pipes/translatable.pipe';
import { ReturnActionsComponent } from './return-actions.component';
import {
  formatMoney,
  orderedTimeline,
  reasonLabel,
  refundMethodLabel,
  restockDecisionLabel,
  returnStatusTone,
  statusLabel,
} from './returns.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

/**
 * `/returns/:id` — return detail with permission-gated mutation actions.
 *
 * Read access is scoped by `returns:view`; the action panel only renders
 * when the viewer also holds `returns:update` so the read/write boundary
 * stays visible in the UI as well as enforced by the API.
 */
@Component({
  selector: 'app-return-detail-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    SkeletonComponent,
    ReturnActionsComponent,
    TranslatablePipe,
    AdminDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="p-6 md:p-10 flex flex-col gap-8"
      data-testid="return-detail-page"
      [attr.aria-busy]="loading() ? 'true' : null"
    >
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/returns"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Returns
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">
          {{ returnRecord()?.returnNumber ?? returnRecord()?.id ?? '…' }}
        </span>
      </nav>

      @if (error()) {
        <p
          class="border border-status-error text-ink p-3 tabular text-xs"
          data-testid="return-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2.5rem" width="40%" />
          <app-skeleton height="1rem" width="60%" />
          <app-skeleton height="16rem" width="100%" />
        </div>
      } @else if (returnRecord(); as r) {
        <header class="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p class="text-xs tracking-widest uppercase text-ink-muted">Return</p>
            <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight tabular">
              {{ r.returnNumber ?? r.id }}
            </h1>
            <p class="mt-3 text-ink-muted tabular text-sm">
              Requested {{ r.requestedAt ?? r.createdAt | adminDate }}
              @if (r.order?.orderNumber) {
                · Order
                <a
                  [routerLink]="['/orders', r.orderId]"
                  class="text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  data-testid="return-order-link"
                >
                  {{ r.order?.orderNumber }}
                </a>
              }
            </p>
          </div>
          <app-badge
            [tone]="statusTone(r.status)"
            [ariaLabel]="'Return status: ' + statusLabel(r.status)"
          >
            {{ statusLabel(r.status) }}
          </app-badge>
        </header>

        <section
          class="border border-line bg-surface"
          data-testid="return-summary"
          aria-labelledby="return-summary-heading"
        >
          <header class="px-5 py-4 border-b border-line">
            <h2
              id="return-summary-heading"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              Summary
            </h2>
          </header>
          <dl class="divide-y divide-line">
            <div class="px-5 py-3 flex justify-between gap-3 text-sm tabular">
              <dt class="text-ink-muted">Reason</dt>
              <dd class="text-ink">{{ reasonLabel(r.reason) }}</dd>
            </div>
            @if (r.reasonDetail) {
              <div class="px-5 py-3 flex flex-col gap-1 text-sm tabular">
                <dt class="text-ink-muted">Reason detail</dt>
                <dd class="text-ink whitespace-pre-wrap">{{ r.reasonDetail }}</dd>
              </div>
            }
            <div class="px-5 py-3 flex justify-between gap-3 text-sm tabular">
              <dt class="text-ink-muted">Refund method</dt>
              <dd class="text-ink">
                {{ r.refundMethod ? refundMethodLabel(r.refundMethod) : '—' }}
              </dd>
            </div>
            <div class="px-5 py-3 flex justify-between gap-3 text-sm tabular">
              <dt class="text-ink-muted">Refund amount</dt>
              <dd class="text-ink tabular-nums">
                {{ formatMoney(r.refundAmount, r.order?.currency) }}
              </dd>
            </div>
            <div class="px-5 py-3 flex justify-between gap-3 text-sm tabular">
              <dt class="text-ink-muted">Customer</dt>
              <dd class="text-ink">{{ customerLabel(r) }}</dd>
            </div>
            @if (r.adminNotes) {
              <div class="px-5 py-3 flex flex-col gap-1 text-sm tabular">
                <dt class="text-ink-muted">Internal notes</dt>
                <dd class="text-ink whitespace-pre-wrap">{{ r.adminNotes }}</dd>
              </div>
            }
          </dl>
        </section>

        <section
          class="border border-line bg-surface"
          data-testid="return-timeline"
          aria-labelledby="return-timeline-heading"
        >
          <header class="px-5 py-4 border-b border-line">
            <h2
              id="return-timeline-heading"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              Timeline
            </h2>
          </header>
          <dl
            class="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line"
          >
            @for (entry of timeline(); track entry.stage) {
              <div class="px-5 py-4" [attr.data-testid]="'return-timeline-' + entry.stage">
                <dt class="text-xs tracking-widest uppercase text-ink-muted">
                  {{ entry.label }}
                </dt>
                <dd class="mt-1 text-sm tabular flex items-center gap-2 flex-wrap">
                  <span>{{ entry.at | adminDate }}</span>
                  @if (entry.outOfOrder) {
                    <app-badge tone="warning" ariaLabel="Recorded out of chronological order">
                      Out of order
                    </app-badge>
                    <span class="sr-only">
                      This milestone is timestamped before an earlier stage. Check the record’s
                      history.
                    </span>
                  }
                </dd>
              </div>
            }
          </dl>
        </section>

        <section
          class="border border-line bg-surface"
          data-testid="return-items"
          aria-labelledby="return-items-heading"
        >
          <header class="px-5 py-4 border-b border-line">
            <h2 id="return-items-heading" class="text-xs tracking-widest uppercase text-ink-muted">
              Items
            </h2>
          </header>
          <div class="overflow-x-auto">
            <table class="w-full border-collapse">
              <caption class="sr-only">
                Return items
              </caption>
              <thead class="border-b border-line">
                <tr class="text-left">
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    Item
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    SKU
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 text-right"
                  >
                    Qty
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 text-right"
                  >
                    Unit price
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    Restock
                  </th>
                </tr>
              </thead>
              <tbody>
                @if ((r.items ?? []).length === 0) {
                  <tr>
                    <td colspan="5" class="px-4 py-12 text-center text-ink-muted tabular text-sm">
                      No items attached to this return.
                    </td>
                  </tr>
                } @else {
                  @for (item of r.items ?? []; track item.id) {
                    <tr
                      class="border-b border-line last:border-b-0"
                      [attr.data-testid]="'return-item-row-' + item.id"
                    >
                      <td class="px-4 py-3 tabular text-sm text-ink">
                        {{ item.orderItem?.productName | translatable: '—' }}
                      </td>
                      <td class="px-4 py-3 tabular text-sm text-ink-muted">
                        {{ item.orderItem?.sku ?? item.variant?.sku ?? '—' }}
                      </td>
                      <td class="px-4 py-3 tabular text-sm text-ink text-right tabular-nums">
                        {{ item.quantity }}
                      </td>
                      <td class="px-4 py-3 tabular text-sm text-ink text-right tabular-nums">
                        {{ formatMoney(item.orderItem?.unitPrice, r.order?.currency) }}
                      </td>
                      <td class="px-4 py-3 tabular text-sm text-ink-muted">
                        {{
                          item.restockDecision ? restockDecisionLabel(item.restockDecision) : '—'
                        }}
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </section>

        <app-return-actions
          [return]="r"
          [canManage]="canManage()"
          (returnChanged)="onReturnChanged($event)"
        />
      }
    </section>
  `,
})
export class ReturnDetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly returnsService = inject(ReturnsService);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly returnRecord = signal<ReturnDetail | null>(null);
  readonly canManage = computed(() => this.authStore.hasPermission('returns:update'));
  /** Milestones in the order they actually happened, impossible ones flagged. */
  readonly timeline = computed(() => orderedTimeline(this.returnRecord()));
  protected readonly formatMoney = formatMoney;
  protected readonly reasonLabel = reasonLabel;
  protected readonly refundMethodLabel = refundMethodLabel;
  protected readonly restockDecisionLabel = restockDecisionLabel;
  protected readonly statusLabel = statusLabel;
  protected readonly statusTone = returnStatusTone;

  onReturnChanged(next: Return): void {
    const current = this.returnRecord();
    if (!current) return;
    // Merge the mutation response into the detail record so items/photos/adminNotes stay intact.
    this.returnRecord.set({ ...current, ...next });
    // On any transition, refetch so timeline timestamps (receivedAt, refundedAt) reflect server state.
    this.fetch(current.id, { silent: true });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.error.set('Missing return id.');
        this.loading.set(false);
        return;
      }
      this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  customerLabel(r: ReturnDetail): string {
    const c = r.customer ?? null;
    if (!c) return '—';
    const name = [c.firstName, c.lastName]
      .filter((s): s is string => !!s)
      .join(' ')
      .trim();
    return name || c.email || c.id;
  }

  private fetch(id: string, opts: { silent?: boolean } = {}): void {
    if (!opts.silent) {
      this.loading.set(true);
      this.error.set(null);
    }
    this.returnsService
      .get(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (r) => {
          this.returnRecord.set(r);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiNotFoundError) return 'Return not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view this return.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load return. Please retry.';
  }
}
