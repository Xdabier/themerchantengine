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
import { CampaignsService, type Campaign, type ListCampaignsQuery } from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { campaignStatusLabel, kindLabel, segmentLabel } from './campaigns.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

function statusTone(s: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  switch (s) {
    case 'SENT':
      return 'success';
    case 'SCHEDULED':
    case 'SENDING':
      return 'info';
    case 'FAILED':
      return 'error';
    default:
      return 'neutral';
  }
}

function campaignName(c: Campaign): string {
  return c.name;
}

/** `/campaigns` — the marketing broadcast list. */
@Component({
  selector: 'app-campaigns-list-page',
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
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="campaigns-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Marketing</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Campaigns</h1>
          <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
            One-off broadcasts to your confirmed subscribers, sent on a queue isolated from
            transactional mail. Win-back runs automatically each week.
          </p>
        </div>
        @if (canManage()) {
          <app-button
            variant="primary"
            size="md"
            routerLink="/campaigns/new"
            data-testid="campaign-new"
          >
            New campaign
          </app-button>
        }
      </header>

      <div role="alert" data-testid="campaigns-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div class="border border-line bg-surface">
        <div class="overflow-x-auto">
          <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
            <caption class="sr-only">
              Marketing campaigns
            </caption>
            <thead class="border-b border-line">
              <tr class="text-start">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Name
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
                  Segment
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Kind
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                @for (_ of placeholderRows; track $index) {
                  <tr class="border-b border-line">
                    @for (__ of [0, 1, 2, 3, 4]; track $index) {
                      <td class="px-4 py-3"><app-skeleton height="0.75rem" /></td>
                    }
                  </tr>
                }
              } @else if (rows().length === 0) {
                <tr>
                  <td colspan="5" class="px-4 py-16 text-center text-ink-muted tabular text-sm">
                    No campaigns yet.
                  </td>
                </tr>
              } @else {
                @for (c of rows(); track c.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated"
                    [attr.data-testid]="'campaign-row-' + c.id"
                  >
                    <td class="px-4 py-3 tabular text-sm text-ink">
                      <a
                        [routerLink]="['/campaigns', c.id]"
                        class="text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                        [attr.data-testid]="'campaign-link-' + c.id"
                      >
                        {{ name(c) }}
                      </a>
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(c.status)"
                        [ariaLabel]="campaignStatusLabel(c.status)"
                        >{{ campaignStatusLabel(c.status) }}</app-badge
                      >
                    </td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">
                      {{ segmentLabel(c.segment) }}
                    </td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">
                      {{ kindLabel(c.kind) }}
                    </td>
                    <td class="px-4 py-3 tabular-nums text-xs text-ink-muted">
                      {{ c.createdAt | adminDate }}
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
        testIdPrefix="campaigns"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class CampaignsListPage implements OnInit, OnDestroy {
  private readonly service = inject(CampaignsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2, 3];
  protected readonly statusTone = statusTone;
  protected readonly name = campaignName;
  protected readonly campaignStatusLabel = campaignStatusLabel;
  protected readonly segmentLabel = segmentLabel;
  protected readonly kindLabel = kindLabel;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Campaign[]>([]);
  readonly total = signal(0);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly canManage = computed(() =>
    this.authStore.hasAnyPermission(['campaigns:manage', 'campaigns:create']),
  );

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

  private fetch(): void {
    const query: ListCampaignsQuery = { page: this.page(), pageSize: this.pageSize() };
    this.loading.set(true);
    this.error.set(null);
    this.service
      .listCampaigns(query)
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view campaigns.';
    if (err instanceof ApiError) return err.message;
    return 'Could not load campaigns.';
  }
}
