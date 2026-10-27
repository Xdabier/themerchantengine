import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { OrdersService } from '@storefront-services';
import {
  StorefrontError,
  StorefrontUnauthorizedError,
  type Order,
  type OrderStatus,
  type PaginationMeta,
} from '@storefront-types';

import { LocaleService } from '../../../../locale.service';
import { AuthStateService } from '../../../../services/auth-state.service';
import { APP_ROUTES } from '../../../../../lib/routes';
import { OrderRowComponent } from '../../../../sections/account/order-row.component';
import { SpinnerComponent } from '../../../../ui/spinner.component';
import { ensureAuthedForAccount } from '../_account-auth-guard';
import { AccountNavComponent } from '../../../../sections/account/account-nav.component';
import { pageTitle } from '../../../../../lib/seo';

type PageState = 'idle' | 'loading' | 'ready' | 'error';

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  'all',
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function isStatusFilter(value: string | null): value is StatusFilter {
  return value !== null && (STATUS_FILTERS as readonly string[]).includes(value);
}

@Component({
  selector: 'app-account-orders-page',
  standalone: true,
  imports: [AccountNavComponent, OrderRowComponent, RouterLink, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="account-orders-page">
      <app-account-nav />
      <header class="header">
        <h1 class="title">{{ strings().account.orders.heading }}</h1>
      </header>

      <fieldset class="filters" data-testid="account-orders-filters">
        <legend class="visually-hidden">{{ strings().account.orders.filters.label }}</legend>
        @for (chip of statusChips(); track chip.key) {
          <button
            type="button"
            class="chip"
            [class.is-active]="chip.key === currentFilter()"
            [attr.aria-pressed]="chip.key === currentFilter() ? 'true' : 'false'"
            [attr.data-testid]="'account-orders-filter-' + chip.key"
            (click)="onFilterChange(chip.key)"
          >
            {{ chip.label }}
          </button>
        }
      </fieldset>

      @switch (state()) {
        @case ('loading') {
          <div
            class="loading"
            role="status"
            aria-live="polite"
            data-testid="account-orders-loading"
          >
            <app-spinner size="md" />
            <span>{{ strings().account.shared.loading }}</span>
          </div>
        }
        @case ('error') {
          <p class="error" role="alert" data-testid="account-orders-error">
            {{ strings().account.shared.loadError }}
          </p>
        }
        @case ('ready') {
          @if (orders().length === 0) {
            <div class="empty" data-testid="account-orders-empty">
              <h2 class="empty-title">{{ strings().account.orders.empty.title }}</h2>
              <p class="empty-body">{{ strings().account.orders.empty.body }}</p>
              <a class="empty-cta" [routerLink]="homeHref()" data-testid="account-orders-empty-cta">
                {{ strings().account.orders.empty.cta }}
              </a>
            </div>
          } @else {
            <ul class="orders" data-testid="account-orders-list">
              @for (order of orders(); track order.id) {
                <li class="order-item">
                  <app-order-row [order]="order" />
                </li>
              }
            </ul>

            @if (totalPages() > 1) {
              <nav
                class="pagination"
                [attr.aria-label]="strings().account.orders.pagination.navLabel"
                data-testid="account-orders-pagination"
              >
                <button
                  type="button"
                  class="page-btn"
                  [disabled]="page() <= 1"
                  data-testid="account-orders-prev"
                  (click)="onPageChange(page() - 1)"
                >
                  {{ strings().account.orders.pagination.previous }}
                </button>
                <span class="page-current" role="status" aria-live="polite">
                  {{ pageLabel() }}
                </span>
                <button
                  type="button"
                  class="page-btn"
                  [disabled]="page() >= totalPages()"
                  data-testid="account-orders-next"
                  (click)="onPageChange(page() + 1)"
                >
                  {{ strings().account.orders.pagination.next }}
                </button>
              </nav>
            }
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .page {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        padding-block: 1.5rem;
        padding-inline: 1rem;
        max-inline-size: 1280px;
        margin-inline: auto;
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        color: var(--brand-text);
      }
      .visually-hidden {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0;
        padding: 0;
        border: 0;
      }
      .chip {
        background-color: var(--brand-surface);
        color: var(--brand-text);
        border: 1px solid var(--brand-border);
        padding-block: 0.375rem;
        padding-inline: 0.875rem;
        font: inherit;
        font-size: var(--brand-text-micro);
        cursor: pointer;
        border-radius: var(--brand-radius-md);
        min-block-size: 36px;
      }
      .chip:hover {
        border-color: var(--brand-primary);
      }
      .chip.is-active {
        background-color: var(--brand-primary-dark);
        color: var(--brand-on-primary);
        border-color: var(--brand-primary);
      }
      .chip:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .orders {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .pagination {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-block-start: 1rem;
      }
      .page-btn {
        background-color: var(--brand-surface);
        color: var(--brand-text);
        border: 1px solid var(--brand-border);
        padding-block: 0.5rem;
        padding-inline: 1rem;
        font: inherit;
        cursor: pointer;
        border-radius: var(--brand-radius-sm);
        min-block-size: 44px;
      }
      .page-btn:hover:not(:disabled) {
        border-color: var(--brand-primary);
      }
      .page-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .page-btn:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .page-current {
        color: var(--brand-text);
        font-size: var(--brand-text-body);
      }
      .empty {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: start;
        padding-block: 2rem;
      }
      .empty-title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .empty-body {
        margin: 0;
        color: var(--brand-text-muted);
      }
      .empty-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 44px;
        padding-block: 0.625rem;
        padding-inline: 1.25rem;
        background-color: var(--brand-primary);
        color: var(--brand-on-primary);
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        font-weight: 600;
      }
      .empty-cta:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      .loading {
        display: inline-flex;
        gap: 0.5rem;
        align-items: center;
        color: var(--brand-text-muted);
        padding-block: 1rem;
      }
      .error {
        margin: 0;
        padding-block: 0.75rem;
        padding-inline: 0.875rem;
        background-color: var(--brand-surface-strong);
        color: var(--brand-error);
        border-inline-start: 3px solid var(--brand-error);
        border-radius: var(--brand-radius-sm);
      }
    `,
  ],
})
export class AccountOrdersPageComponent implements OnInit {
  private readonly locale = inject(LocaleService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ordersSvc = inject(OrdersService);

  protected readonly strings = this.locale.strings;
  protected readonly state = signal<PageState>('idle');
  protected readonly orders = signal<Order[]>([]);
  protected readonly metaData = signal<PaginationMeta | null>(null);
  protected readonly currentFilter = signal<StatusFilter>('all');
  protected readonly page = signal<number>(1);

  protected readonly totalPages = computed(() => {
    const m = this.metaData();
    if (!m || m.pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(m.total / m.pageSize));
  });

  protected readonly pageLabel = computed(() =>
    this.strings()
      .account.orders.pagination.currentPage.replace('{page}', String(this.page()))
      .replace('{total}', String(this.totalPages())),
  );

  protected readonly statusChips = computed(() => {
    const labels = this.strings().account.orders.filters;
    return STATUS_FILTERS.map((key) => ({
      key,
      label: labels[(key === 'all' ? 'all' : key.toLowerCase()) as keyof typeof labels],
    }));
  });

  protected readonly homeHref = computed(() => APP_ROUTES.home(this.locale.locale()));

  ngOnInit(): void {
    this.title.setTitle(
      pageTitle(this.strings().account.meta.ordersTitle, this.strings().brand.name),
    );
    this.meta.updateTag({ name: 'robots', content: 'noindex,nofollow' });

    if (!isPlatformBrowser(this.platformId)) return;
    void this.init();
  }

  /**
   * Browser-side entry. The state flips to `'loading'` BEFORE the guard is
   * awaited so the page never sits in the unrendered `'idle'` branch while
   * the session boot settles (finding N4).
   */
  private async init(): Promise<void> {
    this.state.set('loading');
    if (
      !(await ensureAuthedForAccount(
        { authState: this.authState, locale: this.locale, router: this.router },
        APP_ROUTES.account.orders(this.locale.locale()),
      ))
    ) {
      return;
    }
    this.readQueryParams();
    void this.load();
  }

  private readQueryParams(): void {
    const q = this.route.snapshot.queryParamMap;
    const status = q.get('status');
    if (isStatusFilter(status)) {
      this.currentFilter.set(status);
    }
    const pageRaw = q.get('page');
    const pageNum = pageRaw ? Number(pageRaw) : 1;
    this.page.set(Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1);
  }

  protected onFilterChange(next: StatusFilter): void {
    this.currentFilter.set(next);
    this.page.set(1);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        status: next === 'all' ? null : next,
        page: 1,
      },
      queryParamsHandling: 'merge',
    });
    void this.load();
  }

  protected onPageChange(next: number): void {
    if (next < 1 || next > this.totalPages()) return;
    this.page.set(next);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: next },
      queryParamsHandling: 'merge',
    });
    void this.load();
  }

  private async load(): Promise<void> {
    this.state.set('loading');
    try {
      const filter = this.currentFilter();
      const result = await this.ordersSvc.list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        ...(filter === 'all' ? {} : { status: filter as OrderStatus }),
      });
      this.orders.set(result.data);
      this.metaData.set(result.meta);
      this.state.set('ready');
    } catch (cause) {
      if (cause instanceof StorefrontUnauthorizedError) {
        this.authState.clearSession();
        void ensureAuthedForAccount(
          { authState: this.authState, locale: this.locale, router: this.router },
          APP_ROUTES.account.orders(this.locale.locale()),
        );
        return;
      }
      if (cause instanceof StorefrontError) {
        this.state.set('error');
        return;
      }
      this.state.set('error');
    }
  }
}

export default AccountOrdersPageComponent;
