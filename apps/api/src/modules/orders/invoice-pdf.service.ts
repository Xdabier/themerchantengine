import { ConfigService } from '@nestjs/config';
import {
  RegistryLocale,
  fontKitCoversLocale,
  getLocaleDefinition,
  registryLocaleCodes,
  storeLocales,
} from '@common/locale';
import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { SettingsService } from '../settings/settings.service';
import { applyRate, roundMoney } from '@common/money';
import { MoneyFormatterService } from '../currencies/money-formatter.service';

/**
 * Server-side invoice PDF renderer, branded from the runtime config (DR-31).
 *
 * Engine: pdfkit (pure-JS, no chromium). fontkit joins and reorders a
 * single-direction run, so text is handed over in logical order with no bidi
 * pass. Every cell holds one direction and numbers are western digits. A
 * right-to-left locale (Arabic) mirrors the whole page: the layout is computed
 * in left-to-right coordinates, then each rectangle goes through `mirrorX` and
 * each alignment through `textEdge`, so the logo and title swap sides, the
 * columns reverse and the totals block moves to the left.
 *
 * Brand floor §4.5 for this document: lockup **b**, left aligned, no signature,
 * a 2 pt Ardoise rule beneath it, and **no flat colour fill anywhere on the
 * page**. That last rule is why the items table is ruled rather than banded and
 * why the total is emphasised by weight and a rule instead of a filled box.
 *
 * Typography per §3: Inter for prose, Baloo 2 for the document title, JetBrains
 * Mono strictly for identifiers (invoice number, order number, SKU). Prices
 * stay in the prose face with `tnum` so a column of amounts aligns, per §3.2,
 * and never enter the mono face. Arabic uses Tajawal for prose, title and
 * headings, since Baloo 2 and Inter carry no Arabic glyphs. The faces are
 * committed as TrueType under `apps/api/assets/fonts/` because pdfkit cannot
 * read the woff2 the storefront ships; `scripts/build-pdf-fonts.py` regenerates
 * the Latin ones. The Tajawal files are vendored whole (OFL 1.1).
 *
 * The renderer is data-in / Buffer-out: it reads ONLY the immutable Invoice
 * snapshot + parent-order ref + Settings business block, never live product or
 * price data, preserving "immutable once issued" (§9.6).
 */

export interface InvoicePdfItem {
  productName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  total: number;
}

