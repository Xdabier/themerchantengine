import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyEntry,
  copyFor,
  ctaButton,
  escapeVars,
  monoId,
  renderLayout,
  renderText,
  TAX_EXCLUDED,
} from './layout';

export interface Vars {
  returnNumber: string;
  /**
   * Already formatted for display by the dispatch resolver. A catalogue-price
   * figure: `returns.service.ts` computes the refund as the sum of the line
   * unit prices, which are stored before tax, so the copy must not call it a
   * paid total.
   */
  refundAmount: string;
  /** Localized, refund-method-specific sentence built by the dispatch resolver. */
  refundDetail: string;
  returnUrl: string;
}

const COPY = {
  fr: {
    subject: (n: string, s: string) => `Remboursement du retour ${n} · ${s}`,
    preheader: 'Le montant remboursé et son mode de versement.',
    heading: 'Remboursement du retour',
    body: (vars: Vars) =>
      `Le montant remboursé pour le retour ${monoId(vars.returnNumber)} est de ` +
      `<strong>${vars.refundAmount} ${TAX_EXCLUDED.fr}</strong>. ${vars.refundDetail}`,
    cta: 'Voir le retour',
  },
  en: {
    subject: (n: string, s: string) => `Refund for return ${n} · ${s}`,
    preheader: 'The amount refunded and how it is being paid back.',
    heading: 'Refund for your return',
    body: (vars: Vars) =>
      `The amount refunded for return ${monoId(vars.returnNumber)} is ` +
      `<strong>${vars.refundAmount} ${TAX_EXCLUDED.en}</strong>. ${vars.refundDetail}`,
    cta: 'View return',
  },
  ar: {
    subject: (n: string, s: string) => `استرداد الإرجاع ${n} · ${s}`,
    preheader: 'المبلغ المسترد وطريقة رده.',
    heading: 'استرداد الإرجاع',
    body: (vars: Vars) =>
      `المبلغ المسترد للإرجاع ${monoId(vars.returnNumber)} هو ` +
      `<strong>${vars.refundAmount} ${TAX_EXCLUDED.ar}</strong>. ${vars.refundDetail}`,
    cta: 'عرض الإرجاع',
  },
} as const;

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 16px;">${t.body(e)}</p>
${ctaButton(e.returnUrl, t.cta, locale)}`;
  return {
    subject: t.subject(vars.returnNumber, brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      vars.returnNumber,
      `${vars.refundAmount} ${copyEntry(TAX_EXCLUDED, locale)}`,
      vars.refundDetail,
      vars.returnUrl,
    ]),
  };
}
