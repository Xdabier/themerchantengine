import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  actionUrl: string;
  currentEmail?: string;
  newEmail: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Confirmez votre nouvelle adresse e-mail · ${s}`,
    preheader: 'Le lien est valable 24 heures.',
    heading: 'Confirmez votre nouvelle adresse e-mail',
    line1: (newEmail: string, currentEmail?: string): string =>
      currentEmail
        ? `Vous avez demandé le remplacement de l'adresse e-mail de votre compte, de <strong>${currentEmail}</strong> vers <strong>${newEmail}</strong>.`
        : `Vous avez demandé le remplacement de l'adresse e-mail de votre compte par <strong>${newEmail}</strong>.`,
    line2:
      "Le bouton ci-dessous applique le changement. Le lien est valable 24 heures et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, aucune action n'est nécessaire, votre adresse actuelle reste en place.",
    cta: 'Confirmer la nouvelle adresse',
  },
  en: {
    subject: (s: string) => `Confirm your new email address · ${s}`,
    preheader: 'The link is valid for 24 hours.',
    heading: 'Confirm your new email address',
    line1: (newEmail: string, currentEmail?: string): string =>
      currentEmail
        ? `You asked to replace the email address on your account, from <strong>${currentEmail}</strong> to <strong>${newEmail}</strong>.`
        : `You asked to replace the email address on your account with <strong>${newEmail}</strong>.`,
    line2:
      'The button below applies the change. The link is valid for 24 hours and works once. If you did not make this request, no action is needed, your current address stays in place.',
    cta: 'Confirm new address',
  },
  ar: {
    subject: (s: string) => `تأكيد عنوان بريدك الإلكتروني الجديد · ${s}`,
    preheader: 'الرابط صالح لمدة 24 ساعة.',
    heading: 'تأكيد عنوان بريدك الإلكتروني الجديد',
    line1: (newEmail: string, currentEmail?: string): string =>
      currentEmail
        ? `طلبت تغيير عنوان البريد الإلكتروني لحسابك من <strong>${currentEmail}</strong> إلى <strong>${newEmail}</strong>.`
        : `طلبت تغيير عنوان البريد الإلكتروني لحسابك إلى <strong>${newEmail}</strong>.`,
    line2:
      'الزر أدناه يطبق التغيير. الرابط صالح لمدة 24 ساعة ويعمل مرة واحدة فقط. إذا لم تطلب ذلك، فلا حاجة لأي إجراء، ويبقى عنوانك الحالي كما هو.',
    cta: 'تأكيد العنوان الجديد',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 12px;">${t.line1(e.newEmail, e.currentEmail)}</p>
<p style="margin:0 0 16px;">${t.line2}</p>
${ctaButton(e.actionUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, vars.newEmail, vars.actionUrl]),
  };
}
