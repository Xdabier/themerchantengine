import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyFor,
  BRAND_TOKENS,
  ctaButton,
  escapeVars,
  renderLayout,
  renderText,
  highPunctuationSpace,
} from './layout';

export interface Vars {
  actionUrl: string;
  appName?: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Réinitialisation de votre mot de passe · ${s}`,
    preheader: 'Le lien est valable 1 heure.',
    heading: 'Réinitialisation de votre mot de passe',
    body:
      'Vous avez demandé un nouveau mot de passe. Le bouton ci-dessous ouvre la page ' +
      "de réinitialisation. Le lien est valable 1 heure et ne fonctionne qu'une seule fois. " +
      "Si vous n'êtes pas à l'origine de cette demande, aucune action n'est nécessaire, votre " +
      'mot de passe actuel reste valable.',
    cta: 'Réinitialiser le mot de passe',
    fallback: "Si le bouton ne s'ouvre pas, copiez ce lien dans votre navigateur&nbsp;:",
  },
  en: {
    subject: (s: string) => `Reset your password · ${s}`,
    preheader: 'The link is valid for 1 hour.',
    heading: 'Reset your password',
    body:
      'You asked for a new password. The button below opens the reset page. The link ' +
      'is valid for 1 hour and works once. If you did not make this request, no action is ' +
      'needed, your current password stays valid.',
    cta: 'Reset password',
    fallback: 'If the button does not open, copy this link into your browser:',
  },
  ar: {
    subject: (s: string) => `إعادة تعيين كلمة المرور · ${s}`,
    preheader: 'الرابط صالح لمدة ساعة واحدة.',
    heading: 'إعادة تعيين كلمة المرور',
    body:
      'طلبت كلمة مرور جديدة. الزر أدناه يفتح صفحة إعادة التعيين. الرابط صالح لمدة ساعة ' +
      'واحدة ويعمل مرة واحدة فقط. إذا لم تطلب ذلك، فلا حاجة لأي إجراء، وتبقى كلمة المرور ' +
      'الحالية صالحة.',
    cta: 'إعادة تعيين كلمة المرور',
    fallback: 'إذا لم يفتح الزر، انسخ هذا الرابط إلى المتصفح:',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body}</p>
${ctaButton(e.actionUrl, t.cta, locale)}
<p style="margin:24px 0 0;color:${BRAND_TOKENS.muted};font-size:13px;">${t.fallback}<br>
<a href="${e.actionUrl}" style="color:${BRAND_TOKENS.primary};word-break:break-all;">${e.actionUrl}</a></p>`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      t.body,
      '',
      t.cta + highPunctuationSpace(locale) + ':',
      vars.actionUrl,
    ]),
  };
}
