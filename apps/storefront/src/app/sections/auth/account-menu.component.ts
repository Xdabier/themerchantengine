import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '@storefront-services';

import { LocaleService } from '../../locale.service';
import { AuthStateService } from '../../services/auth-state.service';
import { signOutAndGoHome } from '../../services/sign-out';
import { APP_ROUTES } from '../../../lib/routes';
import { AccountIconComponent } from '../../layout/icons/account-icon.component';

/**
 * Header account widget.
 *
 * - Anonymous: renders a single icon link to `/auth/login` (no menu mounts).
 * - Authed: renders a button-trigger that toggles a disclosure menu listing
 *   orders / addresses / wishlist / profile / sign-out. The menu uses native
 *   button + ul + roving keyboard nav (ArrowDown/Up + Home/End) + outside
 *   click and Esc dismissal — no CDK Menu dependency, but the same contract
 *   constitution §3.10 expects.
 */
@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [AccountIconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!authState.isAuthed()) {
      <a
        class="trigger"
        [routerLink]="loginHref()"
        [attr.aria-label]="strings().header.accountLabel"
        data-testid="account-menu-anonymous"
      >
        <app-account-icon [size]="22" />
        <span class="icon-label">{{ strings().header.accountLabel }}</span>
      </a>
    } @else {
      <button
        type="button"
        class="trigger"
        [attr.aria-label]="strings().auth.accountMenu.label"
        [attr.aria-expanded]="open() ? 'true' : 'false'"
        [attr.aria-haspopup]="'menu'"
        [attr.aria-controls]="menuId"
        (click)="toggle()"
        data-testid="account-menu-trigger"
      >
        <app-account-icon [size]="22" />
        <span class="icon-label">{{ strings().header.accountLabel }}</span>
      </button>
      @if (open()) {
        <ul
          #panel
          [id]="menuId"
          role="menu"
          class="panel"
          aria-orientation="vertical"
          data-testid="account-menu-panel"
          (keydown)="onPanelKeydown($event)"
        >
          @if (greeting()) {
            <li class="greeting" role="presentation">{{ greeting() }}</li>
          }
          <li role="none">
            <a
              role="menuitem"
              [routerLink]="ordersHref()"
              (click)="close()"
              data-testid="account-menu-orders"
              >{{ strings().auth.accountMenu.orders }}</a
            >
          </li>
          <li role="none">
            <a
              role="menuitem"
              [routerLink]="addressesHref()"
              (click)="close()"
              data-testid="account-menu-addresses"
              >{{ strings().auth.accountMenu.addresses }}</a
            >
          </li>
          <li role="none">
            <a
              role="menuitem"
              [routerLink]="wishlistHref()"
              (click)="close()"
              data-testid="account-menu-wishlist"
              >{{ strings().auth.accountMenu.wishlist }}</a
            >
          </li>
          <li role="none">
            <a
              role="menuitem"
              [routerLink]="profileHref()"
              (click)="close()"
              data-testid="account-menu-profile"
              >{{ strings().auth.accountMenu.profile }}</a
            >
          </li>
          <li role="separator" class="sep"></li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="logout"
              [disabled]="loggingOut()"
              (click)="logout()"
              data-testid="account-menu-logout"
            >
              {{
                loggingOut()
                  ? strings().auth.accountMenu.loggingOut
                  : strings().auth.accountMenu.logout
              }}
            </button>
          </li>
        </ul>
      }
    }
  `,
  styles: [
    `
      :host {
        position: relative;
        display: inline-flex;
      }
      .trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        min-inline-size: 44px;
        min-block-size: 44px;
        padding-inline: 0.5rem;
        padding-block: 0.5rem;
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--brand-text);
        text-decoration: none;
        font: inherit;
        border-radius: var(--brand-radius-md);
      }
      .trigger:hover,
      .trigger:focus-visible {
        background-color: var(--brand-surface-strong);
      }
      .trigger:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .icon-label {
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
      .panel {
        position: absolute;
        inset-block-start: calc(100% + 0.25rem);
        inset-inline-end: 0;
        list-style: none;
        margin: 0;
        padding-block: 0.375rem;
        padding-inline: 0;
        min-inline-size: 220px;
        background-color: var(--brand-surface);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        box-shadow: var(--brand-shadow-md);
        z-index: 100;
      }
      .panel a,
      .panel button {
        display: flex;
        align-items: center;
        inline-size: 100%;
        min-block-size: 44px;
        padding-inline: 1rem;
        padding-block: 0.5rem;
        font: inherit;
        color: var(--brand-text);
        background: transparent;
        border: none;
        text-decoration: none;
        text-align: start;
        cursor: pointer;
      }
      .panel a:hover,
      .panel a:focus-visible,
      .panel button:hover,
      .panel button:focus-visible {
        background-color: var(--brand-surface-strong);
      }
      .panel a:focus-visible,
      .panel button:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .greeting {
        padding-inline: 1rem;
        padding-block: 0.5rem;
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
        border-block-end: 1px solid var(--brand-border);
        margin-block-end: 0.25rem;
      }
      .sep {
        block-size: 1px;
        background-color: var(--brand-border);
        margin-block: 0.25rem;
      }
      .logout {
        color: var(--brand-error);
      }
    `,
  ],
})
export class AccountMenuComponent implements AfterViewChecked {
  protected readonly menuId = 'account-menu-panel';
  protected readonly authState = inject(AuthStateService);
  private readonly authSvc = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly localeSvc = inject(LocaleService);
  protected readonly strings = this.localeSvc.strings;

  protected readonly open = signal(false);
  protected readonly loggingOut = signal(false);
  private pendingFocusFirstItem = false;
  @ViewChild('panel') protected panelRef?: ElementRef<HTMLElement>;

  protected readonly loginHref = computed(() => APP_ROUTES.auth.login(this.localeSvc.locale()));
  protected readonly ordersHref = computed(() =>
    APP_ROUTES.account.orders(this.localeSvc.locale()),
  );
  protected readonly addressesHref = computed(() =>
    APP_ROUTES.account.addresses(this.localeSvc.locale()),
  );
  protected readonly wishlistHref = computed(() =>
    APP_ROUTES.account.wishlist(this.localeSvc.locale()),
  );
  protected readonly profileHref = computed(() =>
    APP_ROUTES.account.profile(this.localeSvc.locale()),
  );

  protected readonly greeting = computed(() => {
    const user = this.authState.currentUser();
    if (!user || !user.firstName) return '';
    return this.strings().auth.accountMenu.greeting.replace('{firstName}', user.firstName);
  });

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) this.pendingFocusFirstItem = true;
  }

  protected close(): void {
    this.closeInternal(true);
  }

  private closeInternal(restoreFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (!restoreFocus) return;
    queueMicrotask(() => {
      const host = this.host.nativeElement as HTMLElement;
      const trigger = host.querySelector(
        '[data-testid="account-menu-trigger"]',
      ) as HTMLElement | null;
      trigger?.focus();
    });
  }

  ngAfterViewChecked(): void {
    if (this.pendingFocusFirstItem && this.panelRef) {
      this.pendingFocusFirstItem = false;
      const items = this.menuItems();
      items[0]?.focus();
    }
  }

  private menuItems(): HTMLElement[] {
    const panel = this.panelRef?.nativeElement as HTMLElement | undefined;
    if (!panel) return [];
    const nodes = panel.querySelectorAll('[role="menuitem"]');
    return Array.from(nodes) as HTMLElement[];
  }

  protected onPanelKeydown(event: KeyboardEvent): void {
    const items = this.menuItems();
    const currentIndex = items.findIndex((el) => el === document.activeElement);
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        return;
      case 'Tab':
        // Tab leaves the menu and continues natural tab order — close without
        // forcing focus back to the trigger (the browser advances on its own).
        this.closeInternal(false);
        return;
      case 'ArrowDown': {
        event.preventDefault();
        const next = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
        items[next]?.focus();
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prev =
          currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
        items[prev]?.focus();
        return;
      }
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        return;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        return;
      default:
        return;
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  protected onDocumentEscape(): void {
    if (this.open()) this.close();
  }

  protected async logout(): Promise<void> {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    try {
      // The shared helper, so the account-page sign-out and this one cannot
      // drift apart on the ordering that matters (finding A2).
      await signOutAndGoHome({
        authSvc: this.authSvc,
        authState: this.authState,
        locale: this.localeSvc,
        router: this.router,
      });
    } finally {
      this.loggingOut.set(false);
      this.close();
    }
  }
}
