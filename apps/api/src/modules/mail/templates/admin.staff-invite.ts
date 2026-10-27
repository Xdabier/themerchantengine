import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeHtml, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  actionUrl: string;
  inviterName?: string;
  role?: string;
  appName?: string;
}

// Staff-to-staff mail: it addresses a colleague, not a customer.
const COPY = {
  fr: {
    subject: (s: string) => `Votre accès à l'administration · ${s}`,
    preheader: "Votre compte d'administration est prêt.",
    heading: "Votre compte d'administration est créé",
    body: (vars: Vars, s: string) => {
      const inviter = vars.inviterName
        ? `<strong>${vars.inviterName}</strong>`
        : "Un membre de l'équipe";
      const role = vars.role ? ` avec le rôle <strong>${vars.role}</strong>` : '';
      return (
        `${inviter} vous a créé un compte d'administration ${s}${role}. ` +
        'Connectez-vous avec le mot de passe qui vous a été transmis, ou réinitialisez-le ' +
        'depuis la page de connexion.'
      );
    },
    cta: 'Se connecter',
  },
  en: {
    subject: (s: string) => `Your admin access · ${s}`,
    preheader: 'Your admin account is ready.',
    heading: 'You have an admin account',
    body: (vars: Vars, s: string) => {
      const inviter = vars.inviterName ? `<strong>${vars.inviterName}</strong>` : 'A team member';
      const role = vars.role ? ` as <strong>${vars.role}</strong>` : '';
      return (
        `${inviter} created a ${s} admin account for you${role}. ` +
        'Sign in below with the password you were given, or reset it from the sign-in page.'
      );
    },
    cta: 'Sign in',
  },
  ar: {
    subject: (s: string) => `صلاحية الوصول إلى لوحة الإدارة · ${s}`,
    preheader: 'حساب الإدارة الخاص بك جاهز.',
    heading: 'تم إنشاء حساب الإدارة الخاص بك',
    body: (vars: Vars, s: string) => {
      const inviter = vars.inviterName
        ? `<strong>${vars.inviterName}</strong>`
        : 'أحد أعضاء الفريق';
      const role = vars.role ? ` بدور <strong>${vars.role}</strong>` : '';
      return (
        `${inviter} أنشأ لك حساب إدارة في ${s}${role}. ` +
        'سجّل الدخول بكلمة المرور التي تلقيتها، أو أعد تعيينها من صفحة تسجيل الدخول.'
      );
    },
    cta: 'تسجيل الدخول',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e, escapeHtml(brand.storeName))}</p>
${ctaButton(e.actionUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, vars.actionUrl]),
  };
}
