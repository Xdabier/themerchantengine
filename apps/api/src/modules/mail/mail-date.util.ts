import { getLocaleDefinition, storeLocales } from '@common/locale';
import { type MailLocale } from './mail.types';
import { copyEntry, copyLocale } from './templates/layout';

/**
 * The single date formatter for every outbound message.
 *
 * A mail variable is copy, not data. Before this helper the gift-card expiry
 * reminder sent `expiresOn` as `2026-06-30` and the contact form sent
 * `submittedAt` as a full `toISOString()`, so a French message read
 * "expire le 2026-06-30" and a staff notice carried a `Z` suffix. Brand-floor
 * §8 sets the bar the other way round: "A dentist can do nothing with 'fast'
 * or 'unbeatable'. They can plan around 'Thursday' and '1 240 DT'." The
 * weekday is the part a practitioner plans around, so it is in the format
 * rather than left for the reader to work out from a numeric stamp.
 *
 * This is the mail surface's own formatter on purpose. The invoice PDF has its
 * own month table because pdfkit lays out glyph runs rather than composing a
 * sentence, and mail must not import from it: the two are separate surfaces
 * with separate typography, and coupling them would make an invoice-layout
 * edit a mail-copy edit.
 *
 * The counterpart for money is `formatMoney` in
 * `libs/shared/common/src/money/store-money.ts`, which states the same kind of rule
 * for amounts. Both keep the tax mention / connective copy out of the
 * formatter and in the template, so an operator editing a body can see it.
 */

/**
 * Every mail date is rendered in the store's own timezone, not the server's,
 * so a gift card stored as midnight UTC reads as the calendar day the customer
 * expects, and a contact-form stamp does not shift when the deploy host's `TZ`
 * changes. The zone is `localization.timezone` in the runtime config.
 */
function storeTimeZone(): string {
  return storeLocales.current().timezone;
}

/** The word joining a date to a time, in each locale's own form. */
const AT: Readonly<Record<string, string>> = {
  fr: 'à',
  en: 'at',
  ar: 'الساعة',
};

/** Input a producer actually holds: a Prisma `DateTime`, or nothing. */
export type MailDateInput = Date | string | number | null | undefined;

function toDate(value: MailDateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The registry's `Intl` tag for the locale the message is written in. English
 * is `en-GB`, not `en-US`, so the day-first order matches the French side. An
 * Arabic-script locale keeps Latin digits, as the money formatter does, so a
 * date and an amount in one sentence use one digit set.
 */
function tag(locale: MailLocale): string {
  const written = copyLocale(locale);
  const definition = getLocaleDefinition(written);
  const intlTag = definition?.intlTag ?? written;
  return definition?.script === 'arabic' ? `${intlTag}-u-nu-latn` : intlTag;
}

/**
 * A calendar day as a customer reads it: `jeudi 12 mars 2026` /
 * `Thursday, 12 March 2026`.
 *
 * Returns `''` for a missing or unparseable value, which is what the callers
 * already did for an absent date: a template branching on presence keeps
 * working, and no message renders the string `Invalid Date`.
 */
export function formatMailDate(value: MailDateInput, locale: MailLocale): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: storeTimeZone(),
  }).format(date);
}

/**
 * A moment as a reader reads it: `jeudi 12 mars 2026 à 10:15` /
 * `Thursday, 12 March 2026 at 10:15`.
 *
 * The same day form as `formatMailDate` plus a 24-hour clock, so the two never
 * disagree about how a date is spelled. 24-hour is not a locale choice here:
 * it is what the French and British tags both resolve to, and what a
 * business's own paperwork uses.
 */
export function formatMailDateTime(value: MailDateInput, locale: MailLocale): string {
  const date = toDate(value);
  if (!date) return '';
  const time = new Intl.DateTimeFormat(tag(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: storeTimeZone(),
  }).format(date);
  return `${formatMailDate(date, locale)} ${copyEntry(AT, locale)} ${time}`;
}