export interface InvoicePdfBillingAddress {
  fullName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface InvoicePdfSnapshot {
  invoiceNumber: string;
  items: InvoicePdfItem[];
  subtotal: number;
  discountAmount: number;
  shippingAmount: number;
  taxAmount: number;
  total: number;
  shippingMethodName: string | null;
  billingAddress: InvoicePdfBillingAddress | null;
  issuedAt: Date;
}

export interface InvoicePdfOrderRef {
  orderNumber: string;
  /** ISO-4217 code persisted on the order. */
  currency: string;
}

/**
 * The languages the invoice can typeset: the registry locales whose script the
 * bundled fonts carry (Inter for Latin, Tajawal for Arabic). A store locale
 * outside this set maps through `invoiceLocaleOf`.
 */
export function invoiceLocales(): readonly RegistryLocale[] {
  return registryLocaleCodes().filter((code) => fontKitCoversLocale('arabic-latin', code));
}
export type InvoiceLocale = RegistryLocale;

/** The locale the PDF renders in for a store locale: itself when typeset, else the store default when typeset, else the first typeset one. */
export function invoiceLocaleOf(locale: string): InvoiceLocale {
  const all = invoiceLocales();
  const typeset: readonly string[] = all;
  if (typeset.includes(locale)) return locale as InvoiceLocale;
  const storeDefault = storeLocales.current().defaultLocale;
  return (typeset.includes(storeDefault) ? storeDefault : all[0]) as InvoiceLocale;
}

/**
 * The table for a locale, or the store default's, or English's. The label and
 * month tables are keyed on the registry type, so a new language adds its own
 * entry there; this fallback covers a table read at runtime before that.
 */
function tableFor<T>(tables: Partial<Record<string, T>>, locale: string): T {
  const found =
    tables[locale] ?? tables[storeLocales.current().defaultLocale] ?? tables.en ?? tables.fr;
  if (!found) throw new Error(`No invoice table for locale ${locale}`);
  return found;
}

interface RenderInput {
  invoice: InvoicePdfSnapshot;
  order: InvoicePdfOrderRef;
  locale: InvoiceLocale;
}

type ItemColumnKey = 'desc' | 'qty' | 'unit' | 'amount';

interface ItemColumn {
  key: ItemColumnKey;
  w: number;
  align: 'left' | 'right';
  x: number;
}

interface TotalsRow {
  label: string;
  value: string;
}

interface TotalsBlock {
  rows: TotalsRow[];
  total: TotalsRow;
}

// ── Brand floor §2 (mirrored from apps/storefront/src/styles/brand.css) ───────
const BRAND = {
  primary: '#5043BF', // Ardoise, rules only on this document
  text: '#0A1A26', // Encre
  textMuted: '#55606A', // Gris interface
  border: '#E4E6EB', // Filet
} as const;

const ASSETS_DIR = path.resolve(process.cwd(), 'apps/api/assets');
const FONT_REGULAR = path.join(ASSETS_DIR, 'fonts', 'Inter-Regular.ttf');
const FONT_BOLD = path.join(ASSETS_DIR, 'fonts', 'Inter-SemiBold.ttf');
const FONT_DISPLAY = path.join(ASSETS_DIR, 'fonts', 'Baloo2-SemiBold.ttf');
const FONT_MONO = path.join(ASSETS_DIR, 'fonts', 'JetBrainsMono-Regular.ttf');
const FONT_ARABIC = path.join(ASSETS_DIR, 'fonts', 'Tajawal-Regular.ttf');
const FONT_ARABIC_BOLD = path.join(ASSETS_DIR, 'fonts', 'Tajawal-Bold.ttf');
/**
 * An optional raster logo for the invoice header. Set `INVOICE_LOGO_PATH` to a
 * PNG on the box (the stepper writes it from the uploaded logo, plan E4);
 * without one the header carries the store name in the display face. No
 * artwork is baked in: the engine ships brandless.
 */
const LOGO_PATH_ENV = 'INVOICE_LOGO_PATH';

const PAGE_MARGIN = 40;
const A4_WIDTH = 595.28;
const CONTENT_W = A4_WIDTH - 2 * PAGE_MARGIN;

/** The footer rule, drawn at this y on every page of the document. */
const FOOTER_RULE_Y = 760;
/** Lowest y a table row or the totals block may reach before the page turns. */
const CONTENT_BOTTOM = FOOTER_RULE_Y - 24;
/** Party-block line advance when the line fits its column without wrapping. */
const PARTY_LINE_H = 13;
/** Items-table header height, and the floor height of one item row. */
const ITEM_ROW_H = 20;
/** Body size of a totals row, and of the height measured for one. */
const TOTALS_ROW_SIZE = 9.5;
/** Rule gap, rule, and the emphasised total row beneath the last totals row. */
const TOTALS_FOOT_H = 34;

/** Tabular figures, so a column of amounts aligns (brand floor §3.2). */
const TABULAR = { features: ['tnum' as const] };

/** No-break space, so a rate never breaks away from its percent sign. */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);

export const LABELS: Record<InvoiceLocale, Record<string, string>> = {
  fr: {
    invoiceTitle: 'FACTURE',
    invoiceNo: 'Facture n°',
    orderNo: 'Commande n°',
    date: 'Date',
    billTo: 'Facturé à',
    from: 'Émetteur',
    description: 'Désignation',
    qty: 'Qté',
    unitPrice: 'P.U. HT',
    amount: 'Montant HT',
    subtotal: 'Sous-total HT',
    discount: 'Remise HT',
    shipping: 'Livraison',
    taxIncluded: 'TTC',
    tax: 'TVA',
    total: 'Total TTC',
    taxRegistration: 'Matricule fiscal',
    thanks: 'Merci de votre confiance.',
  },
  en: {
    invoiceTitle: 'INVOICE',
    invoiceNo: 'Invoice no.',
    orderNo: 'Order no.',
    date: 'Date',
    billTo: 'Bill to',
    from: 'From',
    description: 'Description',
    qty: 'Qty',
    unitPrice: 'Unit price excl. VAT',
    amount: 'Amount excl. VAT',
    subtotal: 'Subtotal excl. VAT',
    discount: 'Discount excl. VAT',
    shipping: 'Shipping',
    taxIncluded: 'incl. VAT',
    tax: 'VAT',
    total: 'Total incl. VAT',
    taxRegistration: 'Tax reg. no.',
    thanks: 'Thank you for your business.',
  },
  ar: {
    invoiceTitle: 'فاتورة',
    invoiceNo: 'رقم الفاتورة',
    orderNo: 'رقم الطلب',
    date: 'التاريخ',
    billTo: 'فاتورة إلى',
    from: 'من',
    description: 'الوصف',
    qty: 'الكمية',
    unitPrice: 'سعر الوحدة',
    amount: 'المبلغ قبل الضريبة',
    subtotal: 'المجموع الفرعي قبل الضريبة',
    discount: 'الخصم قبل الضريبة',
    shipping: 'الشحن',
    taxIncluded: 'شامل الضريبة',
    tax: 'الضريبة',
    total: 'الإجمالي شامل الضريبة',
    taxRegistration: 'الرقم الضريبي',
    thanks: 'شكرا لثقتكم بنا.',
  },
};

