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
  itemCount: number;
  orderUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Commande ${n} reçue · ${s}`,
    preheader: 'Nous avons reçu votre commande.',
    heading: 'Commande reçue',
    body: (vars: Vars) =>
      `${vars.customerName ? `${vars.customerName}, nous` : 'Nous'} avons bien reçu votre ` +
      `commande ${monoId(vars.orderNumber)}&nbsp;: ${vars.itemCount} ` +
      `article${vars.itemCount === 1 ? '' : 's'}, total <strong>${vars.total}</strong> ${TAX_INCLUDED.fr}. ` +
      `Vous recevrez un message dès l'expédition.`,
    cta: 'Voir la commande',
  },
  en: {
    subject: (n: string, s: string) => `Order ${n} received · ${s}`,
    preheader: 'We received your order.',
    heading: 'Order received',
    body: (vars: Vars) =>
      `${vars.customerName ? `${vars.customerName}, we` : 'We'} received your order ` +
      `${monoId(vars.orderNumber)}: ${vars.itemCount} ` +
      `item${vars.itemCount === 1 ? '' : 's'}, total <strong>${vars.total}</strong> ${TAX_INCLUDED.en}. ` +
      `We will write again when it ships.`,
    cta: 'View order',
  },
  ar: {
    subject: (n: string, s: string) => `تم استلام الطلب ${n} · ${s}`,
    preheader: 'استلمنا طلبك.',
    heading: 'تم استلام الطلب',
    body: (vars: Vars) =>
      `${vars.customerName ? `${vars.customerName}، ` : ''}استلمنا طلبك ` +
      `${monoId(vars.orderNumber)}: ${vars.itemCount} ` +
      `${vars.itemCount === 1 ? 'منتج' : 'منتجات'}، الإجمالي <strong>${vars.total}</strong> ${TAX_INCLUDED.ar}. ` +
      `سنراسلك عند الشحن.`,
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
      `${vars.total} ${copyEntry(TAX_INCLUDED, locale)}`,
      vars.orderUrl,
    ]),
  };
}
