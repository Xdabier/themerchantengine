import { NEUTRAL_LOCALE_SET } from '@merchants/shared-common';
import * as tokenModule from './translatable-locales.token';
import {
  FALLBACK_TRANSLATABLE_LOCALE_TABS,
  buildLocaleTabs,
  localeTabCodes,
  orderLocaleTabs,
} from './translatable-locales.token';

/**
 * The tab list is two rules in one value: the order decides which locale is
 * mirrored into a Translatable's `default` key, and the direction decides
 * which way an editor types. Both are read from the store config, and both
 * were previously either hardcoded or absent.
 */
describe('orderLocaleTabs', () => {
  it('leads with the default, wherever the store listed it', () => {
    expect(orderLocaleTabs(['en', 'fr', 'ar'], 'ar')).toEqual(['ar', 'en', 'fr']);
  });

  it('leads with the default even when the supported list omits it', () => {
    expect(orderLocaleTabs(['en', 'fr'], 'ar')).toEqual(['ar', 'en', 'fr']);
  });

  it('never repeats the default', () => {
    expect(orderLocaleTabs(['ar', 'en'], 'ar')).toEqual(['ar', 'en']);
  });
});

describe('buildLocaleTabs', () => {
  it('marks only the locales the store configured as right-to-left', () => {
    expect(buildLocaleTabs(['en', 'ar'], 'en', ['ar'])).toEqual([
      { code: 'en', dir: 'ltr' },
      { code: 'ar', dir: 'rtl' },
    ]);
  });

  it('treats an unlisted locale as left-to-right rather than guessing from the code', () => {
    // The store decides. A language conventionally written right to left that
    // the store did not list stays left-to-right here, because overriding the
    // setting that exists to answer this is worse than honouring it.
    expect(buildLocaleTabs(['en', 'ar'], 'en')).toEqual([
      { code: 'en', dir: 'ltr' },
      { code: 'ar', dir: 'ltr' },
    ]);
  });

  it('keeps the default-first ordering the mirror rule depends on', () => {
    expect(buildLocaleTabs(['en', 'fr', 'ar'], 'ar', ['ar'])[0]).toEqual({
      code: 'ar',
      dir: 'rtl',
    });
  });

  it('ignores an rtl entry the store does not support', () => {
    expect(localeTabCodes(buildLocaleTabs(['en'], 'en', ['ar']))).toEqual(['en']);
  });
});

describe('localeTabCodes', () => {
  it('drops the direction for a consumer that only needs the codes', () => {
    expect(localeTabCodes(buildLocaleTabs(['fr', 'en'], 'fr'))).toEqual(['fr', 'en']);
  });
});

describe('FALLBACK_TRANSLATABLE_LOCALE_TABS', () => {
  it('is built from the neutral locale set, default first, with its rtl locales', () => {
    expect(FALLBACK_TRANSLATABLE_LOCALE_TABS).toEqual(
      buildLocaleTabs(
        NEUTRAL_LOCALE_SET.supportedLocales,
        NEUTRAL_LOCALE_SET.defaultLocale,
        NEUTRAL_LOCALE_SET.rtlLocales,
      ),
    );
    expect(FALLBACK_TRANSLATABLE_LOCALE_TABS[0]).toEqual({ code: 'ar', dir: 'rtl' });
  });

  it('no longer exports a fixed fallback pair', () => {
    expect('FALLBACK_TRANSLATABLE_LOCALES' in tokenModule).toBe(false);
  });
});