/**
 * A country name in the invoice locale, from `Intl.DisplayNames` rather than
 * a table that would have to list every country a store might sell in. The
 * code is returned unchanged when the runtime cannot name it.
 */
function countryName(code: string, locale: InvoiceLocale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const MONTHS: Record<InvoiceLocale, readonly string[]> = {
  fr: [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ar: [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ],
};

/** Seller block lines, composed from Settings. Exported for the unit spec. */
export function composeSellerLines(
  business: Record<string, unknown>,
  general: Record<string, unknown>,
  locale: InvoiceLocale,
): string[] {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const taxReg = str(business.taxRegistrationNumber);
  const countryCode = str(business.addressCountry);
  const country = countryName(countryCode, locale);
  const tel = str(business.telephone) || str(general.phone);

  // Lines render in order; blanks are dropped so an unseeded store degrades to
  // `tradingName` + country (the always-present minimum).
  return [
    pickTranslatable(business.tradingName, locale),
    pickTranslatable(business.legalName, locale),
    taxReg ? `${tableFor(LABELS, locale).taxRegistration} ${taxReg}` : '',
    pickTranslatable(business.streetAddress, locale),
    [str(business.addressLocality), country].filter(Boolean).join(', '),
    tel,
    str(general.contactEmail),
  ]
    .filter((l): l is string => Boolean(l && l.trim()))
    .map((l) => printable(l, locale));
}

/** Resolve a Translatable ({default,fr,en}) or plain string to the locale. */
export function pickTranslatable(value: unknown, locale: InvoiceLocale): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const m = value as Record<string, unknown>;
    const storeDefault = storeLocales.current().defaultLocale;
    const pick =
      m[locale] ??
      m.default ??
      m[storeDefault] ??
      registryLocaleCodes()
        .map((code) => m[code])
        .find((v) => typeof v === 'string');
    return typeof pick === 'string' ? pick : '';
  }
  return '';
}

/**
 * The seller's own zone, `localization.timezone` in the runtime config. An
 * invoice issued late in the evening UTC belongs to the next calendar day in
 * a zone east of it, and the issue date is a field tax law requires to be
 * correct, so the date is read in the store's zone rather than the host's.
 */
function invoiceTimeZone(): string {
  return storeLocales.current().timezone;
}

/**
 * Issue date, written the way each locale writes one, read in the store zone.
 *
 * The zone is pinned rather than taken from the host: an invoice issued
 * just after midnight store time falls on the previous day in UTC, and the
 * issue date is a field tax law requires to be correct. Pinning is also
 * what keeps this deterministic wherever the process runs, so no test needs to
 * set `TZ`.
 */
export function formatInvoiceDate(date: Date, locale: InvoiceLocale): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: invoiceTimeZone(),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return `${part('day')} ${tableFor(MONTHS, locale)[part('month') - 1]} ${part('year')}`;
}

/**
 * The VAT rate this document implies, as a percentage, or `null` when it does
 * not derive cleanly. Exported for the unit spec.
 *
 * An invoice must show the rate beside the VAT amount, and the invoice
 * snapshot is amounts only: it has no rate column, and adding one would change
 * a table whose whole point is being frozen at issue. So the rate is recovered
 * from the numbers already on the page. The taxable base is the goods total
 * after discount, because shipping carries no VAT (plan §2.7).
 *
 * The candidate is snapped to a tenth of a point and then re-applied to the
 * base: it prints only when it reproduces the very amount printed beside it. An
 * odd rate or a zero base therefore prints the label alone. On a tax document a
 * missing rate is a gap; a wrong one is a false statement, and the gap is the
 * smaller failure.
 *
 * The guard is arithmetic, not a proof of a single rate. A blend that happens
 * to land on a clean tenth is indistinguishable from a real rate here and will
 * print: 100 at 19 percent plus 100 at 7 percent reproduces 13 percent exactly.
 * Not reachable today, because `orders.service.ts` passes a null tax class and
 * every order carries one rate, but `TaxService.calculateTax` already takes a
 * tax class, so per-line rates are a schema change away. When they arrive this
 * must take a single-rate signal from the producer rather than infer one.
 */
export function deriveVatRate(
  invoice: Pick<InvoicePdfSnapshot, 'subtotal' | 'discountAmount' | 'taxAmount'>,
): number | null {
  const base = roundMoney(invoice.subtotal - invoice.discountAmount);
  const amount = roundMoney(invoice.taxAmount);
  if (!Number.isFinite(base) || !Number.isFinite(amount)) return null;
  if (base <= 0 || amount < 0) return null;

  const candidate = Math.round((amount / base) * 1000) / 10;
  if (candidate > 100) return null;
  // One millime of slack, which is the engine's own rounding step, not room for
  // a rate that misses.
  return Math.abs(applyRate(base, candidate / 100) - amount) <= 0.001 ? candidate : null;
}

