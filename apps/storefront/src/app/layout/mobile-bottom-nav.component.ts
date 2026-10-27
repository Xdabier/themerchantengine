import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LocaleService } from '../locale.service';
import { AuthStateService } from '../services/auth-state.service';
import { APP_ROUTES } from '../../lib/routes';
import { CartService } from '@storefront-services';

import { AccountIconComponent } from './icons/account-icon.component';
import { CartIconComponent } from './icons/cart-icon.component';
import { HomeIconComponent } from './icons/home-icon.component';
import { SearchIconComponent } from './icons/search-icon.component';

/**
 * Sticky bottom-navigation bar shown only at viewports `< 768px` per
 * `agent_docs/storefront/responsive-rules.md`. Mirrors the four primary
 * destinations: home, search, cart, account.
 *
 * The Account tab is auth-aware: anonymous visitors get the login route,
 * signed-in customers get the account dashboard. The computed re-evaluates
 * when the shell's boot commits a session, so the tab self-upgrades mid-session
 * (finding N1).
 */
@Component({
  selector: 'app-mobile-bottom-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    HomeIconComponent,
    SearchIconComponent,
    CartIconComponent,
    AccountIconComponent,
  ],
  styles: [
    `
      :host {
        display: none;
        position: fixed;
        inset-inline: 0;
        inset-block-end: 0;
        z-index: 9;
        background-color: var(--brand-surface);
        border-block-start: 1px solid var(--brand-border-strong);
      }

      @media (max-width: 767px) {
        :host {
          display: block;
        }
      }

      nav {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        align-items: stretch;
      }

      a {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
        min-block-size: 56px;
        padding-block: 0.5rem;
        padding-inline: 0.25rem;
        font-size: 12px;
        font-weight: 500;
        color: var(--brand-text-muted);
        text-decoration: none;
        text-align: center;
        background: transparent;
        border: none;
        position: relative;
      }

      a:hover,
      a:focus-visible {
        color: var(--brand-text);
        background-color: var(--brand-surface-strong);
      }

      a[aria-current='page'] {
        color: var(--brand-primary);
        font-weight: 600;
      }

      .badge {
        position: absolute;
        inset-inline-end: 18%;
        inset-block-start: 4px;
        min-inline-size: 18px;
        block-size: 18px;
        padding-inline: 4px;
        font-size: 11px;
        font-weight: 600;
        line-height: 18px;
        text-align: center;
        color: var(--brand-on-primary);
        background-color: var(--brand-primary-dark);
        border-radius: var(--brand-radius-full);
      }

      .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin-block: 0;
        margin-inline: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
  template: `
    <nav role="navigation" [attr.aria-label]="strings().bottomNav.label">
      <a
        [routerLink]="homeRoute()"
        [attr.aria-label]="strings().bottomNav.home"
        [attr.aria-current]="isActive('home') ? 'page' : null"
        data-testid="bottom-nav-home"
      >
        <app-home-icon [size]="22" />
        <span>{{ strings().bottomNav.home }}</span>
      </a>
      <a
        [routerLink]="searchRoute()"
        [attr.aria-label]="strings().bottomNav.search"
        [attr.aria-current]="isActive('search') ? 'page' : null"
        data-testid="bottom-nav-search"
      >
        <app-search-icon [size]="22" />
        <span>{{ strings().bottomNav.search }}</span>
      </a>
      <a
        [routerLink]="cartRoute()"
        [attr.aria-label]="strings().bottomNav.cart"
        [attr.aria-current]="isActive('cart') ? 'page' : null"
        data-testid="bottom-nav-cart"
      >
        <app-cart-icon [size]="22" />
        <span>{{ strings().bottomNav.cart }}</span>
        @if (itemCount() > 0) {
          <span class="badge" aria-hidden="true" data-testid="bottom-nav-cart-badge">{{
            itemCount()
          }}</span>
        }
      </a>
      <a
        [routerLink]="accountRoute()"
        [attr.aria-label]="strings().bottomNav.account"
        [attr.aria-current]="isActive('account') ? 'page' : null"
        data-testid="bottom-nav-account"
      >
        <app-account-icon [size]="22" />
        <span>{{ strings().bottomNav.account }}</span>
      </a>
    </nav>
  `,
})
export class MobileBottomNavComponent {
  private readonly localeService = inject(LocaleService);
  private readonly cart = inject(CartService);
  private readonly authState = inject(AuthStateService);

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;
  protected readonly itemCount = this.cart.itemCount;

  protected readonly homeRoute = computed(() => APP_ROUTES.home(this.locale()));
  protected readonly searchRoute = computed(() => APP_ROUTES.search(this.locale()));
  protected readonly cartRoute = computed(() => APP_ROUTES.cart(this.locale()));
  protected readonly accountRoute = computed(() =>
    this.authState.isAuthed()
      ? APP_ROUTES.account.index(this.locale())
      : APP_ROUTES.auth.login(this.locale()),
  );

  private readonly currentUrl = computed(() => this.localeService.currentUrl());

  protected isActive(tab: 'home' | 'search' | 'cart' | 'account'): boolean {
    const url = this.currentUrl();
    const stripped = url.split('?')[0].split('#')[0];
    const home = this.homeRoute();
    if (tab === 'home') return stripped === home || stripped === home.replace(/\/$/, '');
    if (tab === 'search') return stripped.startsWith(this.searchRoute());
    if (tab === 'cart') return stripped.startsWith(this.cartRoute());
    if (tab === 'account') {
      return (
        stripped.startsWith(`/${this.locale()}/account`) ||
        stripped.startsWith(`/${this.locale()}/auth`)
      );
    }
    return false;
  }
}
