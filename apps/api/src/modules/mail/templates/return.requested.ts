import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, monoId, renderLayout, renderText } from './layout';

export interface Vars {
  returnNumber: string;
  orderNumber: string;
  customerName?: string;
  returnUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Demande de retour ${n} enregistrée · ${s}`,
    preheader: 'Votre demande de retour est enregistrée et passe en examen.',
    heading: 'Demande de retour enregistrée',
    body: (vars: Vars) =>
      `${vars.customerName ? `${vars.customerName}, nous` : 'Nous'} avons enregistré votre demande de retour ` +
      `${monoId(vars.returnNumber)} pour la commande ${monoId(vars.orderNumber)}. ` +
      `Elle passe en examen. Vous recevrez par e-mail notre décision et, si le retour est accepté, ` +
      `la marche à suivre pour le renvoi.`,
    cta: 'Voir le retour',
  },
  en: {
    subject: (n: string, s: string) => `Return request ${n} logged · ${s}`,
    preheader: 'Your return request is logged and under review.',
    heading: 'Return request logged',
    body: (vars: Vars) =>
      `${vars.customerName ? `${vars.customerName}, we` : 'We'} have logged your return request ` +
      `${monoId(vars.returnNumber)} for order ${monoId(vars.orderNumber)}. ` +
      `It is now under review. We will email you the decision and, if the return is accepted, ` +
      `the instructions for sending the items back.`,
    cta: 'View return',
  },
  ar: {
    subject: (n: string, s: string) => `تم تسجيل طلب الإرجاع ${n} · ${s}`,
    preheader: 'تم تسجيل طلب الإرجاع وهو قيد المراجعة.',
    heading: 'تم تسجيل طلب الإرجاع',
    body: (vars: Vars) =>
      `${vars.customerName ? `${vars.customerName}، ` : ''}سجلنا طلب الإرجاع ` +
      `${monoId(vars.returnNumber)} للطلب ${monoId(vars.orderNumber)}. ` +
      `وهو الآن قيد المراجعة. سنراسلك بقرارنا، وإذا قُبل الإرجاع، بخطوات إعادة المنتجات.`,
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
