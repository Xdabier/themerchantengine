import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyFor,
  ctaButton,
  escapeHtml,
  escapeVars,
  renderLayout,
  renderText,
  NO_BREAK_SPACE,
} from './layout';

export interface Vars {
  productName: string;
  productUrl: string;
}

const COPY = {
  fr: {
    subject: (v: Vars, s: string) =>
      `De nouveau disponible${NO_BREAK_SPACE}: ${v.productName} · ${s}`,
    preheader: 'Une référence que vous suivez est de nouveau disponible.',
    heading: 'De nouveau disponible',
    body: (v: Vars, s: string) =>
      `<strong>${v.productName}</strong> est de nouveau disponible chez ${s}. ` +
      `Vous aviez demandé une alerte de réapprovisionnement sur cette référence.`,
    cta: 'Voir la fiche produit',
  },
  en: {
    subject: (v: Vars, s: string) => `Back in stock: ${v.productName} · ${s}`,
    preheader: 'A reference you follow is available again.',
    heading: 'Back in stock',
    body: (v: Vars, s: string) =>
      `<strong>${v.productName}</strong> is available again at ${s}. ` +
      `You asked for a restock alert on this reference.`,
    cta: 'View product page',
  },
  ar: {
    subject: (v: Vars, s: string) => `متوفر من جديد: ${v.productName} · ${s}`,
    preheader: 'منتج تتابعه أصبح متوفراً من جديد.',
    heading: 'متوفر من جديد',
    body: (v: Vars, s: string) =>
      `<strong>${v.productName}</strong> متوفر من جديد في ${s}. ` +
      `كنت قد طلبت تنبيهاً عند إعادة توفر هذا المنتج.`,
    cta: 'عرض صفحة المنتج',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e, escapeHtml(brand.storeName))}</p>
${ctaButton(e.productUrl, t.cta, locale)}`;
  return {
    subject: t.subject(vars, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, t.body(vars, brand.storeName), vars.productUrl]),
  };
}
