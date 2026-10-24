import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyEntry,
  copyFor,
  BRAND_TOKENS,
  codeBlock,
  ctaButton,
  escapeVars,
  renderLayout,
  renderText,
  NO_BREAK_SPACE,
  TAX_INCLUDED,
} from './layout';

export interface Vars {
  code: string;
  /** Already formatted for display by the dispatch resolver. */
  balance: string;
  redemptionUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Avoir crédité sur votre compte · ${s}`,
    preheader: 'Le code et le montant de votre avoir.',
    heading: 'Avoir crédité',
    body: (vars: Vars) =>
      `Votre compte dispose d'un avoir de <strong>${vars.balance} ${TAX_INCLUDED.fr}</strong>. ` +
      `Saisissez le code ci-dessous au moment du paiement&nbsp;: le solde reste utilisable sur ` +
      `plusieurs commandes, un règlement partiel est accepté.`,
    codeLabel: "Code de l'avoir&nbsp;:",
    amountLabel: `Montant de l'avoir${NO_BREAK_SPACE}:`,
    cta: 'Voir le catalogue',
  },
  en: {
    subject: (s: string) => `Store credit added to your account · ${s}`,
    preheader: 'Your store-credit code and amount.',
    heading: 'Store credit added',
    body: (vars: Vars) =>
      `Your account holds <strong>${vars.balance} ${TAX_INCLUDED.en}</strong> in store credit. Enter ` +
      `the code below at checkout: the balance stays usable across several orders, and partial ` +
      `payment is accepted.`,
    codeLabel: 'Store-credit code:',
    amountLabel: 'Store-credit amount:',
    cta: 'View the catalogue',
  },
  ar: {
    subject: (s: string) => `تمت إضافة رصيد إلى حسابك · ${s}`,
    preheader: 'رمز الرصيد ومبلغه.',
    heading: 'تمت إضافة رصيد',
    body: (vars: Vars) =>
      `يحتوي حسابك على رصيد بقيمة <strong>${vars.balance} ${TAX_INCLUDED.ar}</strong>. أدخل ` +
      `الرمز أدناه عند الدفع: يبقى الرصيد قابلاً للاستخدام في عدة طلبات، ويُقبل الدفع الجزئي.`,
    codeLabel: 'رمز الرصيد:',
    amountLabel: 'قيمة الرصيد:',
    cta: 'عرض الكتالوج',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
<p style="margin:16px 0 4px;color:${BRAND_TOKENS.muted};font-size:13px;">${t.codeLabel}</p>
${codeBlock(e.code)}
${ctaButton(e.redemptionUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      `${t.amountLabel} ${vars.balance} ${copyEntry(TAX_INCLUDED, locale)}`,
      vars.code,
      vars.redemptionUrl,
    ]),
  };
}
