import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeHtml, escapeVars, renderLayout, renderText } from './layout';

export interface Vars {
  confirmUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Confirmez votre abonnement · ${s}`,
    preheader: 'Un clic pour confirmer votre abonnement.',
    heading: 'Confirmez votre abonnement',
    body: (s: string) =>
      "Ce clic confirme votre adresse et vous abonne à la lettre d'information " +
      `${s}. Elle annonce les nouvelles références du catalogue, les réapprovisionnements ` +
      "et les délais de livraison. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    cta: "Confirmer l'abonnement",
  },
  en: {
    subject: (s: string) => `Confirm your subscription · ${s}`,
    preheader: 'One click to confirm your subscription.',
    heading: 'Confirm your subscription',
    body: (s: string) =>
      `This click confirms your address and subscribes you to the ${s} ` +
      'newsletter. It announces new catalogue references, restocks and delivery lead times. ' +
      'If you did not ask for this, ignore this message.',
    cta: 'Confirm subscription',
  },
  ar: {
    subject: (s: string) => `تأكيد اشتراكك · ${s}`,
    preheader: 'نقرة واحدة لتأكيد اشتراكك.',
    heading: 'تأكيد اشتراكك',
    body: (s: string) =>
      `هذه النقرة تؤكد عنوانك وتشتركك في النشرة البريدية من ${s}. تعلن النشرة عن ` +
      'المنتجات الجديدة في الكتالوج، وإعادة التوفر، ومواعيد التوصيل. إذا لم تطلب ذلك، ' +
      'تجاهل هذه الرسالة.',
    cta: 'تأكيد الاشتراك',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(escapeHtml(brand.storeName))}</p>
${ctaButton(e.confirmUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, t.body(brand.storeName), vars.confirmUrl]),
  };
}
