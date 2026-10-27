import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyEntry,
  copyFor,
  ctaButton,
  escapeVars,
  renderLayout,
  renderText,
  NO_BREAK_SPACE,
  TAX_INCLUDED,
} from './layout';

export interface Vars {
  itemCount: number;
  /** Already formatted for display by the dispatch resolver. */
  subtotal: string;
  cartUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Votre panier est enregistré · ${s}`,
    preheader: 'Le contenu de votre panier est conservé.',
    heading: 'Votre panier est enregistré',
    body: (vars: Vars) =>
      `Votre panier contient <strong>${vars.itemCount}</strong> ` +
      `${vars.itemCount > 1 ? 'articles' : 'article'}, sous-total ` +
      `<strong>${vars.subtotal} ${TAX_INCLUDED.fr}</strong>. Il reste enregistré sur votre compte.`,
    amountLabel: `Sous-total du panier${NO_BREAK_SPACE}:`,
    cta: 'Ouvrir mon panier',
  },
  en: {
    subject: (s: string) => `Your cart is saved · ${s}`,
    preheader: 'Your cart contents are kept.',
    heading: 'Your cart is saved',
    body: (vars: Vars) =>
      `Your cart holds <strong>${vars.itemCount}</strong> ` +
      `${vars.itemCount > 1 ? 'items' : 'item'}, subtotal ` +
      `<strong>${vars.subtotal} ${TAX_INCLUDED.en}</strong>. It stays saved on your account.`,
    amountLabel: 'Cart subtotal:',
    cta: 'Open my cart',
  },
  ar: {
    subject: (s: string) => `سلتك محفوظة · ${s}`,
    preheader: 'محتويات سلتك محفوظة.',
    heading: 'سلتك محفوظة',
    body: (vars: Vars) =>
      `تحتوي سلتك على <strong>${vars.itemCount}</strong> ` +
      `${vars.itemCount > 1 ? 'منتجات' : 'منتج'}، المجموع الفرعي ` +
      `<strong>${vars.subtotal} ${TAX_INCLUDED.ar}</strong>. تبقى محفوظة في حسابك.`,
    amountLabel: 'المجموع الفرعي للسلة:',
    cta: 'فتح سلتي',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${ctaButton(e.cartUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      `${t.amountLabel} ${vars.subtotal} ${copyEntry(TAX_INCLUDED, locale)}`,
      vars.cartUrl,
    ]),
  };
}
