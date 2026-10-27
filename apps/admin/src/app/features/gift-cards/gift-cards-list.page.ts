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
import { GiftCardsService, type GiftCard, type ListGiftCardsQuery } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  formatExpiry,
  formatGiftCardMoney,
  giftCardStatus,
  giftCardStatusTone,
} from './gift-cards.utils';

/**
 * `/gift-cards` — paginated gift-card list.
 *
 * Codes render in JetBrains Mono (`.font-mono`) per brand. "Issue" CTA
 * gated by `gift_cards:create` so support-role staff with read-only
 * access don't see a button they can't use.
 */
@Component({
  selector: 'app-gift-cards-list-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="gift-cards-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Commerce</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Gift cards</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Issued gift cards + store credit. Codes stay private — share them only via the
            recipient's confirmation email.
          </p>
        </div>
        @if (canIssue()) {
          <app-button
            variant="primary"
            size="md"
            [routerLink]="['/gift-cards/issue']"
            data-testid="gift-card-issue"
          >
            Issue gift card
          </app-button>
        }
      </header>

      <div role="status" aria-live="polite" data-testid="gift-cards-error">
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
              Gift cards
            </caption>
            <thead class="border-b border-line">
              <tr class="text-left">
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Code
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Balance
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Initial
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
                  Expires
                </th>
                <th
                  scope="col"
                  class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                >
                  Status
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
                  <td colspan="6" class="px-4 py-16 text-center text-ink-muted text-sm">
                    No gift cards issued yet.
                  </td>
                </tr>
              } @else {
                @for (card of rows(); track card.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated focus-within:bg-surface-elevated"
                    [attr.data-testid]="'gift-card-row-' + card.id"
                  >
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/gift-cards', card.id]"
                        class="font-mono text-xs text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ card.code }}
                      </a>
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink tabular-nums">
                      {{ money(card.currentBalance, card.currency) }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted tabular-nums">
                      {{ money(card.initialBalance, card.currency) }}
                    </td>
                    <td class="px-4 py-3 tabular text-sm text-ink-muted">
                      {{ card.recipientEmail ?? '—' }}
                    </td>
                    <td class="px-4 py-3 tabular text-xs text-ink-muted">
                      {{ expiry(card.expiresAt) }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(computedStatus(card))"
                        [ariaLabel]="'Status: ' + computedStatus(card)"
                      >
                        {{ computedStatus(card) }}
                      </app-badge>
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
        testIdPrefix="gift-cards"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class GiftCardsListPage implements OnInit, OnDestroy {
  private readonly service = inject(GiftCardsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authStore = inject(AuthStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2, 3, 4];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly GiftCard[]>([]);
  readonly total = signal(0);

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '20'));
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly canIssue = computed(() => this.authStore.hasPermission('gift_cards:create'));

  protected readonly money = formatGiftCardMoney;
  protected readonly expiry = formatExpiry;
  protected readonly computedStatus = giftCardStatus;
  protected readonly statusTone = giftCardStatusTone;

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
    const query: ListGiftCardsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    this.loading.set(true);
    this.error.set(null);
    this.service
      .list(query)
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
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view gift cards.';
    if (err instanceof ApiNotFoundError) return 'Gift cards not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load gift cards. Please retry.';
  }
}
