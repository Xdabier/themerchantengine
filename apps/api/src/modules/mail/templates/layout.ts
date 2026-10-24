/**
 * Shared HTML wrapper for transactional emails, brand floor inlined.
 *
 * A paper ground, ink prose, one flat accent band for the header, a display
 * face for the heading, a mono face for identifiers. Inline CSS only, Gmail
 * and Outlook strip `<style>` blocks, and neither loads a web font, so each
 * stack ends in a system fallback.
 *
 * The store name is never a literal here: the renderer resolves it from the
 * runtime config for the message locale and hands it in (DR-31), so the same
 * engine speaks for any store.
 *
 * Direction is read from the store's locale set (`storeLocales.direction`),
 * never guessed from the locale code, so a store that enables a right-to-left
 * locale gets `dir="rtl"` and right-aligned blocks without a code change.
 */
import { getLocaleDefinition, storeLocales } from '@common/locale';
import { defaultMailLocale, type MailLocale } from '../mail.types';

/**
 * The locale a message is actually written in: the requested one when the mail
 * tree ships copy for it, else the store default. Direction, `lang`, alignment,
 * typography and date format all follow this, so a fallback message is
 * consistently in one language (DR-33).
 */
export function copyLocale(locale: MailLocale): MailLocale {
  return Object.prototype.hasOwnProperty.call(FOOTER_NOTE, locale) ? locale : defaultMailLocale();
}

/**
 * The copy for a locale, merged over the store default's copy and then over
 * the first copy block shipped, one level deep. A locale a template has no copy
 * for, or a key it lacks, reads the default's text instead of `undefined`
 * (DR-33). A nested block a locale supplies replaces the default's whole block.
 */
export function copyFor<C extends Record<string, object>>(copy: C, locale: MailLocale): C[keyof C] {
  const first = Object.values(copy)[0];
  return { ...first, ...copy[defaultMailLocale()], ...copy[locale] } as C[keyof C];
}

/** One entry of a per-locale record: the locale, else the store default, else the first. */
export function copyEntry<V>(record: Readonly<Record<string, V>>, locale: MailLocale): V {
  return record[locale] ?? record[defaultMailLocale()] ?? Object.values(record)[0];
}

/** The space a locale puts before `; : ! ?`, from the registry (empty when none). */
export function highPunctuationSpace(locale: MailLocale): string {
  return getLocaleDefinition(copyLocale(locale))?.typography.spaceBeforeHighPunctuation
    ? NO_BREAK_SPACE
    : '';
}

export interface LayoutOpts {
  locale: MailLocale;
  /** The store name resolved to the message locale. Printed in the chrome. */
  storeName: string;
  /** Inbox-preview line (~100 chars). Falls back to empty. */
  preheader?: string;
  /** Main `<body>` inner content, already interpolated. */
  body: string;
  /**
   * RFC 8058 unsubscribe URL (NE7). When present (consented LIFECYCLE/MARKETING
   * sends only) a localized footer link is rendered; absent for transactional
   * mail, which legally needs no unsubscribe affordance.
   */
  unsubscribeUrl?: string;
}

const BRAND = {
  primary: '#5043BF', // accent, links
  primaryDark: '#3E33A0', // deep accent, the ground for small white text
  text: '#0A1A26', // ink
  muted: '#55606A', // interface grey
  surface: '#EEEDFB', // tint
  border: '#E4E6EB', // rule
  paper: '#FFFFFF', // paper
} as const;

const PROSE = "'Inter',system-ui,-apple-system,Segoe UI,sans-serif";
const DISPLAY = "'Baloo 2','Inter',system-ui,-apple-system,Segoe UI,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace";

const FOOTER_NOTE: Record<MailLocale, (storeName: string) => string> = {
  fr: (s) => `Message envoyé par ${s}. Cette adresse ne reçoit pas de réponse.`,
  en: (s) => `Sent by ${s}. This address does not accept replies.`,
  ar: (s) => `رسالة مرسلة من ${s}. هذا العنوان لا يستقبل الردود.`,
};

const UNSUBSCRIBE_LABEL: Record<MailLocale, string> = {
  fr: 'Se désabonner',
  en: 'Unsubscribe',
  ar: 'إلغاء الاشتراك',
};

/** The `text-align` value matching the store's direction for this locale. */
export function textAlign(locale: MailLocale): 'left' | 'right' {
  return storeLocales.direction(locale) === 'rtl' ? 'right' : 'left';
}

