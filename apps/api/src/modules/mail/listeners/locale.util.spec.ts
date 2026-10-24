/**
 * Characterization of `resolveLocale`, the single locale resolver for every
 * outbound message (D7 collapsed six copies of this rule into one).
 *
 * Pins the BCP-47 normalisation AND its polarity: anything the store has not
 * enabled resolves to the store default, whatever that is under the active
 * config (DR-31). The polarity is asserted under two scenario configs so the
 * rule cannot pass by matching a literal.
 */
import { NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { resolveLocale } from './locale.util';
import { defaultMailLocale } from '../mail.types';

const MAGHREB = {
  supportedLocales: ['fr', 'en'],
  defaultLocale: 'fr',
  rtlLocales: [],
  timezone: 'UTC',
};
const GULF = {
  supportedLocales: ['ar', 'en'],
  defaultLocale: 'ar',
  rtlLocales: ['ar'],
  timezone: 'UTC',
};

afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('resolveLocale under a French-default store', () => {
  beforeEach(() => storeLocales.set(MAGHREB));

  it.each([
    // No stored locale at all, the store default answers.
    [null, 'fr'],
    [undefined, 'fr'],
    ['', 'fr'],
    // French, in every shape a row can hold it.
    ['fr', 'fr'],
    ['FR', 'fr'],
    ['fr-CA', 'fr'],
    ['fr-FR', 'fr'],
    // English, likewise.
    ['en', 'en'],
    ['EN', 'en'],
    ['en-US', 'en'],
  ] as const)('maps %p to %p', (input, expected) => {
    expect(resolveLocale(input)).toBe(expected);
  });

  it.each([['ar'], ['ar-SA'], ['de-DE'], ['zz']] as const)(
    'resolves the unsupported %p to the store default, never to en',
    (input) => {
      expect(resolveLocale(input)).toBe('fr');
    },
  );

  it('falls back to the declared store default rather than a literal', () => {
    expect(defaultMailLocale()).toBe('fr');
    expect(resolveLocale(undefined)).toBe(defaultMailLocale());
  });
});

describe('resolveLocale under an Arabic-default store', () => {
  beforeEach(() => storeLocales.set(GULF));

  it('addresses a stranger in Arabic and keeps English for an English row', () => {
    expect(resolveLocale(undefined)).toBe('ar');
    expect(resolveLocale('ar-AE')).toBe('ar');
    expect(resolveLocale('en-GB')).toBe('en');
  });

  it('resolves a French row to Arabic because the store does not enable fr', () => {
    expect(resolveLocale('fr')).toBe('ar');
  });
});
