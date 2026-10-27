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
}

const COPY = {
  fr: {
    subject: (s: string) => `Votre lien de connexion · ${s}`,
    preheader: 'Le lien est valable 5 minutes.',
    heading: 'Votre lien de connexion',
    body:
      'Le bouton ci-dessous vous connecte à votre compte sans mot de passe. Le lien ' +
      "est valable 5 minutes et ne fonctionne qu'une seule fois. Si vous n'avez pas demandé " +
      "cette connexion, aucune action n'est nécessaire.",
    cta: 'Se connecter',
    fallback: "Si le bouton ne s'ouvre pas, copiez ce lien dans votre navigateur&nbsp;:",
  },
  en: {
    subject: (s: string) => `Your sign-in link · ${s}`,
    preheader: 'The link is valid for 5 minutes.',
    heading: 'Your sign-in link',
    body:
      'The button below signs you in to your account without a password. The link is ' +
      'valid for 5 minutes and works once. If you did not ask to sign in, no action is needed.',
    cta: 'Sign in',
    fallback: 'If the button does not open, copy this link into your browser:',
  },
  ar: {
    subject: (s: string) => `رابط تسجيل الدخول · ${s}`,
    preheader: 'الرابط صالح لمدة 5 دقائق.',
    heading: 'رابط تسجيل الدخول',
    body:
      'الزر أدناه يسجل دخولك إلى حسابك دون كلمة مرور. الرابط صالح لمدة 5 دقائق ويعمل ' +
      'مرة واحدة فقط. إذا لم تطلب تسجيل الدخول، فلا حاجة لأي إجراء.',
    cta: 'تسجيل الدخول',
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
