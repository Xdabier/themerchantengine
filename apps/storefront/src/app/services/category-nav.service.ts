import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CategoriesService } from '@storefront-services';
import type { Category } from '@storefront-types';

import type { Locale } from '../../i18n/types';
import { LocaleService } from '../locale.service';

/**
 * The visible category tree the chrome browses by, held once per session.
 *
 * Finding M3: the header was logo, search, language, account and cart, with a
 * single "Shop" link and no categories anywhere. The only category strip lived
 * on `/catalog`, so a visitor who landed on a product page had no way to browse
 * sideways, and below 768 px the header search is hidden too, which left a
 * phone visitor with no browse entry at all.
 *
 * Browser-only and failure-tolerant, the same shape as `CmsNavService`. The
 * header is a singleton inside the layout shell rather than a route with a
 * loader, so an SSR fetch here would be new plumbing with a hydration seam;
 * the links reach the DOM after hydration and the sitemaps already carry the
 * category URLs for crawlers. A categories outage costs the store its nav row
 * and nothing else, never a thrown boot error or a console entry that would
 * fail every console-baselined journey.
 *
 * The catalog chip strip reads this store too, so a catalog page mounting both
 * pays for one request rather than two.
 *
 * The request names the page locale itself. `load()` runs on hydration, before
 * the effect that writes `<html lang>`, so the client default would fall back
 * to the store default and an `/en/` page would show French names.
 */
@Injectable({ providedIn: 'root' })
export class CategoryNavService {
  private readonly categoriesSvc = inject(CategoriesService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly localeSvc = inject(LocaleService);

  private readonly _categories = signal<Category[]>([]);
  private loaded: { locale: Locale; promise: Promise<void> } | null = null;

  /** The tree as the API returned it. Empty until loaded. */
  readonly categories = this._categories.asReadonly();

  /**
   * Top-level entries in tree order, children left attached for the drawer's
   * second level.
   */
  readonly topLevel = computed(() => this._categories().filter((c) => c.parentId == null));

  /** Fetches once per locale. Concurrent callers share the one request. */
  load(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve();
    const locale = this.localeSvc.locale();
    if (this.loaded?.locale !== locale) this.loaded = { locale, promise: this.fetch(locale) };
    return this.loaded.promise;
  }

  private async fetch(locale: Locale): Promise<void> {
    try {
      const headers = { 'Accept-Language': locale, 'X-Locale': locale };
      this._categories.set(await this.categoriesSvc.list({ headers }));
    } catch {
      this._categories.set([]);
    }
  }
}
