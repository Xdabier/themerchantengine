/**
 * A language the registry knows but no template ships copy for (DR-33).
 *
 * A fourth locale enabled at runtime must never blank a message: every flow
 * falls back to the store default and is written entirely in it, copy and
 * presentation alike (direction, `lang`, alignment, typography, date format).
 * The scratch locales below have no copy anywhere, so each flow renders
 * exactly like the default.
 */
import {
  NEUTRAL_LOCALE_SET,
  registerScratchLocale,
  storeLocales,
  type LocaleSet,
} from '@common/locale';
import { formatMailDate, formatMailDateTime } from '../mail-date.util';
import { type MailBrand, type MailJobName } from '../mail.types';
import { copyEntry, copyFor, highPunctuationSpace } from './layout';
import { renderDraft } from './render';
import { TEMPLATE_REGISTRY } from './registry';
import { SAMPLE_VARS } from './sample-vars';

const BRAND: MailBrand = { storeName: 'Maison Exemple' };
const LTR = 'xx';
const RTL = 'xr';
const WHEN = '2026-03-12T09:15:00Z';

function storeWith(defaultLocale: string): LocaleSet {
  return {
    supportedLocales: ['fr', 'en', 'ar', LTR, RTL],
    defaultLocale,
    rtlLocales: ['ar', RTL],
    timezone: 'UTC',
  };
}

const unregister: Array<() => void> = [];

beforeAll(() => {
  unregister.push(registerScratchLocale(LTR), registerScratchLocale(RTL, 'rtl'));
});
afterAll(() => unregister.forEach((remove) => remove()));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe.each([
  { defaultLocale: 'fr', scratch: LTR, dir: 'ltr' },
  { defaultLocale: 'ar', scratch: LTR, dir: 'rtl' },
  { defaultLocale: 'fr', scratch: RTL, dir: 'ltr' },
  { defaultLocale: 'ar', scratch: RTL, dir: 'rtl' },
])(
  'store default $defaultLocale, locale $scratch with no copy',
  ({ defaultLocale, scratch, dir }) => {
    beforeEach(() => storeLocales.set(storeWith(defaultLocale)));

    it.each(Object.keys(TEMPLATE_REGISTRY) as MailJobName[])(
      '%s renders exactly like the store default',
      (code) => {
        const fallback = TEMPLATE_REGISTRY[code](scratch, SAMPLE_VARS, BRAND);
        const reference = TEMPLATE_REGISTRY[code](defaultLocale, SAMPLE_VARS, BRAND);
        expect(fallback).toEqual(reference);
        expect(fallback.html).toContain(`lang="${defaultLocale}"`);
        expect(fallback.html).toContain(`dir="${dir}"`);
      },
    );

    it('writes dates in the store default', () => {
      expect(formatMailDate(WHEN, scratch)).toBe(formatMailDate(WHEN, defaultLocale));
      expect(formatMailDateTime(WHEN, scratch)).toBe(formatMailDateTime(WHEN, defaultLocale));
    });

    it('reads the high-punctuation space as the store default does', () => {
      expect(highPunctuationSpace(scratch)).toBe(highPunctuationSpace(defaultLocale));
    });
  },
);

describe.each([
  { defaultLocale: 'fr', scratch: LTR, dir: 'ltr' },
  { defaultLocale: 'ar', scratch: LTR, dir: 'rtl' },
  { defaultLocale: 'fr', scratch: RTL, dir: 'ltr' },
  { defaultLocale: 'ar', scratch: RTL, dir: 'rtl' },
])('db draft, store default $defaultLocale, locale $scratch', ({ defaultLocale, scratch, dir }) => {
  const subject = { fr: 'Sujet', en: 'Subject', ar: 'موضوع' };
  const body = { fr: '<p>Bonjour</p>', en: '<p>Hello</p>', ar: '<p>مرحبا</p>' };
  const draft = (locale: string, extra: Record<string, string> = {}) =>
    renderDraft({
      subject: { ...subject, ...extra },
      body: { ...body, ...extra },
      locale,
      variables: {},
      storeName: BRAND.storeName,
      unsubscribeUrl: 'https://example.test/u',
    });

  beforeEach(() => storeLocales.set(storeWith(defaultLocale)));

  it('is written wholly in the store default when the draft has no copy for the locale', () => {
    const fallback = draft(scratch);
    expect(fallback).toEqual(draft(defaultLocale));
    expect(fallback.html).toContain(`lang="${defaultLocale}"`);
    expect(fallback.html).toContain(`dir="${dir}"`);
  });

  it('keeps the locale of a draft that carries its own copy', () => {
    const own = draft(scratch, { [scratch]: 'own' });
    expect(own.subject).toBe('own');
    expect(own.html).toContain(`lang="${scratch}"`);
    expect(own.html).toContain(`dir="${scratch === RTL ? 'rtl' : 'ltr'}"`);
  });
});

describe('copy helpers', () => {
  beforeEach(() => storeLocales.set(storeWith('fr')));

  it('fills a key the locale lacks from the store default, key by key', () => {
    const copy = { fr: { a: 'un', b: 'deux' }, en: { a: 'one', b: 'two' } };
    const partial = { ...copy, [LTR]: { a: 'xx-one' } };
    expect(copyFor(partial, LTR)).toEqual({ a: 'xx-one', b: 'deux' });
    expect(copyFor(copy, 'en')).toEqual({ a: 'one', b: 'two' });
  });

  it('picks a single entry through the same chain', () => {
    expect(copyEntry({ fr: 'TTC', en: 'incl.' }, LTR)).toBe('TTC');
  });

  it('reads the high-punctuation space from the registry, not the code', () => {
    expect(highPunctuationSpace('fr')).not.toBe('');
    expect(highPunctuationSpace('en')).toBe('');
  });
});
