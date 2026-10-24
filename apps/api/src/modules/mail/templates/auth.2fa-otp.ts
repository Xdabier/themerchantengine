import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, codeBlock, escapeHtml, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  otp: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Code de vérification · ${s}`,
    preheader: 'Votre code de connexion à usage unique.',
    heading: 'Votre code de vérification',
    body: (s: string) =>
      'Utilisez le code ci-dessous pour terminer votre connexion. Il ne fonctionne ' +
      "qu'une seule fois et expire au bout de quelques minutes. Ne le communiquez à personne. " +
      `Personne chez ${s} ne vous le demandera.`,
  },
  en: {
    subject: (s: string) => `Your verification code · ${s}`,
    preheader: 'Your one-time sign-in code.',
    heading: 'Your verification code',
    body: (s: string) =>
      'Use the code below to finish signing in. It works once only and expires after a ' +
      `few minutes. Do not share it with anyone. Nobody at ${s} will ever ask you for it.`,
  },
  ar: {
    subject: (s: string) => `رمز التحقق · ${s}`,
    preheader: 'رمز تسجيل الدخول لمرة واحدة.',
    heading: 'رمز التحقق الخاص بك',
    body: (s: string) =>
      'استخدم الرمز أدناه لإكمال تسجيل الدخول. يعمل مرة واحدة فقط وتنتهي صلاحيته بعد ' +
      `بضع دقائق. لا تشاركه مع أحد. لن يطلبه منك أي شخص في ${s}.`,
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(escapeHtml(brand.storeName))}</p>
${codeBlock(e.otp)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, t.body(brand.storeName), vars.otp]),
  };
}