export function renderLayout(opts: LayoutOpts): string {
  const dir = storeLocales.direction(opts.locale);
  const align = textAlign(opts.locale);
  const storeName = escapeHtml(opts.storeName);
  const preheader = opts.preheader ?? '';
  const unsubscribe = opts.unsubscribeUrl
    ? `<div style="margin-top:8px;">
            <a href="${opts.unsubscribeUrl}" style="color:${BRAND.muted};text-decoration:underline;">${copyEntry(UNSUBSCRIBE_LABEL, opts.locale)}</a>
          </div>`
    : '';
  return `<!doctype html>
<html dir="${dir}" lang="${opts.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${storeName}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.paper};color:${BRAND.text};font-family:${PROSE};font-size:16px;line-height:1.55;">
<span style="display:none;font-size:1px;color:${BRAND.paper};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.paper};">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:${BRAND.paper};">
        <tr>
          <td style="background:${BRAND.primaryDark};color:${BRAND.paper};padding:20px 32px;font-family:${DISPLAY};font-weight:600;font-size:20px;text-align:${align};">
            ${storeName}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;text-align:${align};">
            ${opts.body}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;color:${BRAND.muted};font-size:12px;text-align:${align};border-top:1px solid ${BRAND.border};">
            ${copyEntry(FOOTER_NOTE, opts.locale)(storeName)}
            ${unsubscribe}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Branded CTA button, used by every action-URL template. */
export function ctaButton(href: string, label: string, locale: MailLocale): string {
  return `<div style="margin:24px 0;text-align:${textAlign(locale)};">
  <a href="${href}" style="display:inline-block;background:${BRAND.primaryDark};color:${BRAND.paper};padding:12px 28px;text-decoration:none;font-weight:600;font-size:15px;border:1px solid ${BRAND.primaryDark};">
    ${label}
  </a>
</div>`;
}

/**
 * Monospace identifier block, gift-card codes, verification codes, order
 * references. Mono is strictly for identifiers.
 */
export function codeBlock(code: string): string {
  return `<div style="margin:24px 0;padding:16px 20px;background:${BRAND.surface};color:${BRAND.text};font-family:${MONO};font-size:18px;font-weight:500;letter-spacing:0.08em;display:inline-block;">
  ${code}
</div>`;
}

/**
 * Inline monospace identifier: an order, return, tracking or invoice number
 * sitting inside a sentence.
 *
 * `codeBlock` above is the standalone form, for a code the reader has to copy
 * out. This is the same face at prose size, for a reference the reader only has
 * to recognise. Mono is never a styling effect, so this is not the helper to
 * reach for to emphasise a word.
 *
 * A money value keeps `<strong>` deliberately: prices are set in tabular
 * numerals rather than mono.
 *
 * `white-space:nowrap` so a reference never breaks across a line, which is what
 * makes it unreadable back to a support agent over the phone.
 */
export function monoId(value: string): string {
  return `<span style="font-family:${MONO};font-weight:500;white-space:nowrap;">${value}</span>`;
}

/**
 * Character map for `escapeHtml`. Kept identical to `render.ts`'s own map so
 * the two renderer tiers escape the same five characters the same way.
 */
const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * HTML-escape one value. Mirrors `render.ts` `escapeHtml` character for
 * character: the DB tier escapes `{{token}}` on the way in, this tier escapes
 * `${vars.x}` at the template's own call site.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

/**
 * Shallow copy of a template's `vars` with every string value HTML-escaped.
 * Non-strings pass through untouched, so counts stay numbers and an absent
 * optional stays `undefined` (templates branch on presence, not on `''`).
 *
 * Use the copy for the HTML body only. The plain-text part is not markup, so it
 * keeps the raw values: a customer must read `&`, never `&amp;`. Same for the
 * subject, which is a mail header rather than markup.
 *
 * Escaping a URL bound for an `href` is intended: `&` becomes `&amp;`, the
 * valid attribute form, which every client decodes back before navigating.
 */
export function escapeVars<T extends object>(vars: T): T {
  const escaped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vars) as Array<[string, unknown]>) {
    escaped[key] = typeof value === 'string' ? escapeHtml(value) : value;
  }
  return escaped as unknown as T;
}

/** Plain-text companion built from a structured outline. */
export function renderText(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export const BRAND_TOKENS = BRAND;
export const MAIL_FONT_STACKS = { prose: PROSE, display: DISPLAY, mono: MONO } as const;

/**
 * No-break space before a French colon. A body carries the `&nbsp;` entity; a
 * subject line is a mail header rather than markup, and a plain-text arm is
 * read as-is, so both need the codepoint itself.
 *
 * Built with `String.fromCodePoint` rather than typed into the literal: an
 * invisible character pasted into source is exactly what a whitespace-
 * normalising editor or formatter silently turns back into a plain space, with
 * nothing in the diff to show it happened.
 */
export const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

/**
 * The tax mention printed beside a paid total (`TTC`) and beside a catalogue
 * or line figure (`HT`), per locale. Literal copy rather than a formatter
 * concern, so an operator editing a body can see it.
 */
export const TAX_INCLUDED: Record<MailLocale, string> = {
  fr: 'TTC',
  en: 'TTC',
  ar: 'شامل الضريبة',
};

export const TAX_EXCLUDED: Record<MailLocale, string> = {
  fr: 'HT',
  en: 'HT',
  ar: 'دون احتساب الضريبة',
};
