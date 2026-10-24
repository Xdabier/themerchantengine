import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TRANSLATABLE_LOCALES, buildLocaleTabs } from '@admin-ui/atoms/translatable-locales.token';
import { appConfig } from './app.config';
import { StoreSettingsStore } from './core/stores/store-settings.store';

/**
 * The token's own default is covered by the atom specs. What is NOT covered
 * there is the wiring: that the application actually feeds it from the store
 * rather than leaving every editor on the fallback pair. A `useFactory` typo
 * here would be invisible to every component spec, because they all provide the
 * token directly.
 */
describe('appConfig TRANSLATABLE_LOCALES wiring', () => {
  it('resolves the token to the store locale tabs, not the token default', () => {
    const localeTabs = signal(buildLocaleTabs(['de', 'ar'], 'de', ['ar'])).asReadonly();
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        { provide: StoreSettingsStore, useValue: { localeTabs } },
      ],
    });

    expect(TestBed.inject(TRANSLATABLE_LOCALES)()).toEqual([
      { code: 'de', dir: 'ltr' },
      { code: 'ar', dir: 'rtl' },
    ]);
  });

  it('declares the token exactly once, so a later provider cannot silently shadow it', () => {
    const declarations = appConfig.providers.filter(
      (p): p is { provide: unknown } =>
        typeof p === 'object' && p !== null && 'provide' in p && p.provide === TRANSLATABLE_LOCALES,
    );
    expect(declarations).toHaveLength(1);
  });
});