/**
 * `19 %` where the locale puts a space before high punctuation (French),
 * `19%` elsewhere. Digits stay western and the decimal mark is the locale's.
 */
export function formatVatRate(rate: number, locale: InvoiceLocale): string {
  const definition = getLocaleDefinition(locale);
  const decimal =
    new Intl.NumberFormat(`${definition?.intlTag ?? locale}-u-nu-latn`)
      .formatToParts(1.5)
      .find((p) => p.type === 'decimal')?.value ?? '.';
  const rendered = rate.toFixed(Number.isInteger(rate) ? 0 : 1).replace('.', decimal);
  return definition?.typography.spaceBeforeHighPunctuation
    ? `${rendered}${NO_BREAK_SPACE}%`
    : `${rendered}%`;
}

/** The font file behind each face name, for a locale's script. */
export function invoiceFontFiles(locale: InvoiceLocale): {
  body: string;
  bold: string;
  display: string;
  mono: string;
} {
  if (getLocaleDefinition(locale)?.script === 'arabic') {
    return {
      body: FONT_ARABIC,
      bold: FONT_ARABIC_BOLD,
      display: FONT_ARABIC_BOLD,
      mono: FONT_MONO,
    };
  }
  return { body: FONT_REGULAR, bold: FONT_BOLD, display: FONT_DISPLAY, mono: FONT_MONO };
}

/** The four faces, under the names the layout draws with. */
export function registerInvoiceFonts(doc: PDFKit.PDFDocument, locale: InvoiceLocale): void {
  const files = invoiceFontFiles(locale);
  doc.registerFont('body', files.body);
  doc.registerFont('bold', files.bold);
  doc.registerFont('display', files.display);
  doc.registerFont('mono', files.mono);
}

export function isRtlLocale(locale: InvoiceLocale): boolean {
  return getLocaleDefinition(locale)?.direction === 'rtl';
}

/** The x of a box once the page is mirrored; unchanged for left-to-right. */
export function mirrorX(x: number, width: number, rtl: boolean): number {
  return rtl ? A4_WIDTH - x - width : x;
}

/** The physical text alignment for a logical edge. */
export function textEdge(edge: 'start' | 'end', rtl: boolean): 'left' | 'right' {
  return (edge === 'start') !== rtl ? 'left' : 'right';
}

/**
 * A truthy `features` list makes pdfkit hand fontkit the whole line as one run.
 * Without it pdfkit lays out each word alone and joins them left to right, which
 * reverses the word order of an Arabic sentence.
 */
const RTL_RUN = { features: ['kern' as const] };

/** Text options that keep a right-to-left line in one run; empty otherwise. */
export function runOptions(rtl: boolean): { features?: 'kern'[] } {
  return rtl ? { features: [...RTL_RUN.features] } : {};
}

const ARABIC_LETTER = /[\u0600-\u06ff]/;
const ARABIC_LETTER_MARK = '\u061c';
const LATIN_CHUNK = /[A-Za-z0-9]+(?:[ \u00a0\u202f.,:/\-+%@_]+[A-Za-z0-9]+)*%?/g;

/**
 * fontkit reverses a run that holds an Arabic letter whole, digits and Latin
 * included, and has no bidi pass. Each Latin or digit chunk is reversed here
 * first, so that reversal puts it back in reading order.
 *
 * fontkit also picks one script per string from its first strong character, so
 * a line that starts with Latin or digits would lay out left to right. The
 * Arabic letter mark (dropped from the output) makes it start as Arabic.
 */
export function shapeMixedRuns(text: string): string {
  if (!ARABIC_LETTER.test(text)) return text;
  return ARABIC_LETTER_MARK + text.replace(LATIN_CHUNK, (chunk) => [...chunk].reverse().join(''));
}

/**
 * Arabic gets a no-break space for the narrow one Tajawal lacks, and its Latin
 * and digit chunks are pre-shaped. Apply once, to the final string.
 */
export function printable(text: string, locale: InvoiceLocale): string {
  return getLocaleDefinition(locale)?.script === 'arabic'
    ? shapeMixedRuns(text.replace(/\u202f/g, '\u00a0'))
    : text;
}

/**
 * The totals block, as label/value pairs, so its height can be measured before
 * the page it lands on is chosen.
 *
 * Exported rather than private so the printed labels can be asserted directly.
 * pdfkit compresses its content streams, so a rendered buffer cannot be read
 * back for a string; while this was a private method, deleting the VAT rate
 * from its own label left every test green.
 *
 * Every row carries its tax mention, per brand floor §3.2's "without
 * exception". The discount comes off the goods total before VAT applies
 * (plan §2.7), so it is an HT amount like the subtotal it reduces. Shipping
 * carries no VAT under the same decision, so the delivery charge is already
 * the whole amount payable and is marked TTC; marking it HT would promise a
 * VAT line on it that never comes.
 */
