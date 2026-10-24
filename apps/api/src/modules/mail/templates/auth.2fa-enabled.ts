import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeHtml, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  securityUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Double authentification activée · ${s}`,
    preheader: 'Un réglage de sécurité a changé sur votre compte.',
    heading: 'La double authentification est active',
    body: (s: string) =>
      `La double authentification vient d'être activée sur votre compte ${s}. ` +
      'À la prochaine connexion, un code de vérification vous sera demandé en plus de votre ' +
      "mot de passe. Si vous êtes à l'origine de ce changement, vous n'avez rien à faire. " +
      'Sinon, ouvrez la sécurité du compte et changez votre mot de passe.',
    cta: 'Ouvrir la sécurité du compte',
  },
  en: {
    subject: (s: string) => `Two-factor authentication enabled · ${s}`,
    preheader: 'A security setting changed on your account.',
    heading: 'Two-factor authentication is on',
    body: (s: string) =>
      `Two-factor authentication was just enabled on your ${s} account. At your ` +
      'next sign-in you will be asked for a verification code as well as your password. If you ' +
      'made this change, nothing further is needed. If you did not, open your account security ' +
      'and change your password.',
    cta: 'Review account security',
  },
  ar: {
    subject: (s: string) => `تم تفعيل المصادقة الثنائية · ${s}`,
    preheader: 'تغير إعداد أمني في حسابك.',
    heading: 'المصادقة الثنائية مفعلة',
    body: (s: string) =>
      `تم تفعيل المصادقة الثنائية للتو على حسابك في ${s}. عند تسجيل الدخول القادم ` +
      'سيُطلب منك رمز تحقق إضافة إلى كلمة المرور. إذا كنت أنت من قام بهذا التغيير، فلا ' +
      'حاجة لأي إجراء. وإلا، افتح إعدادات أمان الحساب وغيّر كلمة المرور.',
    cta: 'فتح أمان الحساب',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(escapeHtml(brand.storeName))}</p>
${ctaButton(e.securityUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, t.body(brand.storeName), vars.securityUrl]),
  };
}
