import { TestBed } from '@angular/core/testing';
import { provideRouter, NavigationEnd, NavigationStart, Router } from '@angular/router';
import { provideZoneChangeDetection, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppComponent } from './app.component';
import { LocaleService } from './locale.service';
import { getChromeStrings } from '../i18n';
import type { Locale } from '../i18n/types';

class FakeLocaleService {
  readonly _locale = signal<Locale>('en');
  readonly _url = signal('/en/');
  readonly locale = this._locale.asReadonly();
  readonly currentUrl = this._url.asReadonly();
  readonly strings = signal(getChromeStrings('en'));
}

function setup() {
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([{ path: '**', redirectTo: '' }]),
      { provide: LocaleService, useValue: new FakeLocaleService() },
    ],
  });
  // Replace the AppComponent template with a stub so we don't need to
  // bootstrap the full LayoutShell (which pulls Cart / Account / API client
  // bindings via DI). The B3 scroll-restoration wiring lives in the
  // constructor, so it runs before any rendering.
  TestBed.overrideComponent(AppComponent, {
    set: { template: '', imports: [] },
  });
  const fixture = TestBed.createComponent(AppComponent);
  return { fixture, router: TestBed.inject(Router) };
}

describe('AppComponent — B3 scroll restoration', () => {
  let scrollSpy: ReturnType<typeof vi.fn>;
  let originalScrollTo: typeof window.scrollTo;
  const originalRestoration =
    typeof history !== 'undefined'
      ? (history.scrollRestoration as ScrollRestoration | undefined)
      : undefined;

  beforeEach(() => {
    scrollSpy = vi.fn();
    originalScrollTo = window.scrollTo;
    Object.defineProperty(window, 'scrollTo', { value: scrollSpy, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'scrollTo', { value: originalScrollTo, writable: true });
    if (typeof history !== 'undefined' && 'scrollRestoration' in history && originalRestoration) {
      history.scrollRestoration = originalRestoration;
    }
  });

  function emit(router: Router, trigger: 'imperative' | 'popstate' | 'hashchange'): void {
    const navStart = new NavigationStart(1, '/next', trigger as never);
    (router.events as unknown as { next: (event: unknown) => void }).next(navStart);
    const navEnd = new NavigationEnd(1, '/next', '/next');
    (router.events as unknown as { next: (event: unknown) => void }).next(navEnd);
  }

  it('sets history.scrollRestoration to auto so popstate restores the prior offset', () => {
    setup();
    if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
      expect(history.scrollRestoration).toBe('auto');
    }
  });

  it('scrolls to top on imperative router push (NavigationEnd preceded by imperative trigger)', () => {
    const { router } = setup();
    emit(router, 'imperative');
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0, left: 0, behavior: 'instant' }),
    );
  });

  it('scrolls to top on hashchange-triggered navigation', () => {
    const { router } = setup();
    emit(router, 'hashchange');
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT scroll on popstate so back / forward restores the prior offset', () => {
    const { router } = setup();
    emit(router, 'popstate');
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('handles consecutive imperative pushes — one scroll per nav', () => {
    const { router } = setup();
    emit(router, 'imperative');
    emit(router, 'imperative');
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });
});
