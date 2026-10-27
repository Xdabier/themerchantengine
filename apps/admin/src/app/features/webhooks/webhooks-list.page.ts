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
  openConfirmDialog,
  PaginationComponent,
  SkeletonComponent,
} from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { WebhooksService, type Webhook } from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

@Component({
  selector: 'app-webhooks-list-page',
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
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="webhooks-list-page">
      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Operations</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Webhooks</h1>
          <p class="mt-3 text-sm text-ink-muted">
            HMAC-signed outbound subscriptions. Secrets are revealed once on create.
          </p>
        </div>
        @if (canCreate()) {
          <a
            routerLink="/webhooks/new"
            class="inline-flex items-center justify-center gap-2 font-medium tracking-widest uppercase select-none motion-safe:transition-colors motion-safe:duration-75 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 bg-surface-emphasis text-on-emphasis hover:bg-surface-emphasis-hover px-5 py-3 text-sm min-h-[44px]"
            data-testid="webhooks-new-cta"
          >
            Create webhook
          </a>
        }
      </header>

      <p
        class="text-xs"
        role="alert"
        aria-atomic="true"
        data-testid="webhooks-error"
        [class.border]="!!error()"
        [class.border-status-error]="!!error()"
        [class.text-ink]="!!error()"
        [class.p-3]="!!error()"
      >
        {{ error() ?? '' }}
      </p>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Webhook subscriptions
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  URL
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Events
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
                  Created
                </th>
                @if (canManage()) {
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3 w-24"
                  >
                    <span class="sr-only">Actions</span>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of skeletonRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of columnSkeleton(); track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td
                    [attr.colspan]="canManage() ? 5 : 4"
                    class="px-4 py-16 text-center text-ink-muted text-sm"
                    data-testid="webhooks-empty"
                  >
                    No webhook subscriptions yet.
                  </td>
                </tr>
              } @else {
                @for (item of rows(); track item.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'webhook-row-' + item.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/webhooks', item.id]"
                        class="font-mono text-xs text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 break-all"
                        [attr.data-testid]="'webhook-link-' + item.id"
                      >
                        {{ item.url }}
                      </a>
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted">
                      <span class="font-mono tabular-nums">{{ item.events.length }}</span>
                      <span class="ml-2 text-ink-muted">{{ eventsPreview(item.events) }}</span>
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="item.isActive ? 'success' : 'warning'"
                        [ariaLabel]="
                          item.isActive ? 'Active subscription' : 'Disabled subscription'
                        "
                      >
                        {{ item.isActive ? 'Active' : 'Disabled' }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted tabular-nums">
                      {{ item.createdAt | adminDate }}
                    </td>
                    @if (canManage()) {
                      <td class="px-4 py-3">
                        <app-button
                          variant="ghost"
                          size="sm"
                          [attr.data-testid]="'webhook-delete-' + item.id"
                          [disabled]="deletingId() === item.id"
                          [loading]="deletingId() === item.id"
                          (clicked)="confirmDelete(item)"
                        >
                          Delete
                        </app-button>
                      </td>
                    }
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
        testIdPrefix="webhooks"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class WebhooksListPage implements OnInit, OnDestroy {
  private readonly webhooks = inject(WebhooksService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(Dialog);
  private readonly auth = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Webhook[]>([]);
  readonly total = signal(0);
  readonly deletingId = signal<string | null>(null);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });

  readonly page = computed(() => Math.max(1, Number(this.queryParams()['page'] ?? '1')));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly canCreate = computed(() => this.auth.hasPermission('settings:manage'));
  readonly canManage = computed(() => this.auth.hasPermission('settings:manage'));
  readonly columnSkeleton = computed(() => (this.canManage() ? [0, 1, 2, 3, 4] : [0, 1, 2, 3]));

  eventsPreview(events: readonly string[]): string {
    if (events.length === 0) return '—';
    const head = events.slice(0, 3).join(', ');
    return events.length > 3 ? `${head} +${events.length - 3} more` : head;
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  async confirmDelete(item: Webhook): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this webhook?',
      body: item.url,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.deletingId.set(item.id);
    this.webhooks
      .remove(item.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.deletingId.set(null);
          this.fetch();
        },
        error: (err: unknown) => {
          this.deletingId.set(null);
          this.error.set(this.formatError(err));
        },
      });
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.webhooks
      .list({ page: this.page(), pageSize: this.pageSize() })
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

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage webhooks.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load webhooks. Please retry.';
  }
}
