import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyFor,
  BRAND_TOKENS,
  ctaButton,
  escapeHtml,
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
    subject: (s: string) => `Confirmez votre adresse e-mail · ${s}`,
    preheader: 'Le lien est valable 24 heures.',
    heading: 'Confirmez votre adresse e-mail',
    body: (s: string) =>
      `Votre compte ${s} est créé. Il reste à confirmer cette adresse pour ` +
      "l'activer, et le bouton ci-dessous le fait en une étape. Le lien est valable 24 heures. " +
      "Si vous n'êtes pas à l'origine de cette inscription, aucune action n'est nécessaire.",
    cta: 'Confirmer mon adresse',
    fallback: "Si le bouton ne s'ouvre pas, copiez ce lien dans votre navigateur&nbsp;:",
  },
  en: {
    subject: (s: string) => `Confirm your email address · ${s}`,
    preheader: 'The link is valid for 24 hours.',
    heading: 'Confirm your email address',
    body: (s: string) =>
      `Your ${s} account is created. Confirming this address activates it, and the ` +
      'button below does that in one step. The link is valid for 24 hours. If you did not sign ' +
      'up, no action is needed.',
    cta: 'Confirm my address',
    fallback: 'If the button does not open, copy this link into your browser:',
  },
  ar: {
    subject: (s: string) => `تأكيد عنوان بريدك الإلكتروني · ${s}`,
    preheader: 'الرابط صالح لمدة 24 ساعة.',
    heading: 'تأكيد عنوان بريدك الإلكتروني',
    body: (s: string) =>
      `تم إنشاء حسابك في ${s}. يبقى تأكيد هذا العنوان لتفعيله، والزر أدناه يقوم بذلك ` +
      'في خطوة واحدة. الرابط صالح لمدة 24 ساعة. إذا لم تقم بهذا التسجيل، فلا حاجة لأي إجراء.',
    cta: 'تأكيد عنواني',
    fallback: 'إذا لم يفتح الزر، انسخ هذا الرابط إلى المتصفح:',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(escapeHtml(brand.storeName))}</p>
${ctaButton(e.actionUrl, t.cta, locale)}
<p style="margin:24px 0 0;color:${BRAND_TOKENS.muted};font-size:13px;">${t.fallback}<br>
<a href="${e.actionUrl}" style="color:${BRAND_TOKENS.primary};word-break:break-all;">${e.actionUrl}</a></p>`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      t.body(brand.storeName),
      '',
      t.cta + highPunctuationSpace(locale) + ':',
      vars.actionUrl,
    ]),
  };
}
