import { PLATFORM_ID, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleService } from './locale.service';
import { LOCALE_COOKIE } from '../lib/routes';
import { provideFixtureStoreConfig } from '../test-support/store-config-fixtures';

describe('LocaleService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    const html = document.documentElement;
    html.removeAttribute('lang');
    html.removeAttribute('dir');
    clearLocaleCookie();
    TestBed.resetTestingModule();
  });

  /** jsdom keeps `document.cookie` across tests in a file; expire it explicitly
   * so a "was the cookie written?" assertion answers about THIS test only. */
  function clearLocaleCookie() {
    document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`;
  }

  function inject(extraProviders: Provider[] = []) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), ...extraProviders] });
    const service = TestBed.inject(LocaleService);
    TestBed.tick();
    return service;
  }

  it('resolves the default locale and reflects lang onto the document element', () => {
    const service = inject();
    expect(service.locale()).toBe('fr');
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
  });

  it('writes ltr for a locale the store does not list as right-to-left', () => {
    inject();
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('writes rtl for a locale the store lists as right-to-left', () => {
    // The load-bearing half. This file asserted `never rtl` as a permanent
    // invariant until plan E2.3 made direction runtime config, and it would
    // have stayed green through an implementation that never flipped.
    //
    // Driven through the path the service actually reads, not a setter added
    // for the test: the initial locale comes from `document.location`.
    window.history.replaceState({}, '', '/ar/');
    const service = inject([provideFixtureStoreConfig('gulf-rtl')]);

    expect(service.locale()).toBe('ar');
    expect(service.direction()).toBe('rtl');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('persists the resolved locale into the storefront_locale cookie', () => {
    // The Nitro root redirect reads this cookie before Accept-Language, so
    // without the writer the cookie branch of that redirect can never fire.
    inject();
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=fr`);
  });

  it('does not write the cookie during SSR (PLATFORM_ID=server)', () => {
    // `persistLocale` is gated on `isPlatformBrowser(inject(PLATFORM_ID))`.
    // Every other case in this file runs under the default TestBed platform,
    // which is the browser, so the guard itself is never executed: dropping it
    // would leave all of them green. Overriding PLATFORM_ID is the only way to
    // reach the server branch.
    clearLocaleCookie();

    expect(() => inject([{ provide: PLATFORM_ID, useValue: 'server' }])).not.toThrow();

    expect(document.cookie).not.toContain(`${LOCALE_COOKIE}=`);
  });

  it('still reflects lang + dir onto the document during SSR', () => {
    // The guard is deliberately narrow: only the cookie write is browser-only.
    // SSR must still render `lang` / `dir` on the document element, so this
    // pins that the guard was not widened to swallow the whole effect.
    const service = inject([{ provide: PLATFORM_ID, useValue: 'server' }]);

    expect(service.locale()).toBe('fr');
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });
});
