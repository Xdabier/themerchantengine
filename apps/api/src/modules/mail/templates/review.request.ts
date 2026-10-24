import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, monoId, renderLayout, renderText } from './layout';

export interface Vars {
  orderNumber: string;
  reviewUrl: string;
}

const COPY = {
  fr: {
    subject: (v: Vars, s: string) => `Votre avis sur la commande ${v.orderNumber} · ${s}`,
    preheader: 'Votre avis sur les produits que vous avez reçus.',
    heading: 'Votre avis',
    body: (v: Vars) =>
      `La commande ${monoId(v.orderNumber)} vous a été livrée. Si vous avez ` +
      `déjà utilisé les produits, votre avis servira aux autres clients qui évaluent les mêmes ` +
      `références. Il n'y a ni contrepartie ni délai, et ce message ne sera pas relancé.`,
    cta: 'Rédiger un avis',
  },
  en: {
    subject: (v: Vars, s: string) => `Your review of order ${v.orderNumber} · ${s}`,
    preheader: 'Your review of the products you received.',
    heading: 'Your review',
    body: (v: Vars) =>
      `Order ${monoId(v.orderNumber)} has been delivered. If you have already ` +
      `put the products to use, your review will serve other customers weighing up the same ` +
      `references. There is no reward and no deadline, and this message will not be sent again.`,
    cta: 'Write a review',
  },
  ar: {
    subject: (v: Vars, s: string) => `تقييمك للطلب ${v.orderNumber} · ${s}`,
    preheader: 'تقييمك للمنتجات التي استلمتها.',
    heading: 'تقييمك',
    body: (v: Vars) =>
      `تم تسليم الطلب ${monoId(v.orderNumber)}. إذا كنت قد استخدمت المنتجات، ` +
      `فسيفيد تقييمك العملاء الآخرين الذين يقيّمون المنتجات نفسها. لا مقابل ولا مهلة، ` +
      `ولن تُرسل هذه الرسالة مرة أخرى.`,
    cta: 'كتابة تقييم',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${ctaButton(e.reviewUrl, t.cta, locale)}`;
  return {
    subject: t.subject(vars, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, vars.orderNumber, vars.reviewUrl]),
  };
}
