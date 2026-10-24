import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SidebarComponent, TopbarComponent } from '@admin-ui';
import { AuthService } from '@admin-services';
import { AuthStore } from '../../core/stores/auth.store';
import { filterNav, flattenNav, navConfig } from '../../core/nav.config';
import { MobileNavDialogComponent } from './mobile-nav.dialog';
import { openGlobalSearchOverlay } from '../overlays/global-search-overlay.component';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';
import { LicenseBannerComponent } from '../components/license-banner.component';
import { TopbarAccountMenuComponent } from './topbar-account-menu.component';
import { TopbarNotificationsComponent } from './topbar-notifications.component';
import { TopbarThemeToggleComponent } from './topbar-theme-toggle.component';

/**
 * Desktop: fixed 260 px sidebar + content column with sticky topbar.
 * Mobile: topbar with hamburger opens MobileNavDialog rendering the same
 * Sidebar component inside a CDK Dialog (focus trap + Esc + backdrop).
 * Cmd/Ctrl+K anywhere opens the command palette.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopbarComponent,
    TopbarAccountMenuComponent,
    TopbarNotificationsComponent,
    TopbarThemeToggleComponent,
    LicenseBannerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-surface-emphasis focus:text-on-emphasis focus:text-xs focus:uppercase focus:tracking-widest focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
      data-testid="app-shell-skip-link"
    >
      Skip to main content
    </a>
    <div class="min-h-screen grid grid-cols-1 md:grid-cols-[260px_1fr]">
      <aside
        data-testid="app-shell-sidebar"
        class="hidden md:block border-r border-line h-screen sticky top-0 overflow-hidden"
      >
        <app-sidebar [groups]="visibleGroups()" />
      </aside>

      <div class="flex flex-col min-w-0">
        <div class="sticky top-0 z-10">
          <app-topbar
            [mobileMenuOpen]="mobileOpen()"
            [searchShortcut]="shortcutHint"
            [storeName]="storeName()"
            [storeLogoUrl]="storeLogoUrl()"
            (menuToggled)="toggleMobile()"
            (searchRequested)="openPalette()"
          >
            <app-topbar-theme-toggle topbarStart />
            <app-topbar-notifications topbarEnd />
            <app-topbar-account-menu topbarUser />
            <button
              topbarUser
              type="button"
              class="text-xs uppercase tracking-widest text-ink border border-line hover:border-ink px-2 md:px-3 py-2 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="topbar-logout"
              [disabled]="loggingOut()"
              (click)="logout()"
            >
              {{ loggingOut() ? 'Signing out…' : 'Sign out' }}
            </button>
          </app-topbar>
        </div>

        <app-license-banner />

        <main id="main-content" tabindex="-1" class="flex-1" data-testid="app-shell-main">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `,
})
export class AppShell {
  private readonly store = inject(AuthStore);
  private readonly settings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  readonly loggingOut = signal(false);

  /** The store's identity, from the settings the admin already fetches. */
  readonly storeName = this.settings.storeName;
  readonly storeLogoUrl = this.settings.logoUrl;

  readonly shortcutHint =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd K' : 'Ctrl K';

  readonly visibleGroups = computed(() =>
    filterNav(navConfig, (perm) => this.store.hasPermission(perm)),
  );

  readonly mobileOpen = signal(false);
  private paletteOpen = false;

  toggleMobile(): void {
    if (this.mobileOpen()) return;
    this.mobileOpen.set(true);
    const ref = this.dialog.open<void>(MobileNavDialogComponent, {
      data: { groups: this.visibleGroups() },
      role: 'dialog',
      ariaModal: true,
      ariaLabel: 'Navigation',
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-backdrop-brand',
      disableClose: false,
    });
    ref.closed.subscribe(() => this.mobileOpen.set(false));
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      void this.openPalette();
    }
  }

  async openPalette(): Promise<void> {
    if (this.paletteOpen) return;
    this.paletteOpen = true;
    try {
      const result = await openGlobalSearchOverlay(this.dialog, {
        navItems: flattenNav(this.visibleGroups()),
      });
      if (!result) return;
      if (result.kind === 'nav') void this.router.navigateByUrl(result.to);
      else if (result.kind === 'hit') void this.router.navigateByUrl(result.url);
      else void this.router.navigate(['/search'], { queryParams: { q: result.q } });
    } finally {
      this.paletteOpen = false;
    }
  }

  /**
   * Best-effort sign-out: asks Better Auth to revoke the server session, wipes
   * local state, then navigates to /auth/login. `signOut()` never rejects — a
   * failed revoke still clears the local store, since an orphan session row
   * the server will GC is better than a stranded operator.
   */
  logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    void this.authService.signOut().finally(() => this.finishLogout());
  }

  private finishLogout(): void {
    this.store.clear();
    this.loggingOut.set(false);
    void this.router.navigate(['/auth/login']);
  }
}
