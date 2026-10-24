/**
 * Mail date-format contract.
 *
 * Pins the exact strings the mail surface sends, the way `money.spec.ts` pins
 * the money display form. Two properties matter and each has its own block:
 *
 *   - the shape is the planning form (a weekday, not an ISO stamp), spelled
 *     the same way in every locale,
 *   - it is stable against the host, so a deploy box on a different `TZ` or a
 *     value handed over as a string rather than a `Date` cannot change what a
 *     customer reads.
 *
 * The timezone comes from the store's locale set (runtime config, DR-31), so
 * the cases that depend on it set the snapshot explicitly and restore it.
 */
import { NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { formatMailDate, formatMailDateTime } from './mail-date.util';
import { MAIL_LOCALES } from './mail.types';

/** 12 March 2026 is a Thursday. */
const THURSDAY = new Date('2026-03-12T09:15:00Z');

/** A store one hour ahead of UTC all year. */
const PLUS_ONE = {
  supportedLocales: ['fr', 'en', 'ar'],
  defaultLocale: 'fr',
  rtlLocales: ['ar'],
  timezone: 'Africa/Algiers',
};

afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('formatMailDate', () => {
  it('writes the French planning form', () => {
    expect(formatMailDate(THURSDAY, 'fr')).toBe('jeudi 12 mars 2026');
  });

  it('writes the English form day-first, matching the French order', () => {
    expect(formatMailDate(THURSDAY, 'en')).toBe('Thursday, 12 March 2026');
  });

  it('writes the Arabic form with the weekday and Latin digits', () => {
    const out = formatMailDate(THURSDAY, 'ar');
    expect(out).toContain('الخميس');
    expect(out).toContain('12');
    expect(out).toContain('2026');
    expect(out).not.toMatch(/[٠-٩]/);
  });

  it.each([...MAIL_LOCALES])('leads with the weekday in %s, never an ISO stamp', (locale) => {
    const out = formatMailDate(THURSDAY, locale);
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out).toMatch(/^(jeudi|Thursday|الخميس)/);
  });

  it('accepts the string and epoch forms a producer may hold', () => {
    expect(formatMailDate('2026-03-12T09:15:00Z', 'fr')).toBe('jeudi 12 mars 2026');
    expect(formatMailDate(THURSDAY.getTime(), 'fr')).toBe('jeudi 12 mars 2026');
  });

  /**
   * A gift card stored as midnight UTC must not read as the previous day. In
   * a store one hour ahead of UTC, the store timezone moves it forward into
   * the same calendar day rather than back out of it.
   */
  it('renders a midnight-UTC timestamp as that same calendar day in the store zone', () => {
    storeLocales.set(PLUS_ONE);
    expect(formatMailDate(new Date('2026-06-30T00:00:00Z'), 'fr')).toBe('mardi 30 juin 2026');
  });

  it('reads the zone from the store locale set, not the host', () => {
    storeLocales.set({ ...PLUS_ONE, timezone: 'Pacific/Honolulu' });
    // 00:30 UTC on 30 June is still 29 June in Honolulu.
    expect(formatMailDate(new Date('2026-06-30T00:30:00Z'), 'en')).toBe('Monday, 29 June 2026');
  });

  it.each([null, undefined, '', 'not a date'])(
    'returns an empty string for %p rather than "Invalid Date"',
    (value) => {
      for (const locale of MAIL_LOCALES) expect(formatMailDate(value, locale)).toBe('');
    },
  );
});

describe('formatMailDateTime', () => {
  it('writes the French form with the French connective', () => {
    expect(formatMailDateTime(THURSDAY, 'fr')).toBe('jeudi 12 mars 2026 à 09:15');
  });

  it('writes the English form with the English connective', () => {
    expect(formatMailDateTime(THURSDAY, 'en')).toBe('Thursday, 12 March 2026 at 09:15');
  });

  it('writes the Arabic form with the Arabic connective', () => {
    const out = formatMailDateTime(THURSDAY, 'ar');
    expect(out).toContain('الساعة');
    expect(out).toMatch(/09:15$/);
  });

  it('follows the store zone for the clock too', () => {
    storeLocales.set(PLUS_ONE);
    expect(formatMailDateTime(THURSDAY, 'fr')).toBe('jeudi 12 mars 2026 à 10:15');
  });

  it.each([...MAIL_LOCALES])('spells the day exactly as formatMailDate does (%s)', (locale) => {
    expect(formatMailDateTime(THURSDAY, locale)).toContain(formatMailDate(THURSDAY, locale));
  });

  it.each([...MAIL_LOCALES])('carries a 24-hour clock with no meridiem in %s', (locale) => {
    const out = formatMailDateTime(THURSDAY, locale);
    expect(out).toMatch(/\d{2}:\d{2}$/);
    expect(out).not.toMatch(/\b[AP]\.?M\.?\b/i);
    expect(out).not.toMatch(/[صم]$/);
  });

  // The value the contact form used to send read `2026-03-12T09:15:00.000Z`.
  it.each([...MAIL_LOCALES])('leaves no ISO stamp or UTC suffix in %s', (locale) => {
    const out = formatMailDateTime(THURSDAY, locale);
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out).not.toMatch(/[TZ]\d|\dZ$/);
  });

  it.each([null, undefined, '', 'not a date'])('returns an empty string for %p', (value) => {
    for (const locale of MAIL_LOCALES) expect(formatMailDateTime(value, locale)).toBe('');
  });
});
