import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyEntry,
  copyFor,
  ctaButton,
  escapeVars,
  monoId,
  renderLayout,
  renderText,
  TAX_INCLUDED,
} from './layout';

export interface Vars {
  orderNumber: string;
  returnNumber?: string;
  /** Already formatted for display by the dispatch resolver. */
  total: string;
  orderUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Commande d'échange ${n} créée · ${s}`,
    preheader: "Une commande d'échange a été créée pour votre retour.",
    heading: "Commande d'échange créée",
    body: (vars: Vars) =>
      `La commande d'échange ${monoId(vars.orderNumber)} a été créée pour votre ` +
      `retour${vars.returnNumber ? ` ${monoId(vars.returnNumber)}` : ''}, ` +
      `pour un total de <strong>${vars.total}</strong> ${TAX_INCLUDED.fr}. Elle est en préparation, ` +
      `vous recevrez un message dès l'expédition.`,
    cta: "Voir la commande d'échange",
  },
  en: {
    subject: (n: string, s: string) => `Exchange order ${n} created · ${s}`,
    preheader: 'An exchange order was created for your return.',
    heading: 'Exchange order created',
    body: (vars: Vars) =>
      `Exchange order ${monoId(vars.orderNumber)} was created for your ` +
      `return${vars.returnNumber ? ` ${monoId(vars.returnNumber)}` : ''}, ` +
      `for a total of <strong>${vars.total}</strong> ${TAX_INCLUDED.en}. It is being prepared, ` +
      `and we will write again when it ships.`,
    cta: 'View exchange order',
  },
  ar: {
    subject: (n: string, s: string) => `تم إنشاء طلب الاستبدال ${n} · ${s}`,
    preheader: 'تم إنشاء طلب استبدال لإرجاعك.',
    heading: 'تم إنشاء طلب الاستبدال',
    body: (vars: Vars) =>
      `تم إنشاء طلب الاستبدال ${monoId(vars.orderNumber)} ` +
      `لإرجاعك${vars.returnNumber ? ` ${monoId(vars.returnNumber)}` : ''}، ` +
      `بإجمالي <strong>${vars.total}</strong> ${TAX_INCLUDED.ar}. يجري تجهيزه، ` +
      `وسنراسلك عند الشحن.`,
    cta: 'عرض طلب الاستبدال',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${ctaButton(e.orderUrl, t.cta, locale)}`;
  return {
    subject: t.subject(vars.orderNumber, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      vars.orderNumber,
      vars.returnNumber ?? '',
      `${vars.total} ${copyEntry(TAX_INCLUDED, locale)}`,
      vars.orderUrl,
    ]),
  };
}