export function buildTotalsBlock(
  invoice: InvoicePdfSnapshot,
  ctx: { L: Record<string, string>; locale: InvoiceLocale; money: (n: number) => string },
): TotalsBlock {
  const { L, locale, money } = ctx;
  const rows: TotalsRow[] = [{ label: L.subtotal, value: money(invoice.subtotal) }];
  if (invoice.discountAmount > 0) {
    rows.push({ label: L.discount, value: `- ${money(invoice.discountAmount)}` });
  }
  // The method name is the label when there is one: "Livraison · Livraison
  // standard" said the same word twice.
  rows.push({
    label: printable(`${invoice.shippingMethodName ?? L.shipping} ${L.taxIncluded}`, locale),
    value: money(invoice.shippingAmount),
  });
  const rate = deriveVatRate(invoice);
  rows.push({
    label: printable(rate === null ? L.tax : `${L.tax} ${formatVatRate(rate, locale)}`, locale),
    value: money(invoice.taxAmount),
  });
  return { rows, total: { label: L.total, value: money(invoice.total) } };
}

/**
 * A seller or buyer block, returning the y its last line ends at. Exported for
 * the unit spec.
 *
 * Each line is measured at the column width before the cursor advances, the
 * way the items table measures a description. A long street address or a
 * full legal name wraps at this width, and a fixed advance would draw the next
 * line over the wrap and hand back a y short of the block, which is where the
 * items table would then start.
 */
