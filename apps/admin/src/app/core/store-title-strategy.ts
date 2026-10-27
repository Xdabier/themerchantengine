import { Title } from '@angular/platform-browser';
import { Injectable, effect, inject, signal } from '@angular/core';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';
import { StoreSettingsStore } from './stores/store-settings.store';

/** Shown after the page name when the store has not been named yet. */
export const UNNAMED_STORE_TITLE = 'Admin';

/**
 * Puts the store's own name in the browser tab (plan E3.2, constitution §3.9).
 *
 * Angular's default strategy reads a route's `title` property; every route in
 * this app declares `data.title` instead, shared with the topbar and the
 * permission guard, so the page half is read from there.
 *
 * The store name arrives from an authenticated request that finishes after
 * the first navigation, so the title is recomputed as a signal rather than
 * written once per navigation. Without that, the first screen an operator
 * lands on would keep the unnamed title for the whole session.
 */
@Injectable()
export class StoreTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly settings = inject(StoreSettingsStore);
  private readonly page = signal<string | null>(null);

  constructor() {
    super();
    effect(() => {
      const page = this.page();
      const store = this.settings.storeName().trim() || UNNAMED_STORE_TITLE;
      this.title.setTitle(page ? `${page} · ${store}` : store);
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.page.set(this.deepestTitle(snapshot));
  }

  /** The innermost `data.title` on the activated path, which is the screen. */
  private deepestTitle(snapshot: RouterStateSnapshot): string | null {
    let route = snapshot.root;
    let found: string | null = null;
    for (;;) {
      const candidate = route.data['title'];
      if (typeof candidate === 'string' && candidate.trim()) found = candidate;
      const next = route.firstChild;
      if (!next) return found;
      route = next;
    }
  }
}
