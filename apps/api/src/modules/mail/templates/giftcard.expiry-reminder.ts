import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyEntry,
  copyFor,
  BRAND_TOKENS,
  codeBlock,
  ctaButton,
  escapeHtml,
  escapeVars,
  renderLayout,
  renderText,
  NO_BREAK_SPACE,
  TAX_INCLUDED,
} from './layout';

export interface Vars {
  code: string;
  /** Already formatted for display by the producer. */
  balance: string;
  expiresOn: string;
  redemptionUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Date d'expiration de votre carte cadeau · ${s}`,
    preheader: "Solde restant et date d'expiration.",
    heading: "Date d'expiration de votre carte cadeau",
    body: (v: Vars, s: string) =>
      `Votre carte cadeau ${s} porte un solde de <strong>${v.balance} ${TAX_INCLUDED.fr}</strong> ` +
      `et expire le <strong>${v.expiresOn}</strong>.`,
    codeLabel: 'Code de la carte cadeau&nbsp;:',
    balanceLabel: `Solde restant${NO_BREAK_SPACE}:`,
    expiresLabel: `Date d'expiration${NO_BREAK_SPACE}:`,
    cta: 'Utiliser la carte',
  },
  en: {
    subject: (s: string) => `Your gift-card expiry date · ${s}`,
    preheader: 'Remaining balance and expiry date.',
    heading: 'Your gift-card expiry date',
    body: (v: Vars, s: string) =>
      `Your ${s} gift card holds <strong>${v.balance} ${TAX_INCLUDED.en}</strong> and expires on ` +
      `<strong>${v.expiresOn}</strong>.`,
    codeLabel: 'Gift-card code:',
    balanceLabel: 'Remaining balance:',
    expiresLabel: 'Expiry date:',
    cta: 'Use the card',
  },
  ar: {
    subject: (s: string) => `تاريخ انتهاء بطاقة الهدية · ${s}`,
    preheader: 'الرصيد المتبقي وتاريخ الانتهاء.',
    heading: 'تاريخ انتهاء بطاقة الهدية',
    body: (v: Vars, s: string) =>
      `تحمل بطاقة الهدية الخاصة بك من ${s} رصيداً قدره <strong>${v.balance} ${TAX_INCLUDED.ar}</strong> ` +
      `وتنتهي صلاحيتها في <strong>${v.expiresOn}</strong>.`,
    codeLabel: 'رمز بطاقة الهدية:',
    balanceLabel: 'الرصيد المتبقي:',
    expiresLabel: 'تاريخ الانتهاء:',
    cta: 'استخدام البطاقة',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 12px;">${t.body(e, escapeHtml(brand.storeName))}</p>
<p style="margin:16px 0 4px;color:${BRAND_TOKENS.muted};font-size:13px;">${t.codeLabel}</p>
${codeBlock(e.code)}
${ctaButton(e.redemptionUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      `${t.balanceLabel} ${vars.balance} ${copyEntry(TAX_INCLUDED, locale)}`,
      `${t.expiresLabel} ${vars.expiresOn}`,
      vars.code,
      vars.redemptionUrl,
    ]),
  };
}
