/**
 * One timestamp vocabulary for the whole admin (plan E, finding E12).
 *
 * Before this there were fifteen private formatters plus four `DatePipe`
 * template formats, all of them reading the *browser's* locale and the
 * *browser's* timezone, and the audit log printed raw UTC ISO. An operator
 * could read three different renderings of the same instant on three screens.
 *
 * Three documented contexts, all computed in the store timezone with western
 * digits via the registry Intl tag (English unless a locale is passed):
 *  - `formatAdminDateTime` — the default for list and detail rows.
 *  - `formatAdminDate` — for genuinely date-only semantics (publish dates).
 *  - `formatAdminForensic` — audit/incident context: seconds plus an explicit
 *    UTC offset, so timestamps stay correlatable with server logs.
 *
 * Nullish input renders the em-dash placeholder; an unparseable string is
 * passed through untouched rather than hidden behind a dash.
 */

import { adminIntlTag } from './intl-tag';

export const DATE_PLACEHOLDER = '—';

type Instant = string | Date | null | undefined;

const BASE_DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

const BASE_TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/** `24 May 2026, 14:15` — list and detail rows. */
export function formatAdminDateTime(value: Instant, timeZone: string, locale?: string): string {
  return format(value, timeZone, { ...BASE_DATE, ...BASE_TIME }, locale);
}

/** `24 May 2026` — date-only semantics. */
export function formatAdminDate(value: Instant, timeZone: string, locale?: string): string {
  return format(value, timeZone, BASE_DATE, locale);
}

/** `24 May 2026, 03:32:42 GMT+3` — audit trails and incident correlation. */
export function formatAdminForensic(value: Instant, timeZone: string, locale?: string): string {
  return format(
    value,
    timeZone,
    { ...BASE_DATE, ...BASE_TIME, second: '2-digit', timeZoneName: 'shortOffset' },
    locale,
  );
}

function format(
  value: Instant,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  if (value === null || value === undefined || value === '') return DATE_PLACEHOLDER;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : DATE_PLACEHOLDER;
  const tag = adminIntlTag(locale);
  try {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone: safeZone(timeZone) }).format(date);
  } catch {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' }).format(date);
  }
}

/**
 * A misconfigured `settings.localization.timezone` must not throw on every
 * cell it touches; fall back to UTC, which is at least unambiguous.
 */
function safeZone(timeZone: string): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat(adminIntlTag(), { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}
