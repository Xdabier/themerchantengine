import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  actionUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Confirmez la suppression de votre compte · ${s}`,
    preheader: 'Le lien est valable 24 heures.',
    heading: 'Confirmez la suppression de votre compte',
    body:
      'Vous avez demandé la suppression de votre compte. Le bouton ci-dessous confirme ' +
      "l'opération, qui est définitive et ne peut pas être annulée. Le lien est valable " +
      "24 heures et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette " +
      "demande, aucune action n'est nécessaire, votre compte reste actif.",
    cta: 'Supprimer mon compte',
  },
  en: {
    subject: (s: string) => `Confirm account deletion · ${s}`,
    preheader: 'The link is valid for 24 hours.',
    heading: 'Confirm account deletion',
    body:
      'You asked to delete your account. The button below confirms it, and deletion is ' +
      'permanent and cannot be undone. The link is valid for 24 hours and works once. If you ' +
      'did not make this request, no action is needed, your account stays active.',
    cta: 'Delete my account',
  },
  ar: {
    subject: (s: string) => `تأكيد حذف حسابك · ${s}`,
    preheader: 'الرابط صالح لمدة 24 ساعة.',
    heading: 'تأكيد حذف حسابك',
    body:
      'طلبت حذف حسابك. الزر أدناه يؤكد العملية، وهي نهائية ولا يمكن التراجع عنها. الرابط ' +
      'صالح لمدة 24 ساعة ويعمل مرة واحدة فقط. إذا لم تطلب ذلك، فلا حاجة لأي إجراء، ويبقى ' +
      'حسابك نشطاً.',
    cta: 'حذف حسابي',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body}</p>
${ctaButton(e.actionUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, t.body, vars.actionUrl]),
  };
}
