import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import {
  copyEntry,
  copyFor,
  ctaButton,
  escapeVars,
  renderLayout,
  renderText,
  highPunctuationSpace,
  TAX_INCLUDED,
} from './layout';

export interface Vars {
  /**
   * A ready phrase from the producer (`la semaine écoulée` in French). The
   * sentence is composed around it, never re-translated here.
   */
  periodLabel: string;
  /** Already formatted for display. A paid total, so it carries the tax mention. */
  revenue: string;
  orders: string | number;
  /** Already formatted for display. A paid total, so it carries the tax mention. */
  aov: string;
  newCustomers: string | number;
  adminUrl: string;
}

const COPY = {
  fr: {
    subject: (s: string) => `Performance de la semaine · ${s}`,
    preheader: "Chiffre d'affaires, commandes, panier moyen, nouveaux clients.",
    heading: 'Performance de la semaine',
    intro: (v: Vars) => `Chiffres sur <strong>${v.periodLabel}</strong>.`,
    rows: {
      revenue: "Chiffre d'affaires",
      orders: 'Commandes',
      aov: 'Panier moyen',
      newCustomers: 'Nouveaux clients',
    },
    cta: 'Ouvrir les statistiques',
  },
  en: {
    subject: (s: string) => `Weekly performance digest · ${s}`,
    preheader: 'Revenue, orders, average order value, new customers.',
    heading: 'Weekly performance digest',
    intro: (v: Vars) => `Figures for <strong>${v.periodLabel}</strong>.`,
    rows: {
      revenue: 'Revenue',
      orders: 'Orders',
      aov: 'Average order value',
      newCustomers: 'New customers',
    },
    cta: 'Open analytics',
  },
  ar: {
    subject: (s: string) => `أداء الأسبوع · ${s}`,
    preheader: 'الإيرادات، الطلبات، متوسط قيمة الطلب، العملاء الجدد.',
    heading: 'أداء الأسبوع',
    intro: (v: Vars) => `الأرقام عن <strong>${v.periodLabel}</strong>.`,
    rows: {
      revenue: 'الإيرادات',
      orders: 'الطلبات',
      aov: 'متوسط قيمة الطلب',
      newCustomers: 'عملاء جدد',
    },
    cta: 'فتح الإحصاءات',
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
  const tax = copyEntry(TAX_INCLUDED, locale);
  const revenue = `${vars.revenue} ${tax}`;
  const aov = `${vars.aov} ${tax}`;
  const table = metricsTable([
    [t.rows.revenue, `${e.revenue} ${tax}`],
    [t.rows.orders, e.orders],
    [t.rows.aov, `${e.aov} ${tax}`],
    [t.rows.newCustomers, e.newCustomers],
  ]);
  const body = `<h1 style="font-size:22px;margin:0 0 12px;">${t.heading}</h1>
<p style="margin:0 0 12px;">${t.intro(e)}</p>
${table}
${ctaButton(e.adminUrl, t.cta, locale)}`;
  return {
    subject: t.subject(brand.storeName),
    html: renderLayout({ locale, storeName: brand.storeName, preheader: t.preheader, body }),
    text: renderText([
      t.heading,
      `${t.rows.revenue}${colon} ${revenue}`,
      `${t.rows.orders}${colon} ${vars.orders}`,
      `${t.rows.aov}${colon} ${aov}`,
      `${t.rows.newCustomers}${colon} ${vars.newCustomers}`,
      vars.adminUrl,
    ]),
  };
}
