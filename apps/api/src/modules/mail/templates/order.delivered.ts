import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { copyFor, ctaButton, escapeVars, monoId, renderLayout, renderText } from './layout';

export interface Vars {
  orderNumber: string;
  orderUrl: string;
  reviewUrl?: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Commande ${n} livrée · ${s}`,
    preheader: 'Votre commande est marquée comme livrée.',
    heading: 'Commande livrée',
    body: (vars: Vars) => {
      const parts = [
        `La commande ${monoId(vars.orderNumber)} est marquée comme livrée. ` +
          `Si un article manque ou ne correspond pas, signalez-le depuis votre compte.`,
      ];
      if (vars.reviewUrl) parts.push(`Vous pouvez laisser un avis sur les articles reçus.`);
      return parts.join(' ');
    },
    cta: (vars: Vars) => (vars.reviewUrl ? 'Laisser un avis' : 'Voir la commande'),
  },
  en: {
    subject: (n: string, s: string) => `Order ${n} delivered · ${s}`,
    preheader: 'Your order is marked as delivered.',
    heading: 'Order delivered',
    body: (vars: Vars) => {
      const parts = [
        `Order ${monoId(vars.orderNumber)} is marked as delivered. ` +
          `If an item is missing or does not match, report it from your account.`,
      ];
      if (vars.reviewUrl) parts.push(`You can leave a review on the items you received.`);
      return parts.join(' ');
    },
    cta: (vars: Vars) => (vars.reviewUrl ? 'Write a review' : 'View order'),
  },
  ar: {
    subject: (n: string, s: string) => `تم تسليم الطلب ${n} · ${s}`,
    preheader: 'تم تسجيل طلبك كمُسلَّم.',
    heading: 'تم تسليم الطلب',
    body: (vars: Vars) => {
      const parts = [
        `تم تسجيل الطلب ${monoId(vars.orderNumber)} كمُسلَّم. ` +
          `إذا كان هناك منتج ناقص أو غير مطابق، أبلغ عنه من حسابك.`,
      ];
      if (vars.reviewUrl) parts.push(`يمكنك كتابة تقييم للمنتجات التي استلمتها.`);
      return parts.join(' ');
    },
    cta: (vars: Vars) => (vars.reviewUrl ? 'كتابة تقييم' : 'عرض الطلب'),
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const ctaHref = vars.reviewUrl ?? vars.orderUrl;
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${ctaButton(e.reviewUrl ?? e.orderUrl, t.cta(e), locale)}`;
  return {
    subject: t.subject(vars.orderNumber, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([t.heading, vars.orderNumber, ctaHref]),
  };
}
