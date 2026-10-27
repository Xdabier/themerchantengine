import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeHtml, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  securityUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Double authentification désactivée · ${s}`,
    preheader: 'Un réglage de sécurité a changé sur votre compte.',
    heading: 'La double authentification est désactivée',
    body: (s: string) =>
      `La double authentification vient d'être désactivée sur votre compte ${s}. ` +
      "Votre mot de passe protège désormais seul l'accès au compte. Si vous n'êtes pas à " +
      "l'origine de ce changement, réactivez-la depuis la sécurité du compte et changez votre " +
      'mot de passe.',
    cta: 'Ouvrir la sécurité du compte',
  },
  en: {
    subject: (s: string) => `Two-factor authentication disabled · ${s}`,
    preheader: 'A security setting changed on your account.',
    heading: 'Two-factor authentication is off',
    body: (s: string) =>
      `Two-factor authentication was just disabled on your ${s} account. Your ` +
      'password alone now protects access to it. If you did not make this change, turn it back ' +
      'on from your account security and change your password.',
    cta: 'Review account security',
  },
  ar: {
    subject: (s: string) => `تم تعطيل المصادقة الثنائية · ${s}`,
    preheader: 'تغير إعداد أمني في حسابك.',
    heading: 'المصادقة الثنائية معطلة',
    body: (s: string) =>
      `تم تعطيل المصادقة الثنائية للتو على حسابك في ${s}. أصبحت كلمة المرور وحدها ` +
      'تحمي الوصول إلى الحساب الآن. إذا لم تقم بهذا التغيير، فأعد تفعيلها من إعدادات أمان ' +
      'الحساب وغيّر كلمة المرور.',
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