export function drawPartyBlock(
  doc: PDFKit.PDFDocument,
  opts: {
    x: number;
    top: number;
    width: number;
    heading: string;
    lines: string[];
    align?: 'left' | 'right';
    rtl?: boolean;
  },
): number {
  const { x, top, width, heading, lines, align = 'left', rtl = false } = opts;
  const run = runOptions(rtl);
  doc
    .font('bold')
    .fontSize(10)
    .fillColor(BRAND.text)
    .text(heading, x, top, { width, align, ...run });
  let y = top + 15;
  doc.font('body').fontSize(9.5).fillColor(BRAND.text);
  for (const line of lines) {
    // `max` keeps the unwrapped rhythm at PARTY_LINE_H and follows the wrap
    // past it.
    const h = doc.heightOfString(line, { width, ...run });
    doc.text(line, x, y, { width, align, ...run });
    y += Math.max(PARTY_LINE_H, h);
  }
  return y;
}

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly money: MoneyFormatterService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Renders a branded PDF for the given immutable invoice snapshot. Resolves
   * the seller's business block from Settings (graceful blanks) and lays the
   * document out in the customer's locale, paginating the items table when the
   * order is longer than one sheet.
   */
  async render(input: RenderInput): Promise<Buffer> {
    this.assertAssets();
    const seller = await this.loadSeller(input.locale);
    return this.draw(input, seller);
  }

  // ── Seller (business) block, resolved from Settings with graceful blanks ────
  private async loadSeller(locale: InvoiceLocale): Promise<string[]> {
    const business = await this.settings.getGroup('business');
    const general = await this.settings.getGroup('general');
    return composeSellerLines(
      business as Record<string, unknown>,
      general as Record<string, unknown>,
      locale,
    );
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────
  private draw(input: RenderInput, sellerLines: string[]): Promise<Buffer> {
    const { invoice, order, locale } = input;
    const L = tableFor(LABELS, locale);
    const currency = order.currency || this.money.currencyCode();
    // Amounts are written the way the runtime config says (symbol side,
    // separators, precision), in the order's own currency. This is a tax
    // document: a correctly stored three-decimal line printed at two decimals
    // would make the invoice disagree with the ledger it evidences.
    const money = (n: number): string => printable(this.money.format(n, currency), locale);
    const rtl = isRtlLocale(locale);
    const start = textEdge('start', rtl);
    const end = textEdge('end', rtl);
    const run = runOptions(rtl);

    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
    registerInvoiceFonts(doc, locale);
    doc.font('body');

    const done = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const left = PAGE_MARGIN;
    const right = PAGE_MARGIN + CONTENT_W;

    // ── Header: lockup at the start edge, title + meta at the end edge ────────
    const headerTop = PAGE_MARGIN;
    const logoH = 34;
    const logoPath = this.config.get<string>(LOGO_PATH_ENV);
    let drewLogo = false;
    if (logoPath) {
      try {
        doc.image(logoPath, mirrorX(left, CONTENT_W / 2, rtl), headerTop, {
          fit: [CONTENT_W / 2, logoH],
          align: rtl ? 'right' : undefined,
        });
        drewLogo = true;
      } catch (err) {
        this.logger.warn(
          `Invoice logo render failed (${(err as Error).message}); continuing with the store name`,
        );
      }
    }
    if (!drewLogo) {
      doc
        .font('display')
        .fontSize(18)
        .fillColor(BRAND.text)
        .text(sellerLines[0] ?? '', mirrorX(left, CONTENT_W / 2, rtl), headerTop + 6, {
          width: CONTENT_W / 2,
          align: start,
          ...run,
        });
    }

    doc
      .font('display')
      .fontSize(22)
      .fillColor(BRAND.text)
      .text(L.invoiceTitle, left, headerTop - 2, { width: CONTENT_W, align: end, ...run });

    let metaY = headerTop + 28;
    const metaLine = (label: string, value: string, mono = false) => {
      doc.font('body').fontSize(9).fillColor(BRAND.textMuted);
      const labelText = `${label} `;
      const labelW = doc.widthOfString(labelText, run);
      doc
        .font(mono ? 'mono' : 'body')
        .fontSize(9)
        .fillColor(BRAND.text);
      const valueW = doc.widthOfString(value, run);
      // Label then value hugging the end edge; the pair is reversed when mirrored.
      const startX = rtl ? left : right - labelW - valueW;
      const labelX = rtl ? startX + valueW : startX;
      const valueX = rtl ? startX : startX + labelW;
      doc
        .font('body')
        .fillColor(BRAND.textMuted)
        .text(labelText, labelX, metaY, { lineBreak: false, ...run });
      doc
        .font(mono ? 'mono' : 'body')
        .fillColor(BRAND.text)
        .text(value, valueX, metaY, { lineBreak: false, ...run });
      metaY += 13;
    };
    metaLine(L.invoiceNo, invoice.invoiceNumber, true);
    metaLine(L.orderNo, order.orderNumber, true);
    metaLine(L.date, printable(formatInvoiceDate(invoice.issuedAt, locale), locale));

    // The 2 pt Ardoise rule brand-floor §4.5 puts under the header.
    const ruleY = Math.max(headerTop + logoH + 10, metaY + 4);
    doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(2).strokeColor(BRAND.primary).stroke();

    // ── From / Bill-To columns ────────────────────────────────────────────────
    const blockY = ruleY + 18;
    const colW = (CONTENT_W - 20) / 2;

    const billLines = this.billingLines(invoice.billingAddress, locale);
    const fromEnd = drawPartyBlock(doc, {
      x: mirrorX(left, colW, rtl),
      top: blockY,
      width: colW,
      heading: L.from,
      lines: sellerLines,
      align: start,
      rtl,
    });
    const billEnd = drawPartyBlock(doc, {
      x: mirrorX(right - colW, colW, rtl),
      top: blockY,
      width: colW,
      heading: L.billTo,
      lines: billLines,
      align: start,
      rtl,
    });

    // ── Items table ───────────────────────────────────────────────────────────
    let y = Math.max(fromEnd, billEnd) + 18;
    y = this.drawItems(doc, y, invoice.items, { L, money, rtl, locale });

    // ── Totals (right aligned, never split across a page break) ───────────────
    const totalsW = 250;
    const totals = buildTotalsBlock(invoice, { L, locale, money });
    const totalsH = this.measureTotals(doc, totals.rows, totalsW * 0.6, rtl);
    y += 10;
    if (y + totalsH > CONTENT_BOTTOM) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
    this.drawTotals(doc, right - totalsW, totalsW, y, totals, rtl);

    // ── Footer, on every page ─────────────────────────────────────────────────
    // A distributor's consumable order runs to dozens of lines, so the table
    // paginates: `drawItems` turns the page before a row would cross the rule
    // below, and the footer is drawn once per buffered page. On a run of more
    // than one page each sheet also carries the invoice number and its position
    // in the run, so a detached page stays identifiable.
    this.drawFooters(doc, L, invoice.invoiceNumber, rtl);

    doc.end();
    return done;
  }

  private billingLines(addr: InvoicePdfBillingAddress | null, locale: InvoiceLocale): string[] {
    if (!addr) return [];
    const country = addr.country ? countryName(addr.country, locale) : '';
    return [
      addr.fullName,
      addr.addressLine1,
      addr.addressLine2,
      [addr.city, addr.state, addr.postalCode].filter(Boolean).join(', '),
      country,
      addr.phone,
    ]
      .filter((l): l is string => Boolean(l && l.trim()))
      .map((l) => printable(l, locale));
  }

  private drawItems(
    doc: PDFKit.PDFDocument,
    top: number,
    items: InvoicePdfItem[],
    ctx: {
      L: Record<string, string>;
      money: (n: number) => string;
      rtl: boolean;
      locale: InvoiceLocale;
    },
  ): number {
    const { L, money, rtl, locale } = ctx;
    const run = runOptions(rtl);
    const left = PAGE_MARGIN;
    const wQty = 50;
    const wUnit = 105;
    const wAmount = 110;
    const wDesc = CONTENT_W - wQty - wUnit - wAmount;

    const cols: ItemColumn[] = [
      { key: 'desc', w: wDesc, align: textEdge('start', rtl), x: mirrorX(left, wDesc, rtl) },
      { key: 'qty', w: wQty, align: textEdge('end', rtl), x: mirrorX(left + wDesc, wQty, rtl) },
      {
        key: 'unit',
        w: wUnit,
        align: textEdge('end', rtl),
        x: mirrorX(left + wDesc + wQty, wUnit, rtl),
      },
      {
        key: 'amount',
        w: wAmount,
        align: textEdge('end', rtl),
        x: mirrorX(left + wDesc + wQty + wUnit, wAmount, rtl),
      },
    ];
    const header: Record<ItemColumnKey, string> = {
      desc: L.description,
      qty: L.qty,
      unit: L.unitPrice,
      amount: L.amount,
    };

    let y = this.drawItemsHeader(doc, top, cols, header, rtl);

    for (const it of items) {
      const descH = this.measureDesc(doc, it, wDesc - 8, locale);
      const h = Math.max(ITEM_ROW_H, descH + 12);
      // A row that would cross the footer rule starts a fresh page, where the
      // column headers repeat. Turning the page is worth it only if the row
      // would fit on an empty one: a row taller than a whole page is drawn
      // where it stands rather than asking for a new page forever.
      const fitsOnAFreshPage = PAGE_MARGIN + ITEM_ROW_H + h <= CONTENT_BOTTOM;
      if (y + h > CONTENT_BOTTOM && fitsOnAFreshPage) {
        doc.addPage();
        y = this.drawItemsHeader(doc, PAGE_MARGIN, cols, header, rtl);
      }
      const name = printable(it.productName, locale);
      for (const c of cols) {
        if (c.key === 'desc') {
          doc
            .font('body')
            .fontSize(9.5)
            .fillColor(BRAND.text)
            .text(name, c.x + 4, y + 6, { width: c.w - 8, align: c.align, ...run });
          if (it.sku) {
            // The reference is an identifier, so it is the one cell in mono (§3).
            doc
              .font('mono')
              .fontSize(7.5)
              .fillColor(BRAND.textMuted)
              .text(it.sku, c.x + 4, doc.y, { width: c.w - 8, align: c.align, ...run });
          }
        } else {
          const val =
            c.key === 'qty'
              ? String(it.quantity)
              : c.key === 'unit'
                ? money(it.unitPrice)
                : money(it.total);
          doc
            .font('body')
            .fontSize(9)
            .fillColor(BRAND.text)
            .text(val, c.x + 4, y + 7, { width: c.w - 8, align: c.align, ...TABULAR });
        }
      }
      y += h;
      doc
        .moveTo(left, y)
        .lineTo(left + CONTENT_W, y)
        .lineWidth(0.5)
        .strokeColor(BRAND.border)
        .stroke();
    }
    return y;
  }

  /**
   * The column headings and the rule under them, returning the y rows start at.
   * Ruled rather than a filled band: brand floor §4.5 forbids a flat colour
   * fill on this document. Repeated at the top of every continuation page, so a
   * second sheet of line items still says what its columns are.
   */
  private drawItemsHeader(
    doc: PDFKit.PDFDocument,
    top: number,
    cols: ItemColumn[],
    header: Record<ItemColumnKey, string>,
    rtl: boolean,
  ): number {
    doc.font('bold').fontSize(9).fillColor(BRAND.text);
    for (const c of cols) {
      doc.text(header[c.key], c.x + 4, top + 4, {
        width: c.w - 8,
        align: c.align,
        ...runOptions(rtl),
      });
    }
    const y = top + ITEM_ROW_H;
    doc
      .moveTo(PAGE_MARGIN, y)
      .lineTo(PAGE_MARGIN + CONTENT_W, y)
      .lineWidth(1)
      .strokeColor(BRAND.primary)
      .stroke();
    return y;
  }

  private measureDesc(
    doc: PDFKit.PDFDocument,
    it: InvoicePdfItem,
    w: number,
    locale: InvoiceLocale,
  ): number {
    const run = runOptions(isRtlLocale(locale));
    doc.font('body').fontSize(9.5);
    let h = doc.heightOfString(printable(it.productName, locale), { width: w, ...run });
    if (it.sku) {
      doc.font('mono').fontSize(7.5);
      h += doc.heightOfString(it.sku, { width: w, ...run });
    }
    return h;
  }

  /**
   * Height of one totals row: whichever of the line box and the wrapped label
   * is taller, so a wrapped label can never overlap the next row.
   */
  private totalsRowHeight(
    doc: PDFKit.PDFDocument,
    label: string,
    labelW: number,
    rtl: boolean,
  ): number {
    doc.font('body').fontSize(TOTALS_ROW_SIZE);
    return Math.max(
      TOTALS_ROW_SIZE + 7,
      doc.heightOfString(label, { width: labelW, ...runOptions(rtl) }) + 4,
    );
  }

  private measureTotals(
    doc: PDFKit.PDFDocument,
    rows: TotalsRow[],
    labelW: number,
    rtl: boolean,
  ): number {
    const body = rows.reduce((h, r) => h + this.totalsRowHeight(doc, r.label, labelW, rtl), 0);
    return body + TOTALS_FOOT_H;
  }

  private drawTotals(
    doc: PDFKit.PDFDocument,
    x: number,
    w: number,
    top: number,
    block: TotalsBlock,
    rtl: boolean,
  ): number {
    // The label side takes the larger share: a shipping method name is the one
    // variable-length string in this block, and an even split wrapped it into
    // the row below.
    const labelW = w * 0.6;
    const valueW = w - labelW;
    const labelX = mirrorX(x, labelW, rtl);
    const valueX = mirrorX(x + labelW, valueW, rtl);
    const labelAlign = textEdge('start', rtl);
    const valueAlign = textEdge('end', rtl);

    let y = top;
    for (const row of block.rows) {
      const h = this.totalsRowHeight(doc, row.label, labelW, rtl);
      doc.font('body').fontSize(TOTALS_ROW_SIZE).fillColor(BRAND.textMuted);
      doc.text(row.label, labelX, y, { width: labelW, align: labelAlign, ...runOptions(rtl) });
      doc.fillColor(BRAND.text);
      doc.text(row.value, valueX, y, { width: valueW, align: valueAlign, ...TABULAR });
      y += h;
    }

    // Total, emphasised by weight and an Ardoise rule, never by a filled band.
    y += 2;
    doc
      .moveTo(mirrorX(x, w, rtl), y)
      .lineTo(mirrorX(x, w, rtl) + w, y)
      .lineWidth(1)
      .strokeColor(BRAND.primary)
      .stroke();
    y += 8;
    doc.font('bold').fontSize(12).fillColor(BRAND.text);
    doc.text(block.total.label, labelX, y, {
      width: labelW,
      align: labelAlign,
      ...runOptions(rtl),
    });
    doc.text(block.total.value, valueX, y, { width: valueW, align: valueAlign, ...TABULAR });
    return y + 24;
  }

  /**
   * The footer rule and thanks line, on every buffered page, plus the invoice
   * number and the page's position whenever the run is longer than one sheet.
   * `lineBreak: false` keeps the footer from ever pushing a page of its own.
   */
  private drawFooters(
    doc: PDFKit.PDFDocument,
    L: Record<string, string>,
    invoiceNumber: string,
    rtl: boolean,
  ): void {
    const left = PAGE_MARGIN;
    const right = PAGE_MARGIN + CONTENT_W;
    const range = doc.bufferedPageRange();

    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc
        .moveTo(left, FOOTER_RULE_Y)
        .lineTo(right, FOOTER_RULE_Y)
        .lineWidth(0.75)
        .strokeColor(BRAND.border)
        .stroke();
      doc
        .font('body')
        .fontSize(9)
        .fillColor(BRAND.textMuted)
        .text(L.thanks, left, FOOTER_RULE_Y + 8, {
          width: CONTENT_W,
          align: 'center',
          lineBreak: false,
          ...runOptions(rtl),
        });
      if (range.count > 1) {
        // The number is an identifier, so it is in mono (§3).
        doc
          .font('mono')
          .fontSize(7.5)
          .text(`${invoiceNumber} · ${i + 1} / ${range.count}`, left, FOOTER_RULE_Y + 9, {
            width: CONTENT_W,
            align: textEdge('end', rtl),
            lineBreak: false,
          });
      }
    }
  }

  private assertAssets(): void {
    for (const f of [
      FONT_REGULAR,
      FONT_BOLD,
      FONT_DISPLAY,
      FONT_MONO,
      FONT_ARABIC,
      FONT_ARABIC_BOLD,
    ]) {
      if (!fs.existsSync(f)) {
        // Fail-loud (§3.7): a missing committed font means the Dockerfile COPY
        // set or the working directory is wrong, never silently emit a
        // system-fallback face on a tax document.
        throw new Error(`InvoicePdfService: required font missing at ${f}`);
      }
    }
  }
}
