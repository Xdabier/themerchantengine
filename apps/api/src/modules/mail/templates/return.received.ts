import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, monoId, renderLayout, renderText } from './layout';

export interface Vars {
  returnNumber: string;
  returnUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Retour ${n} reçu · ${s}`,
    preheader: 'Vos articles sont arrivés chez nous et passent au contrôle.',
    heading: 'Retour reçu',
    body: (vars: Vars) =>
      `Les articles du retour ${monoId(vars.returnNumber)} sont arrivés dans ` +
      `notre entrepôt et passent au contrôle. Le remboursement est lancé dès le contrôle terminé, ` +
      `et vous en recevez la confirmation par e-mail, montant compris.`,
    cta: 'Voir le retour',
  },
  en: {
    subject: (n: string, s: string) => `Return ${n} received · ${s}`,
    preheader: 'Your items have reached us and are being inspected.',
    heading: 'Return received',
    body: (vars: Vars) =>
      `The items from return ${monoId(vars.returnNumber)} have reached our ` +
      `warehouse and are being inspected. The refund starts as soon as the inspection is done, ` +
      `and you get the confirmation by email, amount included.`,
    cta: 'View return',
  },
  ar: {
    subject: (n: string, s: string) => `تم استلام الإرجاع ${n} · ${s}`,
    preheader: 'وصلت منتجاتك إلينا وهي قيد الفحص.',
    heading: 'تم استلام الإرجاع',
    body: (vars: Vars) =>
      `وصلت منتجات الإرجاع ${monoId(vars.returnNumber)} إلى مستودعنا وهي قيد الفحص. ` +
      `يبدأ الاسترداد فور انتهاء الفحص، وستصلك رسالة تأكيد بالبريد الإلكتروني تتضمن المبلغ.`,
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
    text: renderText([t.heading, vars.returnNumber, vars.returnUrl]),
  };
}
