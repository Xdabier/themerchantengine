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
  /** Already formatted for display by the dispatch resolver. */
  initialBalance: string;
  recipientName?: string;
  purchaserName?: string;
  personalMessage?: string;
  redemptionUrl: string;
}

/** The recipient's name as a sentence opener, or nothing when it is unknown. */
const opener = (name: string | undefined, separator: string) =>
  name ? `${name}${separator} ` : '';

const COPY = {
  fr: {
    subject: (vars: Vars, s: string) =>
      vars.purchaserName
        ? `${vars.purchaserName} vous offre une carte cadeau · ${s}`
        : `Votre carte cadeau · ${s}`,
    preheader: 'Le code et le montant de votre carte cadeau.',
    heading: 'Votre carte cadeau',
    intro: (vars: Vars, s: string) =>
      vars.purchaserName
        ? `${opener(vars.recipientName, ',')}<strong>${vars.purchaserName}</strong> vous offre une carte cadeau ${s} de <strong>${vars.initialBalance} ${TAX_INCLUDED.fr}</strong>.`
        : `${opener(vars.recipientName, ',')}une carte cadeau ${s} de <strong>${vars.initialBalance} ${TAX_INCLUDED.fr}</strong> a été émise à votre nom.`,
    msgLabel: 'Message joint&nbsp;:',
    codeLabel: 'Code de la carte cadeau&nbsp;:',
    amountLabel: `Montant de la carte${NO_BREAK_SPACE}:`,
    cta: 'Utiliser la carte',
    howTo:
      'Saisissez ce code au moment du paiement. Le solde reste utilisable sur plusieurs commandes, un règlement partiel est accepté.',
  },
  en: {
    subject: (vars: Vars, s: string) =>
      vars.purchaserName
        ? `${vars.purchaserName} sent you a gift card · ${s}`
        : `Your gift card · ${s}`,
    preheader: 'Your gift-card code and amount.',
    heading: 'Your gift card',
    intro: (vars: Vars, s: string) =>
      vars.purchaserName
        ? `${opener(vars.recipientName, ',')}<strong>${vars.purchaserName}</strong> sent you a ${s} gift card for <strong>${vars.initialBalance} ${TAX_INCLUDED.en}</strong>.`
        : `${opener(vars.recipientName, ',')}a ${s} gift card for <strong>${vars.initialBalance} ${TAX_INCLUDED.en}</strong> has been issued in your name.`,
    msgLabel: 'Attached message:',
    codeLabel: 'Gift-card code:',
    amountLabel: 'Card amount:',
    cta: 'Use the card',
    howTo:
      'Enter this code at checkout. The balance stays usable across several orders, and partial payment is accepted.',
  },
  ar: {
    subject: (vars: Vars, s: string) =>
      vars.purchaserName
        ? `${vars.purchaserName} يهديك بطاقة هدية · ${s}`
        : `بطاقة الهدية الخاصة بك · ${s}`,
    preheader: 'رمز بطاقة الهدية ومبلغها.',
    heading: 'بطاقة الهدية الخاصة بك',
    intro: (vars: Vars, s: string) =>
      vars.purchaserName
        ? `${opener(vars.recipientName, '،')}<strong>${vars.purchaserName}</strong> يهديك بطاقة هدية من ${s} بقيمة <strong>${vars.initialBalance} ${TAX_INCLUDED.ar}</strong>.`
        : `${opener(vars.recipientName, '،')}تم إصدار بطاقة هدية من ${s} باسمك بقيمة <strong>${vars.initialBalance} ${TAX_INCLUDED.ar}</strong>.`,
    msgLabel: 'الرسالة المرفقة:',
    codeLabel: 'رمز بطاقة الهدية:',
    amountLabel: 'قيمة البطاقة:',
    cta: 'استخدام البطاقة',
    howTo:
      'أدخل هذا الرمز عند الدفع. يبقى الرصيد قابلاً للاستخدام في عدة طلبات، ويُقبل الدفع الجزئي.',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const messageBlock = e.personalMessage
    ? `<div style="margin:16px 0;padding:14px 18px;background:${BRAND_TOKENS.paper};border:1px solid ${BRAND_TOKENS.border};">
         <div style="color:${BRAND_TOKENS.muted};font-size:12px;margin-bottom:6px;">${t.msgLabel}</div>
         <div style="font-style:italic;">${e.personalMessage}</div>
       </div>`
    : '';
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 12px;">${t.intro(e, escapeHtml(brand.storeName))}</p>
${messageBlock}
<p style="margin:16px 0 4px;color:${BRAND_TOKENS.muted};font-size:13px;">${t.codeLabel}</p>
${codeBlock(e.code)}
<p style="margin:8px 0 16px;">${t.howTo}</p>
${ctaButton(e.redemptionUrl, t.cta, locale)}`;
  return {
    subject: t.subject(vars, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      // The recipient's name lives in `intro`, so a text-only reader gets an
      // unaddressed message unless the intro is rendered here too.
      t.intro(vars, brand.storeName),
      `${t.amountLabel} ${vars.initialBalance} ${copyEntry(TAX_INCLUDED, locale)}`,
      vars.personalMessage ?? '',
      vars.code,
      vars.redemptionUrl,
    ]),
  };
}
