import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  productName: string;
  productUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Votre avis est publié · ${s}`,
    preheader: 'Votre avis est en ligne sur la fiche produit.',
    heading: 'Avis publié',
    body: (vars: Vars) =>
      `Votre avis sur <strong>${vars.productName}</strong> est en ligne sur la fiche ` +
      `produit. Merci du temps que vous y avez consacré&nbsp;: il servira aux autres clients qui ` +
      `évaluent le même produit.`,
    cta: 'Voir la fiche produit',
  },
  en: {
    subject: (s: string) => `Your review is published · ${s}`,
    preheader: 'Your review is live on the product page.',
    heading: 'Review published',
    body: (vars: Vars) =>
      `Your review of <strong>${vars.productName}</strong> is live on the product page. ` +
      `Thank you for the time you gave it. It will serve other customers weighing up the same ` +
      `product.`,
    cta: 'View product page',
  },
  ar: {
    subject: (s: string) => `تم نشر تقييمك · ${s}`,
    preheader: 'تقييمك منشور في صفحة المنتج.',
    heading: 'تم نشر التقييم',
    body: (vars: Vars) =>
      `تقييمك لـ <strong>${vars.productName}</strong> منشور الآن في صفحة المنتج. ` +
      `شكراً على الوقت الذي خصصته له: سيفيد العملاء الآخرين الذين يقيّمون المنتج نفسه.`,
    cta: 'عرض صفحة المنتج',
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
