import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyFor,
  ctaButton,
  escapeVars,
  renderLayout,
  renderText,
  highPunctuationSpace,
} from './layout';

export interface Vars {
  lowStockCount: string | number;
  outOfStockCount: string | number;
  newReturnsCount: string | number;
  pendingReviewsCount: string | number;
  adminUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Récapitulatif des opérations du jour · ${s}`,
    preheader: 'Stock bas, ruptures, retours et avis à modérer.',
    heading: 'Récapitulatif des opérations du jour',
    intro: "Ce qui demande une action dans la boutique aujourd'hui.",
    rows: {
      lowStock: 'Stock bas',
      outOfStock: 'Rupture de stock',
      newReturns: 'Nouveaux retours (24 h)',
      pendingReviews: 'Avis en attente de modération',
    },
    cta: 'Ouvrir le tableau de bord',
  },
  en: {
    subject: (s: string) => `Daily operations digest · ${s}`,
    preheader: 'Low stock, out of stock, returns and reviews to moderate.',
    heading: 'Daily operations digest',
    intro: 'What needs action in the store today.',
    rows: {
      lowStock: 'Low stock',
      outOfStock: 'Out of stock',
      newReturns: 'New returns (24h)',
      pendingReviews: 'Reviews awaiting moderation',
    },
    cta: 'Open dashboard',
  },
  ar: {
    subject: (s: string) => `ملخص العمليات اليومي · ${s}`,
    preheader: 'مخزون منخفض، نفاد المخزون، إرجاعات وتقييمات بانتظار المراجعة.',
    heading: 'ملخص العمليات اليومي',
    intro: 'ما يحتاج إلى إجراء في المتجر اليوم.',
    rows: {
      lowStock: 'مخزون منخفض',
      outOfStock: 'نفاد المخزون',
      newReturns: 'إرجاعات جديدة (24 ساعة)',
      pendingReviews: 'تقييمات بانتظار المراجعة',
    },
    cta: 'فتح لوحة التحكم',
  },
} as const;

function metricsTable(rows: Array<[label: string, value: string | number]>): string {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;">${label}</td>` +
        `<td style="padding:6px 0;text-align:end;"><strong>${value}</strong></td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;margin:8px 0 4px;">${cells}</table>`;
}

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
  // French puts a no-break space before a colon; the other locales put none.
  // The plain-text arm is read as typed, so it carries the codepoint.
  const colon = `${highPunctuationSpace(locale)}:`;
  const t = copyFor(COPY, locale);
  const e = escapeVars(vars);
  const table = metricsTable([
    [t.rows.lowStock, e.lowStockCount],
    [t.rows.outOfStock, e.outOfStockCount],
    [t.rows.newReturns, e.newReturnsCount],
    [t.rows.pendingReviews, e.pendingReviewsCount],
  ]);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 12px;">${t.intro}</p>
${table}
${ctaButton(e.adminUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      `${t.rows.lowStock}${colon} ${vars.lowStockCount}`,
      `${t.rows.outOfStock}${colon} ${vars.outOfStockCount}`,
      `${t.rows.newReturns}${colon} ${vars.newReturnsCount}`,
      `${t.rows.pendingReviews}${colon} ${vars.pendingReviewsCount}`,
      vars.adminUrl,
    ]),
  };
}
