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

import { ReturnsService } from '@storefront-services';
import { StorefrontError, StorefrontUnauthorizedError, type Return } from '@storefront-types';

import { LocaleService } from '../../../../locale.service';
import { AuthStateService } from '../../../../services/auth-state.service';
import { APP_ROUTES } from '../../../../../lib/routes';
import { SpinnerComponent } from '../../../../ui/spinner.component';
import { ensureAuthedForAccount } from '../_account-auth-guard';
import { AccountNavComponent } from '../../../../sections/account/account-nav.component';
import { pageTitle } from '../../../../../lib/seo';

type PageState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Read-only customer returns view per
 * `agent_docs/storefront/architecture.md:
 * "Online returns initiation flow with photo upload. API supports it; the
 *  storefront surface is read-only 'view your returns' in v1."
 *
 * Lists every return the authenticated customer has filed for past orders.
 * Submission flow is intentionally not surfaced — admin processes returns
 * via the admin dashboard (`apps/admin-e2e/src/modules/returns.journey.spec.ts`).
 * Each row links back to the parent order so the customer can see the items
 * that the return references.
 */
@Component({
  selector: 'app-account-returns-page',
  standalone: true,
  imports: [AccountNavComponent, RouterLink, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="account-returns-page">
      <app-account-nav />
      <header class="header">
        <h1 class="title">{{ strings().account.returns.heading }}</h1>
        <p class="subtitle">{{ strings().account.returns.subheading }}</p>
      </header>

      @switch (state()) {
        @case ('loading') {
          <div
            class="loading"
            role="status"
            aria-live="polite"
            data-testid="account-returns-loading"
          >
            <app-spinner size="md" />
            <span>{{ strings().account.shared.loading }}</span>
          </div>
        }
        @case ('error') {
          <p class="error" role="alert" data-testid="account-returns-error">
            {{ strings().account.shared.loadError }}
          </p>
        }
        @case ('ready') {
          @if (returns().length === 0) {
            <div class="empty" data-testid="account-returns-empty">
              <h2 class="empty-title">{{ strings().account.returns.empty.title }}</h2>
              <p class="empty-body">{{ strings().account.returns.empty.body }}</p>
              <a
                class="empty-cta"
                [routerLink]="ordersHref()"
                data-testid="account-returns-empty-cta"
              >
                {{ strings().account.returns.empty.cta }}
              </a>
            </div>
          } @else {
            <ul
              class="returns"
              [attr.aria-label]="strings().account.returns.heading"
              data-testid="account-returns-list"
            >
              @for (ret of returns(); track ret.id) {
                <li
                  class="return-item"
                  [attr.data-testid]="'account-return-row-' + ret.id"
                  data-testid-shared="account-return-row"
                >
                  <div class="row-head">
                    <span class="row-id">
                      {{ strings().account.returns.row.returnIdLabel }}
                      #{{ shortId(ret.id) }}
                    </span>
                    <span
                      class="row-status"
                      [attr.data-status]="ret.status"
                      [attr.data-testid]="'account-return-status-' + ret.id"
                    >
                      {{ statusLabel(ret.status) }}
                    </span>
                  </div>
                  <dl class="row-meta">
                    <div>
                      <dt>{{ strings().account.returns.row.orderIdLabel }}</dt>
                      <dd>
                        <a
                          class="order-link"
                          [routerLink]="orderHref(ret.orderId)"
                          [attr.aria-label]="
                            strings().account.returns.row.viewOrder + ' #' + shortId(ret.orderId)
                          "
                          [attr.data-testid]="'account-return-order-link-' + ret.id"
                        >
                          #{{ shortId(ret.orderId) }}
                        </a>
                      </dd>
                    </div>
                    <div>
                      <dt>{{ strings().account.returns.row.reasonLabel }}</dt>
                      <dd>{{ reasonLabel(ret.reason) }}</dd>
                    </div>
                    <div>
                      <dt>{{ strings().account.returns.row.itemsLabel }}</dt>
                      <dd>{{ itemsCount(ret) }}</dd>
                    </div>
                  </dl>
                </li>
              }
            </ul>
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
      .subtitle {
        margin: 0;
        color: var(--brand-text-muted);
        font-size: var(--brand-text-body);
      }
      .returns {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .return-item {
        background-color: var(--brand-surface);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-lg);
        padding-block: 1rem;
        padding-inline: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .row-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .row-id {
        font-weight: 600;
        color: var(--brand-text);
      }
      .row-status {
        font-size: var(--brand-text-micro);
        padding-block: 0.125rem;
        padding-inline: 0.5rem;
        background-color: var(--brand-surface-strong);
        color: var(--brand-text-muted);
        border-radius: var(--brand-radius-full);
      }
      .row-status[data-status='REFUND_PROCESSED'] {
        background-color: var(--brand-primary-dark);
        color: var(--brand-on-primary);
      }
      .row-status[data-status='REJECTED'] {
        background-color: var(--brand-surface-strong);
        color: var(--brand-text);
      }
      .row-meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 0.5rem 1rem;
        margin: 0;
      }
      .row-meta dt {
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
        margin: 0;
      }
      .row-meta dd {
        font-size: var(--brand-text-body);
        color: var(--brand-text);
        margin: 0;
      }
      .order-link {
        color: var(--brand-primary);
        text-decoration: underline;
      }
      .order-link:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: start;
        gap: 0.75rem;
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
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
        background-color: var(--brand-surface-strong);
        color: var(--brand-error);
        border-inline-start: 3px solid var(--brand-error);
        border-radius: var(--brand-radius-sm);
      }
    `,
  ],
})
export class AccountReturnsPageComponent implements OnInit {
  private readonly locale = inject(LocaleService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly returnsSvc = inject(ReturnsService);

  protected readonly strings = this.locale.strings;
  protected readonly state = signal<PageState>('idle');
  protected readonly returns = signal<Return[]>([]);

  protected readonly ordersHref = computed(() => APP_ROUTES.account.orders(this.locale.locale()));
  protected readonly orderHref = (id: string): string =>
    APP_ROUTES.account.order(this.locale.locale(), id);

  ngOnInit(): void {
    this.title.setTitle(
      pageTitle(this.strings().account.returns.heading, this.strings().brand.name),
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
        APP_ROUTES.account.returns(this.locale.locale()),
      ))
    ) {
      return;
    }
    void this.load();
  }

  private async load(): Promise<void> {
    this.state.set('loading');
    try {
      const result = await this.returnsSvc.list({ page: 1, pageSize: 50 });
      this.returns.set(result.data);
      this.state.set('ready');
    } catch (cause) {
      if (cause instanceof StorefrontUnauthorizedError) {
        this.authState.clearSession();
        void ensureAuthedForAccount(
          { authState: this.authState, locale: this.locale, router: this.router },
          APP_ROUTES.account.returns(this.locale.locale()),
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

  protected shortId(id: string): string {
    return id.slice(0, 8).toUpperCase();
  }

  protected itemsCount(ret: Return): number {
    return Array.isArray(ret.items) ? ret.items.length : 0;
  }

  protected statusLabel(status: Return['status']): string {
    const map = this.strings().account.returns.status;
    return map[status as keyof typeof map] ?? status;
  }

  protected reasonLabel(reason: Return['reason']): string {
    const map = this.strings().account.returns.reason;
    return map[reason as keyof typeof map] ?? reason;
  }
}

export default AccountReturnsPageComponent;
