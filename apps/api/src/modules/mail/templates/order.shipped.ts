import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, monoId, renderLayout, renderText } from './layout';

export interface Vars {
  orderNumber: string;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  orderUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Commande ${n} expédiée · ${s}`,
    preheader: 'Votre commande est partie, avec son numéro de suivi.',
    heading: 'Commande expédiée',
    body: (vars: Vars) => {
      const parts = [`La commande ${monoId(vars.orderNumber)} est expédiée.`];
      if (vars.carrier) parts.push(`Transporteur&nbsp;: ${vars.carrier}.`);
      if (vars.trackingNumber) parts.push(`Numéro de suivi&nbsp;: ${monoId(vars.trackingNumber)}.`);
      return parts.join(' ');
    },
    cta: 'Suivre le colis',
    fallback: 'Voir la commande',
  },
  en: {
    subject: (n: string, s: string) => `Order ${n} shipped · ${s}`,
    preheader: 'Your order has left, with its tracking number.',
    heading: 'Order shipped',
    body: (vars: Vars) => {
      const parts = [`Order ${monoId(vars.orderNumber)} has shipped.`];
      if (vars.carrier) parts.push(`Carrier: ${vars.carrier}.`);
      if (vars.trackingNumber) parts.push(`Tracking number: ${monoId(vars.trackingNumber)}.`);
      return parts.join(' ');
    },
    cta: 'Track the parcel',
    fallback: 'View order',
  },
  ar: {
    subject: (n: string, s: string) => `تم شحن الطلب ${n} · ${s}`,
    preheader: 'طلبك في الطريق، مع رقم التتبع.',
    heading: 'تم شحن الطلب',
    body: (vars: Vars) => {
      const parts = [`تم شحن الطلب ${monoId(vars.orderNumber)}.`];
      if (vars.carrier) parts.push(`شركة الشحن: ${vars.carrier}.`);
      if (vars.trackingNumber) parts.push(`رقم التتبع: ${monoId(vars.trackingNumber)}.`);
      return parts.join(' ');
    },
    cta: 'تتبع الشحنة',
    fallback: 'عرض الطلب',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const cta = e.trackingUrl
    ? ctaButton(e.trackingUrl, t.cta, locale)
    : ctaButton(e.orderUrl, t.fallback, locale);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${cta}`;
  return {
    subject: t.subject(vars.orderNumber, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      vars.orderNumber,
      vars.carrier ?? '',
      vars.trackingNumber ?? '',
      vars.trackingUrl ?? vars.orderUrl,
    ]),
  };
}
