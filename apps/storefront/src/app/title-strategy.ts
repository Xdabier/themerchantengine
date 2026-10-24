import { Injectable, Injector, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { LocaleService } from './locale.service';
import { pageTitle } from '../lib/seo';

/**
 * Locale-aware `<title>` updater.
 *
 * Angular's default `TitleStrategy` only sets the title from
 * `route.title`. We additionally read the active locale from
 * `LocaleService.strings().meta.title` so screen readers announce the
 * correct localised page title on every navigation.
 *
 * Why `Injector` instead of `inject(LocaleService)` directly:
 * `LocaleService` injects `Router`, and `Router` instantiates this
 * `TitleStrategy` at boot. A direct `inject(LocaleService)` here would
 * close a `Router → TitleStrategy → LocaleService → Router` cycle
 * (NG0200) at SSR. Resolving `LocaleService` lazily inside
 * `updateTitle` defers the lookup until after `Router` is constructed.
 */
@Injectable({ providedIn: 'root' })
export class LocaleAwareTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly injector = inject(Injector);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    const baseTitle = this.injector.get(LocaleService).strings().meta.title;
    // Through `pageTitle` rather than a template literal: it drops the
    // separator when either half is empty, which is what keeps a store that
    // has not been named yet from shipping a title ending in a bare dot.
    this.title.setTitle(pageTitle(routeTitle ?? '', baseTitle));
  }
}
