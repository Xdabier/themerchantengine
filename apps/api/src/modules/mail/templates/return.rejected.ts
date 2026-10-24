import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, monoId, renderLayout, renderText } from './layout';

export interface Vars {
  returnNumber: string;
  orderNumber: string;
  reason?: string;
  returnUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Retour ${n} refusé · ${s}`,
    preheader: 'Le motif du refus et la marche à suivre.',
    heading: 'Retour refusé',
    body: (vars: Vars) =>
      `Nous ne pouvons pas accepter le retour ${monoId(vars.returnNumber)} ` +
      `de la commande ${monoId(vars.orderNumber)}` +
      `${vars.reason ? `&nbsp;: ${vars.reason}` : '.'}` +
      ` Nous en sommes désolés. Les articles restent en votre possession. Pour toute question ` +
      `sur cette décision, contactez notre service client.`,
    cta: 'Voir le retour',
  },
  en: {
    subject: (n: string, s: string) => `Return ${n} not approved · ${s}`,
    preheader: 'The reason for the decision and what to do next.',
    heading: 'Return not approved',
    body: (vars: Vars) =>
      `We cannot accept return ${monoId(vars.returnNumber)} from order ` +
      `${monoId(vars.orderNumber)}` +
      `${vars.reason ? `: ${vars.reason}` : '.'}` +
      ` We are sorry about that. The items stay with you. For any question about this decision, ` +
      `contact our customer service team.`,
    cta: 'View return',
  },
  ar: {
    subject: (n: string, s: string) => `لم تتم الموافقة على الإرجاع ${n} · ${s}`,
    preheader: 'سبب القرار والخطوة التالية.',
    heading: 'لم تتم الموافقة على الإرجاع',
    body: (vars: Vars) =>
      `لا يمكننا قبول الإرجاع ${monoId(vars.returnNumber)} للطلب ` +
      `${monoId(vars.orderNumber)}` +
      `${vars.reason ? `: ${vars.reason}` : '.'}` +
      ` نأسف لذلك. تبقى المنتجات لديك. لأي سؤال حول هذا القرار، تواصل مع خدمة العملاء.`,
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
