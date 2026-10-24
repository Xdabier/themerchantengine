import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, monoId, renderLayout, renderText } from './layout';

export interface Vars {
  returnNumber: string;
  orderNumber: string;
  returnUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Retour ${n} accepté · ${s}`,
    preheader: 'Retour accepté. Voici la marche à suivre pour le renvoi.',
    heading: 'Retour accepté',
    body: (vars: Vars) =>
      `Le retour ${monoId(vars.returnNumber)} de la commande ` +
      `${monoId(vars.orderNumber)} est accepté. Renvoyez les articles dans leur emballage ` +
      `d'origine, en suivant les instructions affichées sur la page du retour. À réception, ` +
      `nous contrôlons les articles, puis nous lançons le remboursement.`,
    cta: 'Voir le retour',
  },
  en: {
    subject: (n: string, s: string) => `Return ${n} approved · ${s}`,
    preheader: 'Return approved. Here is how to send the items back.',
    heading: 'Return approved',
    body: (vars: Vars) =>
      `Return ${monoId(vars.returnNumber)} from order ` +
      `${monoId(vars.orderNumber)} is approved. Send the items back in their original ` +
      `packaging, following the instructions shown on the return page. Once they reach us we ` +
      `inspect them, then we start the refund.`,
    cta: 'View return',
  },
  ar: {
    subject: (n: string, s: string) => `تمت الموافقة على الإرجاع ${n} · ${s}`,
    preheader: 'تمت الموافقة على الإرجاع. إليك خطوات إعادة المنتجات.',
    heading: 'تمت الموافقة على الإرجاع',
    body: (vars: Vars) =>
      `تمت الموافقة على الإرجاع ${monoId(vars.returnNumber)} للطلب ` +
      `${monoId(vars.orderNumber)}. أعد المنتجات في عبوتها الأصلية باتباع التعليمات ` +
      `المعروضة في صفحة الإرجاع. عند الاستلام نفحص المنتجات، ثم نبدأ الاسترداد.`,
    cta: 'عرض الإرجاع',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${ctaButton(e.returnUrl, t.cta, locale)}`;
  return {
    subject: t.subject(vars.returnNumber, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, vars.returnNumber, vars.orderNumber, vars.returnUrl]),
  };
}
