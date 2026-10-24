import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { CmsService } from '@storefront-services';
import type { CmsPage } from '@storefront-types';

import { isLegacyCmsSlug } from '../../lib/routes';

/**
 * The CMS pages the chrome links to beyond its built-in entries.
 *
 * Browser-only and failure-tolerant on purpose. The footer's five built-in
 * links are core store IA and legally required copy, so they render in the SSR
 * HTML and must not depend on a fetch; everything this service adds is an
 * extra that appears after hydration. A CMS outage therefore costs the store
 * nothing but the extra links, and never a thrown boot error.
 *
 * Rows are filtered down to what the storefront can actually serve: published,
 * flagged for navigation, not one of the five slugs that already own a
 * dedicated route (`cmsPageRoute` sends those to their canonical URL, so
 * listing them here would print each of them twice), and single-segment, which
 * is the whole of what `/{locale}/pages/{slug}` matches.
 */
@Injectable({ providedIn: 'root' })
export class CmsNavService {
  private readonly cms = inject(CmsService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _pages = signal<CmsPage[]>([]);
  private inFlight: Promise<void> | null = null;

  /** Navigable pages, ordered by `sortOrder` then slug. Empty until loaded. */
  readonly pages = this._pages.asReadonly();

  /** Fetches once per app instance. Concurrent callers share the one request. */
  load(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve();
    this.inFlight ??= this.fetch();
    return this.inFlight;
  }

  private async fetch(): Promise<void> {
    try {
      const rows = await this.cms.listPages();
      this._pages.set(rows.filter(isNavigable).sort(byOrderThenSlug));
    } catch {
      // Deliberately silent: the built-in footer links are unaffected, and a
      // console error here would fail every console-baselined journey.
      this._pages.set([]);
    }
  }
}

function isNavigable(page: CmsPage): boolean {
  if (page.isPublished === false) return false;
  if (page.showInNavigation !== true) return false;
  if (isLegacyCmsSlug(page.slug)) return false;
  return !page.slug.replace(/^\/+|\/+$/g, '').includes('/');
}

function byOrderThenSlug(a: CmsPage, b: CmsPage): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.slug.localeCompare(b.slug);
}
