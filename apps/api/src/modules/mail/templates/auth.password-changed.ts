import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, renderLayout, renderText } from './layout';

// Security alert: no variables, no CTA link (avoids a phishable action button
// on a "your password changed" notice). Sent to the owner's current address.
export type Vars = Record<string, never>;

const COPY = {
  fr: {
    subject: (s: string) => `Votre mot de passe a été modifié · ${s}`,
    preheader: 'Notification de sécurité.',
    heading: 'Votre mot de passe a été modifié',
    body:
      "Le mot de passe de votre compte vient d'être modifié, et toutes les sessions " +
      "ont été déconnectées. Si vous êtes à l'origine de ce changement, aucune action " +
      "n'est nécessaire. Sinon, réinitialisez le mot de passe depuis la page de connexion, " +
      'puis prévenez notre service client.',
  },
  en: {
    subject: (s: string) => `Your password was changed · ${s}`,
    preheader: 'Security notice.',
    heading: 'Your password was changed',
    body:
      'The password on your account was just changed, and all sessions were signed ' +
      'out. If this was you, no action is needed. If it was not, reset the password from the ' +
      'sign-in page, then tell our customer service.',
  },
  ar: {
    subject: (s: string) => `تم تغيير كلمة المرور · ${s}`,
    preheader: 'إشعار أمني.',
    heading: 'تم تغيير كلمة المرور',
    body:
      'تم تغيير كلمة مرور حسابك للتو، وتم تسجيل الخروج من جميع الجلسات. إذا كنت أنت من ' +
      'قام بهذا التغيير، فلا حاجة لأي إجراء. وإلا، أعد تعيين كلمة المرور من صفحة تسجيل ' +
      'الدخول، ثم أبلغ خدمة العملاء.',
  },
} as const;

export function render(locale: MailLocale, _vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body}</p>`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, t.body]),
  };
}
