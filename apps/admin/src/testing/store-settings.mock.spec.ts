import { TestBed } from '@angular/core/testing';
import { StoreSettingsStore } from '../app/core/stores/store-settings.store';
import { provideStoreSettingsStub } from './store-settings.mock';

describe('provideStoreSettingsStub', () => {
  function stubWith(...args: Parameters<typeof provideStoreSettingsStub>) {
    TestBed.configureTestingModule({ providers: [provideStoreSettingsStub(...args)] });
    return TestBed.inject(StoreSettingsStore);
  }

  it('takes the writing direction of each locale from the registry by default', () => {
    const store = stubWith('Europe/Paris', ['fr', 'en', 'ar']);
    expect(store.rtlLocales()).toEqual(['ar']);
    expect(store.localeTabs().map((tab) => [tab.code, tab.dir])).toEqual([
      ['fr', 'ltr'],
      ['en', 'ltr'],
      ['ar', 'rtl'],
    ]);
  });

  it('has no right to left locale for the demo pair', () => {
    const store = stubWith();
    expect(store.rtlLocales()).toEqual([]);
  });

  it('lets a spec override the directions explicitly', () => {
    const store = stubWith('Europe/Paris', ['fr', 'en'], undefined, ['en']);
    expect(store.rtlLocales()).toEqual(['en']);
  });
});
