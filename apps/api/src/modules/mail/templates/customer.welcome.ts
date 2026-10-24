import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, renderLayout, renderText, TAX_EXCLUDED } from './layout';

export interface Vars {
  firstName?: string;
  storefrontUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Votre compte est ouvert · ${s}`,
    preheader: 'Votre compte est vérifié et actif.',
    heading: 'Votre compte est ouvert',
    body: (firstName?: string): string =>
      `${firstName ? `${firstName}, votre` : 'Votre'} compte est vérifié et actif. Vous y ` +
      `trouvez le catalogue complet avec les prix ${TAX_EXCLUDED.fr}, l'historique de vos ` +
      'commandes et vos factures en téléchargement. Les adresses de livraison enregistrées ' +
      'sont reprises à la commande suivante.',
    cta: 'Voir le catalogue',
  },
  en: {
    subject: (s: string) => `Your account is open · ${s}`,
    preheader: 'Your account is verified and active.',
    heading: 'Your account is open',
    body: (firstName?: string): string =>
      `${firstName ? `${firstName}, your` : 'Your'} account is verified and active. It gives ` +
      `you the full catalogue with ${TAX_EXCLUDED.en} prices, your order history, and your ` +
      'invoices to download. Saved delivery addresses carry over to your next order.',
    cta: 'View the catalogue',
  },
  ar: {
    subject: (s: string) => `تم فتح حسابك · ${s}`,
    preheader: 'حسابك مؤكد ونشط.',
    heading: 'تم فتح حسابك',
    body: (firstName?: string): string =>
      `${firstName ? `${firstName}، ` : ''}حسابك مؤكد ونشط. تجد فيه الكتالوج الكامل ` +
      `بالأسعار ${TAX_EXCLUDED.ar}، وسجل طلباتك، وفواتيرك للتنزيل. تُستخدم عناوين ` +
      'التوصيل المحفوظة في الطلب التالي.',
    cta: 'عرض الكتالوج',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e.firstName)}</p>
${ctaButton(e.storefrontUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, t.body(vars.firstName), t.cta, vars.storefrontUrl]),
  };
}
