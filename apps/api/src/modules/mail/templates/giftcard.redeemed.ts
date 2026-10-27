import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyEntry,
  copyFor,
  BRAND_TOKENS,
  codeBlock,
  ctaButton,
  escapeVars,
  monoId,
  renderLayout,
  renderText,
  NO_BREAK_SPACE,
  TAX_INCLUDED,
} from './layout';

export interface Vars {
  code: string;
  /** Already formatted for display by the dispatch resolver. */
  amountRedeemed: string;
  /** Already formatted for display by the dispatch resolver. */
  remainingBalance: string;
  orderNumber?: string;
  orderUrl?: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Carte cadeau utilisée · ${s}`,
    preheader: 'Montant utilisé et solde restant.',
    heading: 'Carte cadeau utilisée',
    body: (vars: Vars) => {
      const orderLine = vars.orderNumber ? ` sur la commande ${monoId(vars.orderNumber)}` : '';
      return (
        `<strong>${vars.amountRedeemed} ${TAX_INCLUDED.fr}</strong> ont été utilisés depuis votre ` +
        `carte cadeau${orderLine}. Solde restant&nbsp;: <strong>${vars.remainingBalance} ${TAX_INCLUDED.fr}</strong>.`
      );
    },
    codeLabel: 'Code de la carte cadeau&nbsp;:',
    amountLabel: `Montant utilisé${NO_BREAK_SPACE}:`,
    balanceLabel: `Solde restant${NO_BREAK_SPACE}:`,
    cta: 'Voir la commande',
  },
  en: {
    subject: (s: string) => `Gift card used · ${s}`,
    preheader: 'Amount used and remaining balance.',
    heading: 'Gift card used',
    body: (vars: Vars) => {
      const orderLine = vars.orderNumber ? ` on order ${monoId(vars.orderNumber)}` : '';
      return (
        `<strong>${vars.amountRedeemed} ${TAX_INCLUDED.en}</strong> was used from your gift card${orderLine}. ` +
        `Remaining balance: <strong>${vars.remainingBalance} ${TAX_INCLUDED.en}</strong>.`
      );
    },
    codeLabel: 'Gift-card code:',
    amountLabel: 'Amount used:',
    balanceLabel: 'Remaining balance:',
    cta: 'View the order',
  },
  ar: {
    subject: (s: string) => `تم استخدام بطاقة الهدية · ${s}`,
    preheader: 'المبلغ المستخدم والرصيد المتبقي.',
    heading: 'تم استخدام بطاقة الهدية',
    body: (vars: Vars) => {
      const orderLine = vars.orderNumber ? ` في الطلب ${monoId(vars.orderNumber)}` : '';
      return (
        `تم استخدام <strong>${vars.amountRedeemed} ${TAX_INCLUDED.ar}</strong> من بطاقة ` +
        `الهدية الخاصة بك${orderLine}. الرصيد المتبقي: <strong>${vars.remainingBalance} ${TAX_INCLUDED.ar}</strong>.`
      );
    },
    codeLabel: 'رمز بطاقة الهدية:',
    amountLabel: 'المبلغ المستخدم:',
    balanceLabel: 'الرصيد المتبقي:',
    cta: 'عرض الطلب',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const cta = e.orderUrl ? ctaButton(e.orderUrl, t.cta, locale) : '';
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 12px;">${t.body(e)}</p>
<p style="margin:16px 0 4px;color:${BRAND_TOKENS.muted};font-size:13px;">${t.codeLabel}</p>
${codeBlock(e.code)}
${cta}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      `${t.amountLabel} ${vars.amountRedeemed} ${copyEntry(TAX_INCLUDED, locale)}`,
      // Both money lines carry the display string the HTML part shows.
      `${t.balanceLabel} ${vars.remainingBalance} ${copyEntry(TAX_INCLUDED, locale)}`,
      vars.code,
    ]),
  };
}
