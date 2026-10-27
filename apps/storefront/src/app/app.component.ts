import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import { LayoutShellComponent } from './layout/layout-shell.component';
import { LocaleService } from './locale.service';

type RouterScrollTrigger = 'imperative' | 'popstate' | 'hashchange' | null;

@Component({
  selector: 'app-root',
  imports: [LayoutShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" [href]="skipLinkHref()">{{ locale.strings().generic.skipToContent }}</a>
    <app-layout-shell />
  `,
})
export class AppComponent {
  protected readonly locale = inject(LocaleService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Tracks the trigger of the in-flight navigation so the matching
   * NavigationEnd can decide whether to scroll. NavigationStart fires before
   * NavigationEnd for every transition, so this single field is enough — no
   * race between concurrent navigations because Angular's router serialises
   * them.
   */
  private lastTrigger: RouterScrollTrigger = null;

  /**
   * Skip-link href is path-prefixed (`/<locale>/<route>#main-<locale>`) on
   * purpose. The document carries `<base href="/">`, so a fragment-only href
   * like `#main-en` resolves against the base — the browser navigates to
   * `/#main-en`, which hits the root redirect page and lands the user on a
   * 404 instead of focusing the current page's `<main>`. Prefixing the href
   * with the active path pins the anchor to the current document.
   */
  protected readonly skipLinkHref = computed(() => {
    const url = this.locale.currentUrl();
    const path = url.split('#')[0];
    return `${path}#main-${this.locale.locale()}`;
  });

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    // B3 scroll restoration. Tell the browser to manage its own popstate
    // restoration so back / forward returns to the prior offset; we override
    // only imperative + hashchange transitions to scroll to top.
    if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
      history.scrollRestoration = 'auto';
    }

    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.lastTrigger = (event.navigationTrigger ?? null) as RouterScrollTrigger;
        return;
      }
      if (event instanceof NavigationEnd) {
        const trigger = this.lastTrigger;
        this.lastTrigger = null;
        if (trigger === 'imperative' || trigger === 'hashchange') {
          if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
          }
        }
      }
    });

    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }
}
