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
import { Router, RouterLink } from '@angular/router';

import { OrdersService } from '@storefront-services';
import { StorefrontError, StorefrontUnauthorizedError, type Order } from '@storefront-types';

import { LocaleService } from '../../../locale.service';
import { AuthStateService } from '../../../services/auth-state.service';
import { APP_ROUTES } from '../../../../lib/routes';
import { OrderRowComponent } from '../../../sections/account/order-row.component';
import { SpinnerComponent } from '../../../ui/spinner.component';
import { ensureAuthedForAccount } from './_account-auth-guard';
import { AccountNavComponent } from '../../../sections/account/account-nav.component';
import { pageTitle } from '../../../../lib/seo';

type PageState = 'idle' | 'loading' | 'ready' | 'error';

const RECENT_ORDERS_PAGE_SIZE = 3;

/**
 * S11 account dashboard. SSR shell + browser-side hydration. Anonymous
 * visitors redirect to /auth/login on hydration via ensureAuthedForAccount.
 */
@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [AccountNavComponent, OrderRowComponent, RouterLink, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="account-page">
      <app-account-nav />
      <header class="header">
        <h1 class="title">{{ strings().account.index.heading }}</h1>
        @if (greeting()) {
          <p class="greeting" data-testid="account-page-greeting">{{ greeting() }}</p>
        }
      </header>

      <nav
        class="quick-links"
        [attr.aria-label]="strings().account.index.quickLinksLabel"
        data-testid="account-quick-links"
      >
        <a class="quick-link" [routerLink]="ordersHref()" data-testid="account-quick-link-orders">
          <span class="quick-link-title">{{ strings().account.index.quickLinks.ordersTitle }}</span>
          <span class="quick-link-body">{{ strings().account.index.quickLinks.ordersBody }}</span>
        </a>
        <a
          class="quick-link"
          [routerLink]="addressesHref()"
          data-testid="account-quick-link-addresses"
        >
          <span class="quick-link-title">{{
            strings().account.index.quickLinks.addressesTitle
          }}</span>
          <span class="quick-link-body">{{
            strings().account.index.quickLinks.addressesBody
          }}</span>
        </a>
        <a
          class="quick-link"
          [routerLink]="wishlistHref()"
          data-testid="account-quick-link-wishlist"
        >
          <span class="quick-link-title">{{
            strings().account.index.quickLinks.wishlistTitle
          }}</span>
          <span class="quick-link-body">{{ strings().account.index.quickLinks.wishlistBody }}</span>
        </a>
        <a class="quick-link" [routerLink]="profileHref()" data-testid="account-quick-link-profile">
          <span class="quick-link-title">{{
            strings().account.index.quickLinks.profileTitle
          }}</span>
          <span class="quick-link-body">{{ strings().account.index.quickLinks.profileBody }}</span>
        </a>
        <a class="quick-link" [routerLink]="returnsHref()" data-testid="account-quick-link-returns">
          <span class="quick-link-title">{{
            strings().account.index.quickLinks.returnsTitle
          }}</span>
          <span class="quick-link-body">{{ strings().account.index.quickLinks.returnsBody }}</span>
        </a>
        <a
          class="quick-link"
          [routerLink]="preferencesHref()"
          data-testid="account-quick-link-preferences"
        >
          <span class="quick-link-title">{{
            strings().account.index.quickLinks.preferencesTitle
          }}</span>
          <span class="quick-link-body">{{
            strings().account.index.quickLinks.preferencesBody
          }}</span>
        </a>
      </nav>

      <section class="recent" aria-labelledby="account-recent-orders-title">
        <header class="recent-head">
          <h2 id="account-recent-orders-title" class="recent-title">
            {{ strings().account.index.recentOrdersTitle }}
          </h2>
          <a
            class="recent-view-all"
            [routerLink]="ordersHref()"
            data-testid="account-recent-orders-view-all"
          >
            {{ strings().account.index.recentOrdersViewAll }}
          </a>
        </header>

        @switch (state()) {
          @case ('loading') {
            <div
              class="loading"
              role="status"
              aria-live="polite"
              data-testid="account-recent-loading"
            >
              <app-spinner size="md" />
              <span>{{ strings().account.shared.loading }}</span>
            </div>
          }
          @case ('error') {
            <p class="error" role="alert" data-testid="account-recent-error">
              {{ strings().account.shared.loadError }}
            </p>
          }
          @case ('ready') {
            @if (recentOrders().length === 0) {
              <p class="empty" data-testid="account-recent-empty">
                {{ strings().account.index.recentOrdersEmpty }}
              </p>
            } @else {
              <ul class="orders" data-testid="account-recent-orders">
                @for (order of recentOrders(); track order.id) {
                  <li class="order-item">
                    <app-order-row [order]="order" />
                  </li>
                }
              </ul>
            }
          }
        }
      </section>
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
        gap: 2rem;
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
      .greeting {
        margin: 0;
        margin-block-start: 0.25rem;
        color: var(--brand-text-muted);
        font-size: var(--brand-text-body);
      }
      .quick-links {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.75rem;
      }
      @media (min-width: 768px) {
        .quick-links {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      @media (min-width: 1024px) {
        .quick-links {
          grid-template-columns: repeat(4, 1fr);
        }
      }
      .quick-link {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding-block: 1rem;
        padding-inline: 1rem;
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        background-color: var(--brand-surface);
        color: var(--brand-text);
        text-decoration: none;
        min-block-size: 88px;
      }
      .quick-link:hover,
      .quick-link:focus-visible {
        border-color: var(--brand-primary);
      }
      .quick-link:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .quick-link-title {
        font-weight: 600;
        font-size: var(--brand-text-product, 1rem);
      }
      .quick-link-body {
        color: var(--brand-text-muted);
        font-size: var(--brand-text-micro);
      }
      .recent {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .recent-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .recent-title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .recent-view-all {
        color: var(--brand-primary);
        font-size: var(--brand-text-body);
        text-decoration: none;
      }
      .recent-view-all:hover {
        text-decoration: underline;
      }
      .recent-view-all:focus-visible {
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
      .empty {
        margin: 0;
        color: var(--brand-text-muted);
      }
    `,
  ],
})
export class AccountPageComponent implements OnInit {
  private readonly locale = inject(LocaleService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ordersSvc = inject(OrdersService);

  protected readonly strings = this.locale.strings;
  protected readonly state = signal<PageState>('idle');
  protected readonly recentOrders = signal<Order[]>([]);

  protected readonly ordersHref = computed(() => APP_ROUTES.account.orders(this.locale.locale()));
  protected readonly addressesHref = computed(() =>
    APP_ROUTES.account.addresses(this.locale.locale()),
  );
  protected readonly wishlistHref = computed(() =>
    APP_ROUTES.account.wishlist(this.locale.locale()),
  );
  protected readonly profileHref = computed(() => APP_ROUTES.account.profile(this.locale.locale()));
  protected readonly preferencesHref = computed(() =>
    APP_ROUTES.account.preferences(this.locale.locale()),
  );
  protected readonly returnsHref = computed(() => APP_ROUTES.account.returns(this.locale.locale()));

  protected readonly greeting = computed(() => {
    const user = this.authState.currentUser();
    if (!user || !user.firstName) return '';
    return this.strings().account.index.subheadingAuthed.replace('{firstName}', user.firstName);
  });

  ngOnInit(): void {
    this.title.setTitle(
      pageTitle(this.strings().account.meta.indexTitle, this.strings().brand.name),
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
        APP_ROUTES.account.index(this.locale.locale()),
      ))
    ) {
      return;
    }
    void this.loadRecent();
  }

  private async loadRecent(): Promise<void> {
    this.state.set('loading');
    try {
      const result = await this.ordersSvc.list({ page: 1, pageSize: RECENT_ORDERS_PAGE_SIZE });
      this.recentOrders.set(result.data);
      this.state.set('ready');
    } catch (cause) {
      if (cause instanceof StorefrontUnauthorizedError) {
        this.authState.clearSession();
        void ensureAuthedForAccount(
          { authState: this.authState, locale: this.locale, router: this.router },
          APP_ROUTES.account.index(this.locale.locale()),
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

export default AccountPageComponent;
