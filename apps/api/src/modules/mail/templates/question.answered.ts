import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  productName: string;
  productUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Réponse à votre question · ${s}`,
    preheader: 'Votre question a reçu une réponse.',
    heading: 'Réponse à votre question',
    body: (vars: Vars) =>
      `Votre question sur <strong>${vars.productName}</strong> a reçu une réponse. ` +
      `Elle est publiée sur la fiche produit.`,
    cta: 'Lire la réponse',
  },
  en: {
    subject: (s: string) => `Your question has an answer · ${s}`,
    preheader: 'Your question has an answer.',
    heading: 'Your question has an answer',
    body: (vars: Vars) =>
      `Your question about <strong>${vars.productName}</strong> has an answer. ` +
      `It is published on the product page.`,
    cta: 'Read the answer',
  },
  ar: {
    subject: (s: string) => `رد على سؤالك · ${s}`,
    preheader: 'تلقى سؤالك رداً.',
    heading: 'رد على سؤالك',
    body: (vars: Vars) =>
      `تلقى سؤالك عن <strong>${vars.productName}</strong> رداً. ` + `وهو منشور في صفحة المنتج.`,
    cta: 'قراءة الرد',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${ctaButton(e.productUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, vars.productName, vars.productUrl]),
  };
}
