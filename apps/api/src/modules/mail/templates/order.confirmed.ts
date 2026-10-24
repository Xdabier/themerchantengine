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
  customerName?: string;
  /** Already formatted for display by the dispatch resolver. */
  total: string;
  orderUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Commande ${n} confirmée · ${s}`,
    preheader: 'Votre commande est confirmée, la facture est disponible.',
    heading: 'Commande confirmée',
    body: (vars: Vars) =>
      `Votre commande ${monoId(vars.orderNumber)} est confirmée. La facture est ` +
      `disponible dans votre compte, pour un total de <strong>${vars.total}</strong> ${TAX_INCLUDED.fr}. ` +
      `Vous recevrez un message dès l'expédition.`,
    cta: 'Voir la commande et la facture',
  },
  en: {
    subject: (n: string, s: string) => `Order ${n} confirmed · ${s}`,
    preheader: 'Your order is confirmed and the invoice is available.',
    heading: 'Order confirmed',
    body: (vars: Vars) =>
      `Your order ${monoId(vars.orderNumber)} is confirmed. The invoice is available ` +
      `in your account, for a total of <strong>${vars.total}</strong> ${TAX_INCLUDED.en}. ` +
      `We will write again when it ships.`,
    cta: 'View order and invoice',
  },
  ar: {
    subject: (n: string, s: string) => `تم تأكيد الطلب ${n} · ${s}`,
    preheader: 'تم تأكيد طلبك، والفاتورة متاحة.',
    heading: 'تم تأكيد الطلب',
    body: (vars: Vars) =>
      `تم تأكيد طلبك ${monoId(vars.orderNumber)}. الفاتورة متاحة في حسابك، ` +
      `بإجمالي <strong>${vars.total}</strong> ${TAX_INCLUDED.ar}. سنراسلك عند الشحن.`,
    cta: 'عرض الطلب والفاتورة',
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
      `${vars.total} ${copyEntry(TAX_INCLUDED, locale)}`,
      vars.orderUrl,
    ]),
  };
}
