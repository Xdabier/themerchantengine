import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  inject,
  OnInit,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';

import { AuthService, CartService } from '@storefront-services';

import { LocaleService } from '../locale.service';
import { AuthStateService } from '../services/auth-state.service';
import { WishlistStateService } from '../services/wishlist-state.service';
import { FooterComponent } from './footer.component';
import { HeaderComponent } from './header.component';
import { MobileBottomNavComponent } from './mobile-bottom-nav.component';
import { ToastContainerComponent } from '../ui/toast.component';

/**
 * Storefront layout shell. Wraps every route with the global header, footer,
 * and mobile bottom-nav landmarks. The skip-link target lives here (the same
 * `'main-' + locale()` id contract `app.component.ts` declared in S0) so the
 * page-level `<router-outlet />` projects inside `<main>` and screen readers
 * land in the page content on skip-link activation.
 *
 * Cart hydration: the shell triggers `CartService.get()` on the client after
 * Analog SSR finishes hydrating. The signal-driven cart badge in Header /
 * MobileBottomNav reads `cart.itemCount()`, so the badge appears once the
 * fetch completes. Server-side initial paint shows the badge as hidden
 * (count=0) and never announces a stale `0 items`.
 */
@Component({
  selector: 'app-layout-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    HeaderComponent,
    FooterComponent,
    MobileBottomNavComponent,
    ToastContainerComponent,
  ],
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-block-size: 100dvh;
        background-color: var(--brand-bg);
      }

      main {
        flex: 1;
        display: block;
      }

      /* Skip-link target receives programmatic focus only. Suppress the
         visible outline so the route content does not flash a UA focus ring
         after the user activates the skip link. Pointer focus is impossible
         (tabindex=-1 prevents Tab focus too). */
      main:focus {
        outline: none;
      }

      @media (max-width: 767px) {
        main {
          padding-block-end: 64px;
        }
      }
    `,
  ],
  template: `
    <app-header />
    <main [id]="mainId()" tabindex="-1">
      <router-outlet />
    </main>
    <app-footer />
    <app-mobile-bottom-nav />
    <!-- Every toast.success / toast.error in the storefront pushed into a
         container that was never mounted, so no transient confirmation has
         ever reached a customer. -->
    <app-toast-container [dismissLabel]="dismissToastLabel()" />
  `,
})
export class LayoutShellComponent implements OnInit {
  private readonly locale = inject(LocaleService);
  private readonly cart = inject(CartService);
  private readonly auth = inject(AuthService);
  private readonly authState = inject(AuthStateService);
  // Injected for its constructor effect, which hydrates wishlist membership as
  // soon as `boot()` commits a session. Without a root-level consumer the
  // store is never instantiated and every heart renders unpressed.
  private readonly wishlistState = inject(WishlistStateService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  protected readonly mainId = computed(() => `main-${this.locale.locale()}`);
  // Left unbound when the container was mounted, so its close button served
  // the component's English default to /fr readers.
  readonly dismissToastLabel = computed(() => this.locale.strings().generic.dismissToast);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    void this.boot();
    void this.startInstrumentation();
  }

  /**
   * Vendor tags and first-party page views, loaded out of the boot chunk.
   *
   * Dynamically imported rather than injected as fields. The shell is the one
   * eagerly-loaded component, so a static import here pulls the analytics
   * client and its schemas into the critical boot chunk; doing that made
   * WebKit fail a chunk fetch when a test navigated twice in a row, and it
   * would slow first paint for every reader to serve marketing tags. Neither
   * is worth a byte on the boot path.
   *
   * `injector.get` after the import, because the services are `providedIn:
   * 'root'` and this runs outside an injection context.
   *
   * One `page_view` per completed navigation, including the first. Here rather
   * than in each page: the shell outlives every route, so a page added later is
   * counted without anyone remembering to instrument it. `NavigationEnd` rather
   * than a route activation, so a cancelled or redirected navigation is never
   * reported as a view of a page nobody saw.
   *
   * Silent, like everything else on this path: instrumentation must never be
   * able to fail a page.
   */
  private async startInstrumentation(): Promise<void> {
    try {
      const [pixelModule, trackerModule] = await Promise.all([
        import('../services/pixel.service'),
        import('../services/analytics-tracker.service'),
      ]);

      // Before the first page view, so a configured tag is live for it. The
      // store config is already resolved by the app initializer, so this costs
      // no fetch, and with no pixel configured it appends nothing.
      this.injector.get(pixelModule.PixelService).init();

      const analytics = this.injector.get(trackerModule.AnalyticsTrackerService);
      void analytics.trackPageView(this.router.url);
      const subscription = this.router.events.subscribe((event) => {
        if (event instanceof NavigationEnd) void analytics.trackPageView(event.urlAfterRedirects);
      });
      this.destroyRef.onDestroy(() => subscription.unsubscribe());
    } catch {
      // A chunk that failed to load costs the operator analytics, never the
      // reader the page.
    }
  }

  /**
   * Browser-side boot routine. Restores the customer session from the Better
   * Auth `HttpOnly` cookie if one is still valid, then hydrates the cart-count
   * signal. Runs once per browser SPA mount.
   *
   * Boot resilience (constitution §3.11.6) + bootstrap atomicity (§3.15-C):
   *   - **Single `getSession()`.** The session is resolved with one Better Auth
   *     `getSession()` call — there is no `auth.refresh()`, no companion
   *     `refreshTokenAlive` cookie, no `/me` follow-up. The pre-migration
   *     refresh + bootstrap-me choreography is gone.
   *   - **Atomic commit.** `AuthState` is published only from a fully resolved
   *     session — one `setSession({ user })` call, or none. There is a single
   *     resolved object, not an access-token + `/me` pair to reconcile, so
   *     half-hydrated state is structurally impossible.
   *   - **Boot completion is signalled, not inferred.** `markBooted()` runs in
   *     a `finally`, so consumers await the boot OUTCOME rather than polling a
   *     not-yet-meaningful `isAuthed()` (finding N4).
   *   - **No clear on a transient outcome.** `AuthService.getSession()` resolves
   *     `null` for every expected outcome alike — genuinely logged out, OR a
   *     transient 429 / 5xx / network / timeout — and never throws for them. On
   *     a `null` result the store is simply left as it was on boot entry
   *     (empty on a cold mount); there is nothing partial to clear. A customer
   *     stays logged in across a rate-limit blip and an unauthenticated visitor
   *     gets the logged-out shell without an error.
   *
   * The Better Auth client `getSession()` runs only here, behind the
   * `isPlatformBrowser` gate in `ngOnInit` — never during Analog prerender or
   * SSR (BA4.1 handling of better-auth issue #5020).
   */
  private async boot(): Promise<void> {
    try {
      const user = await this.auth.getSession();
      if (user) {
        this.authState.setSession({ user });
      }
    } catch (err: unknown) {
      // `getSession()` resolves `null` for every expected outcome and never
      // throws for them (see above). A throw here is an unexpected Better Auth
      // client fault — log it and still let the shell boot anonymous.
      console.warn('[layout-shell] unexpected failure resolving the session', err);
    } finally {
      // Settle every consumer waiting on the boot OUTCOME (finding N4). In a
      // `finally` and BEFORE the cart hydration so a null session, a committed
      // one and an unexpected client fault all release waiters alike, and none
      // of them waits on a cart round trip.
      this.authState.markBooted();
    }
    // Fold the anonymous cart into the customer's cart before reading it.
    //
    // The interactive login form fires its own merge, but every full-page-load
    // sign-in lands here instead: magic-link verify, and the auto sign-in after
    // email verification. Without this call those customers lose the basket
    // they filled before signing in (finding K4, pass-2 A9).
    //
    // Only for a resolved session: the endpoint is `@RequireAuth()`, so calling
    // it anonymously would be a guaranteed 401 on every page load. Failure is
    // swallowed on the same policy as the hydration below.
    if (this.authState.isAuthed()) {
      await this.cart.merge().catch(() => undefined);
    }
    // Hydrate the cart-count signal after auth is settled so the session
    // cookie is in play and the count reflects the customer's cart, not the
    // anonymous session cart. Failure is silently ignored — the badge stays
    // at 0 and the customer can still navigate.
    await this.cart.get().catch(() => undefined);
  }
}
