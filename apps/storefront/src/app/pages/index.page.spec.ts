import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCALE_COOKIE } from '../../lib/routes';
import { provideFixtureStoreConfig } from '../../test-support/store-config-fixtures';
import RootRedirectPage from './index.page';

function setNavigatorLanguages(languages: string[]): void {
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
}

function clearLocaleCookie(): void {
  document.cookie = `${LOCALE_COOKIE}=; Max-Age=0; path=/`;
}

describe('RootRedirectPage (browser-only root redirect)', () => {
  const navigateByUrl = vi.fn().mockResolvedValue(true);

  function redirectTarget(fixture: 'gulf-rtl' | 'maghreb-ltr' | 'trilingual'): string {
    TestBed.configureTestingModule({
      imports: [RootRedirectPage],
      providers: [
        provideFixtureStoreConfig(fixture),
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    TestBed.createComponent(RootRedirectPage).detectChanges();
    return navigateByUrl.mock.calls[0][0] as string;
  }

  beforeEach(() => {
    navigateByUrl.mockClear();
    clearLocaleCookie();
  });

  afterEach(() => {
    clearLocaleCookie();
  });

  it('lets the locale cookie win over Accept-Language, like the server middleware', () => {
    setNavigatorLanguages(['ar']);
    document.cookie = `${LOCALE_COOKIE}=en; path=/`;
    expect(redirectTarget('trilingual')).toBe('/en/');
  });

  it('uses Accept-Language when there is no cookie', () => {
    setNavigatorLanguages(['fr-FR', 'en']);
    expect(redirectTarget('trilingual')).toBe('/fr/');
  });

  it('falls back to the store default when nothing matches', () => {
    setNavigatorLanguages(['de-DE']);
    expect(redirectTarget('gulf-rtl')).toBe('/ar/');
  });

  it('skips a cookie and a header naming a locale the store does not serve', () => {
    setNavigatorLanguages(['fr']);
    document.cookie = `${LOCALE_COOKIE}=fr; path=/`;
    expect(redirectTarget('gulf-rtl')).toBe('/ar/');
  });
});
