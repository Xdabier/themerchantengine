import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, escapeVars, renderLayout, renderText } from './layout';

// Security alert sent to the CURRENT address: no CTA, no link, so a stolen
// mailbox cannot be walked into the change from this notice.
export interface Vars {
  newEmail: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Demande de changement d'adresse e-mail · ${s}`,
    preheader: 'Notification de sécurité.',
    heading: "Demande de changement d'adresse e-mail",
    body: (vars: Vars) =>
      `Une demande a été enregistrée pour remplacer l'adresse e-mail de votre compte ` +
      `par <strong>${vars.newEmail}</strong>. Un lien de confirmation a été envoyé à cette ` +
      `nouvelle adresse, et le changement ne prend effet qu'une fois ce lien utilisé. Si vous ` +
      `n'êtes pas à l'origine de cette demande, prévenez notre service client. Votre adresse ` +
      `actuelle reste active jusque-là.`,
  },
  en: {
    subject: (s: string) => `Email change requested · ${s}`,
    preheader: 'Security notice.',
    heading: 'Email change requested',
    body: (vars: Vars) =>
      `A request was recorded to replace the email address on your account with ` +
      `<strong>${vars.newEmail}</strong>. A confirmation link was sent to that new address, and ` +
      `the change only takes effect once that link is used. If you did not make this request, ` +
      `tell our customer service. Your current address stays active until then.`,
  },
  ar: {
    subject: (s: string) => `طلب تغيير عنوان البريد الإلكتروني · ${s}`,
    preheader: 'إشعار أمني.',
    heading: 'طلب تغيير عنوان البريد الإلكتروني',
    body: (vars: Vars) =>
      `تم تسجيل طلب لتغيير عنوان البريد الإلكتروني لحسابك إلى ` +
      `<strong>${vars.newEmail}</strong>. أرسلنا رابط تأكيد إلى هذا العنوان الجديد، ولا يسري ` +
      `التغيير إلا بعد استخدام هذا الرابط. إذا لم تطلب ذلك، أبلغ خدمة العملاء. يبقى عنوانك ` +
      `الحالي نشطاً حتى ذلك الحين.`,
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, vars.newEmail]),
  };
}
