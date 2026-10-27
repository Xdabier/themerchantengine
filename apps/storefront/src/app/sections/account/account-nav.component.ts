import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '@storefront-services';

import { LocaleService } from '../../locale.service';
import { AuthStateService } from '../../services/auth-state.service';
import { signOutAndGoHome } from '../../services/sign-out';
import { APP_ROUTES } from '../../../lib/routes';
import { ButtonComponent } from '../../ui/button.component';

interface AccountNavLink {
  key: string;
  label: string;
  href: string;
}

/**
 * Shared navigation for every `/account/*` page.
 *
 * The account area had no cross-links at all: reaching addresses from orders
 * meant going back through the header menu, and sign-out existed nowhere but
 * that menu (findings A2 and A5). Both live here now, so every account page
 * gets them by mounting one component.
 *
 * `aria-current="page"` is derived from the live URL rather than from
 * `routerLinkActive`, because the exact-match rules differ per link: the
 * dashboard is a prefix of every other account route and would otherwise stay
 * marked current everywhere.
 */
@Component({
  selector: 'app-account-nav',
  standalone: true,
  imports: [ButtonComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav
      class="account-nav"
      [attr.aria-label]="strings().account.nav.label"
      data-testid="account-nav"
    >
      <ul class="links" role="list">
        @for (link of links(); track link.key) {
          <li>
            <a
              [routerLink]="link.href"
              [attr.aria-current]="isCurrent(link) ? 'page' : null"
              [attr.data-testid]="'account-nav-' + link.key"
              >{{ link.label }}</a
            >
          </li>
        }
      </ul>
      <app-button
        variant="tertiary"
        size="sm"
        [disabled]="signingOut()"
        testId="account-nav-sign-out"
        (clicked)="onSignOut()"
      >
        {{ signingOut() ? strings().account.nav.signingOut : strings().account.nav.signOut }}
      </app-button>
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .account-nav {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding-block-end: 0.75rem;
        border-block-end: 1px solid var(--brand-border);
      }
      .links {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 1rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .links a {
        color: var(--brand-text-muted);
        font-size: var(--brand-text-body);
        text-decoration: none;
        padding-block: 0.25rem;
      }
      .links a:hover {
        color: var(--brand-text);
        text-decoration: underline;
      }
      .links a[aria-current='page'] {
        color: var(--brand-text);
        font-weight: 600;
      }
      .links a:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
    `,
  ],
})
export class AccountNavComponent {
  private readonly locale = inject(LocaleService);
  private readonly authSvc = inject(AuthService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  protected readonly strings = this.locale.strings;

  protected readonly signingOut = signal(false);

  protected readonly links = computed<AccountNavLink[]>(() => {
    const loc = this.locale.locale();
    const labels = this.strings().account.nav;
    return [
      { key: 'dashboard', label: labels.dashboard, href: APP_ROUTES.account.index(loc) },
      { key: 'orders', label: labels.orders, href: APP_ROUTES.account.orders(loc) },
      { key: 'addresses', label: labels.addresses, href: APP_ROUTES.account.addresses(loc) },
      { key: 'wishlist', label: labels.wishlist, href: APP_ROUTES.account.wishlist(loc) },
      { key: 'profile', label: labels.profile, href: APP_ROUTES.account.profile(loc) },
      { key: 'preferences', label: labels.preferences, href: APP_ROUTES.account.preferences(loc) },
      { key: 'returns', label: labels.returns, href: APP_ROUTES.account.returns(loc) },
    ];
  });

  private readonly currentPath = computed(
    () => this.locale.currentUrl().split('?')[0].split('#')[0],
  );

  /**
   * The dashboard is a prefix of every other account route, so it is the only
   * link that has to match exactly; the rest mark themselves current on any
   * deeper path (an order detail keeps "My orders" lit).
   */
  protected isCurrent(link: AccountNavLink): boolean {
    const path = this.currentPath().replace(/\/$/, '');
    const href = link.href.replace(/\/$/, '');
    if (link.key === 'dashboard') return path === href;
    return path === href || path.startsWith(`${href}/`);
  }

  protected async onSignOut(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await signOutAndGoHome({
        authSvc: this.authSvc,
        authState: this.authState,
        locale: this.locale,
        router: this.router,
      });
    } finally {
      this.signingOut.set(false);
    }
  }
}
