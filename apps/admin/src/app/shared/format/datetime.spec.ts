import {
  DATE_PLACEHOLDER,
  formatAdminDate,
  formatAdminDateTime,
  formatAdminForensic,
} from './datetime';

/**
 * The demo store zone. It observes daylight saving, so every instant below is
 * derived against the offset in force on its own date rather than against a
 * constant: May is UTC+2 here and January is UTC+1, and a fixture written for
 * one and asserted under the other is how a timezone test quietly stops
 * testing the timezone.
 */
const ZONE = 'Europe/Paris';

describe('admin datetime formatters', () => {
  it('renders month names in the requested registry locale with western digits', () => {
    expect(formatAdminDate('2026-05-24T11:15:00.000Z', ZONE, 'fr')).toBe('24 mai 2026');
    expect(formatAdminDate('2026-05-24T11:15:00.000Z', ZONE, 'ar')).toMatch(/^24 .+ 2026$/);
  });

  it('keeps English output for an unknown locale code', () => {
    expect(formatAdminDate('2026-05-24T11:15:00.000Z', ZONE, 'xx')).toBe('24 May 2026');
  });

  it('renders list/detail timestamps in the store timezone', () => {
    expect(formatAdminDateTime('2026-05-24T11:15:00.000Z', ZONE)).toBe('24 May 2026, 13:15');
  });

  it('renders date-only values without a time', () => {
    expect(formatAdminDate('2026-05-24T11:15:00.000Z', ZONE)).toBe('24 May 2026');
  });

  it('renders forensic timestamps with seconds and an explicit offset', () => {
    expect(formatAdminForensic('2026-05-24T02:32:42.000Z', ZONE)).toBe(
      '24 May 2026, 04:32:42 GMT+2',
    );

    // The same clock time in January, when the zone is an hour further back.
    expect(formatAdminForensic('2026-01-24T02:32:42.000Z', ZONE)).toBe(
      '24 Jan 2026, 03:32:42 GMT+1',
    );
  });

  it('shifts the calendar day when the store timezone crosses midnight', () => {
    // 22:30 UTC is already the next day in the store zone, which is UTC+2 on
    // this date. The instant is re-derived for the zone rather than the
    // expected string shifted, or the case stops landing on the crossing it
    // exists to prove.
    expect(formatAdminDateTime('2026-05-24T22:30:00.000Z', ZONE)).toBe('25 May 2026, 00:30');
  });

  it('uses a 24-hour clock, never 12:00 AM', () => {
    // Midnight in the store zone on this date is 22:00 UTC, because May is
    // UTC+2 here. Shifting the expected string alone would have moved this off
    // the midnight case the test exists to prove.
    expect(formatAdminDateTime('2026-05-23T22:00:00.000Z', ZONE)).toBe('24 May 2026, 00:00');
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(formatAdminDate(new Date('2026-05-24T11:15:00.000Z'), ZONE)).toBe('24 May 2026');
  });

  it('renders the placeholder for nullish input', () => {
    expect(formatAdminDateTime(null, ZONE)).toBe(DATE_PLACEHOLDER);
    expect(formatAdminDate(undefined, ZONE)).toBe(DATE_PLACEHOLDER);
    expect(formatAdminForensic('', ZONE)).toBe(DATE_PLACEHOLDER);
  });

  it('passes an unparseable string through untouched', () => {
    expect(formatAdminDateTime('not-a-date', ZONE)).toBe('not-a-date');
  });

  it('falls back to UTC when the store timezone is malformed', () => {
    expect(formatAdminDateTime('2026-05-24T11:15:00.000Z', 'Not/AZone')).toBe('24 May 2026, 11:15');
    expect(formatAdminDateTime('2026-05-24T11:15:00.000Z', '')).toBe('24 May 2026, 11:15');
  });
});
