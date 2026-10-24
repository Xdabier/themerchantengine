import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyEntry,
  copyFor,
  ctaButton,
  escapeVars,
  monoId,
  renderLayout,
  renderText,
  TAX_INCLUDED,
} from './layout';

export interface Vars {
  orderNumber: string;
  reason?: string;
  /** Already formatted for display by the dispatch resolver. */
  refundAmount?: string;
  orderUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Commande ${n} annulée · ${s}`,
    preheader: 'Votre commande est annulée.',
    heading: 'Commande annulée',
    body: (vars: Vars) => {
      const parts = [
        `La commande ${monoId(vars.orderNumber)} est annulée. Nous en sommes désolés.`,
      ];
      if (vars.reason) parts.push(`Motif&nbsp;: ${vars.reason}.`);
      parts.push(
        vars.refundAmount
          ? `Le remboursement de <strong>${vars.refundAmount}</strong> ${TAX_INCLUDED.fr} est en cours, il vous ` +
              `parvient sous 5 à 10 jours ouvrés.`
          : `Si un paiement a été enregistré, il vous est remboursé sous 5 à 10 jours ouvrés.`,
      );
      return parts.join(' ');
    },
    cta: 'Voir la commande',
  },
  en: {
    subject: (n: string, s: string) => `Order ${n} cancelled · ${s}`,
    preheader: 'Your order was cancelled.',
    heading: 'Order cancelled',
    body: (vars: Vars) => {
      const parts = [
        `Order ${monoId(vars.orderNumber)} has been cancelled. We are sorry about that.`,
      ];
      if (vars.reason) parts.push(`Reason: ${vars.reason}.`);
      parts.push(
        vars.refundAmount
          ? `A refund of <strong>${vars.refundAmount}</strong> ${TAX_INCLUDED.en} is being processed and reaches ` +
              `you within 5 to 10 business days.`
          : `If a payment was recorded, it is refunded within 5 to 10 business days.`,
      );
      return parts.join(' ');
    },
    cta: 'View order',
  },
  ar: {
    subject: (n: string, s: string) => `تم إلغاء الطلب ${n} · ${s}`,
    preheader: 'تم إلغاء طلبك.',
    heading: 'تم إلغاء الطلب',
    body: (vars: Vars) => {
      const parts = [`تم إلغاء الطلب ${monoId(vars.orderNumber)}. نأسف لذلك.`];
      if (vars.reason) parts.push(`السبب: ${vars.reason}.`);
      parts.push(
        vars.refundAmount
          ? `جارٍ استرداد مبلغ <strong>${vars.refundAmount}</strong> ${TAX_INCLUDED.ar}، ويصلك ` +
              `خلال 5 إلى 10 أيام عمل.`
          : `إذا تم تسجيل دفعة، فسيُرد إليك المبلغ خلال 5 إلى 10 أيام عمل.`,
      );
      return parts.join(' ');
    },
    cta: 'عرض الطلب',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${ctaButton(e.orderUrl, t.cta, locale)}`;
  return {
    subject: t.subject(vars.orderNumber, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      vars.orderNumber,
      vars.refundAmount ? `${vars.refundAmount} ${copyEntry(TAX_INCLUDED, locale)}` : '',
      vars.orderUrl,
    ]),
  };
}
