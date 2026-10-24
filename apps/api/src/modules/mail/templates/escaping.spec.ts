/**
 * File-tier escaping contract.
 *
 * The DB tier escapes inside `render.ts` `interpolate`. The file fallbacks under
 * this directory are plain TypeScript template literals, so they escape at their
 * own call site with `escapeVars` from `./layout`. This spec pins that contract
 * from the outside:
 *
 *   - the HTML arm carries the ESCAPED form of an untrusted value, never a live
 *     tag,
 *   - the plain-text arm and the subject carry the RAW characters, because
 *     neither is markup and a reader must see `&`, not `&amp;`.
 *
 * `contact-form` gets its own block: its four fields come from the
 * unauthenticated storefront form and land in the shop's own staff inbox, which
 * makes it the sharpest case in the registry.
 *
 * The store name is operator data too (a Translatable setting), so it gets the
 * same treatment: escaped in the html, raw in the subject.
 */
import { TEMPLATE_REGISTRY } from './registry';
import { render as renderContactForm } from './contact-form';
import { render as renderNewsletterConfirm } from './newsletter.confirm';
import { MAIL_LOCALES, type MailBrand, type MailJobName, type MailLocale } from '../mail.types';

/**
 * One hostile value carrying all three shapes the finding names: a tag with an
 * event handler, an anchor to an attacker origin, and a bare ampersand that
 * must survive intact in the text arm.
 */
const PAYLOAD = '<img src=x onerror=alert(1)> <a href="https://evil.example">tap</a> Tom & Jerry';

/** The same value after the five-character escape both tiers agree on. */
const ESCAPED_PAYLOAD =
  '&lt;img src=x onerror=alert(1)&gt; ' +
  '&lt;a href=&quot;https://evil.example&quot;&gt;tap&lt;/a&gt; Tom &amp; Jerry';

/**
 * Markup that must never reach the HTML arm intact. `onerror=` on its own is
 * NOT on this list on purpose: once `<` is escaped the handler name survives as
 * inert text, and asserting on it would fail a correctly escaped render.
 */
const LIVE_MARKUP = ['<img', '<script', 'href="https://evil.example"'] as const;

const BRAND: MailBrand = { storeName: 'Maison Exemple' };

/** Benign fill so a flow's required variables are present in every render. */
const BASE_VARS: Record<string, unknown> = {
  customerName: 'Ben Salah',
  firstName: 'Ben Salah',
  recipientName: 'Ben Salah',
  purchaserName: 'Ben Amor',
  inviterName: 'Ben Amor',
  fromName: 'Ben Salah',
  fromEmail: 'contact@example.test',
  currentEmail: 'ancienne@example.test',
  newEmail: 'nouvelle@example.test',
  role: 'Manager',
  appName: 'example.test',
  orderNumber: 'CMD-2026-000412',
  returnNumber: 'RET-2026-000031',
  trackingNumber: 'TRK0090182773',
  carrier: 'Aramex',
  code: 'GC-4K7Q-9M2X',
  otp: '482913',
  productName: 'Lampe de bureau',
  subjectLine: 'Demande de devis',
  message: 'Bonjour, merci de me communiquer un devis.',
  personalMessage: 'Bon usage.',
  reason: 'Rupture fournisseur',
  refundDetail: 'Le remboursement est effectue sur la carte utilisee.',
  submittedAt: 'mardi 24 mars 2026 à 14:32',
  expiresOn: 'mardi 30 juin 2026',
  periodLabel: 'la semaine ecoulee',
  itemCount: 3,
  orders: 42,
  newCustomers: 7,
  lowStockCount: 5,
  outOfStockCount: 2,
  newReturnsCount: 4,
  pendingReviewsCount: 6,
  total: '1 240,000 €',
  subtotal: '1 240,000 €',
  revenue: '1 240,000 €',
  aov: '1 240,000 €',
  balance: '1 240,000 €',
  initialBalance: '1 240,000 €',
  amountRedeemed: '1 240,000 €',
  remainingBalance: '1 240,000 €',
  refundAmount: '1 240,000 €',
  actionUrl: 'https://example.test/fr/compte/action',
  orderUrl: 'https://example.test/fr/compte/commandes/CMD-2026-000412',
  returnUrl: 'https://example.test/fr/compte/retours/RET-2026-000031',
  reviewUrl: 'https://example.test/fr/compte/avis/CMD-2026-000412',
  productUrl: 'https://example.test/fr/catalog/product/lampe-de-bureau',
  cartUrl: 'https://example.test/fr/panier',
  storefrontUrl: 'https://example.test/fr',
  redemptionUrl: 'https://example.test/fr/carte-cadeau',
  confirmUrl: 'https://example.test/fr/newsletter/confirmer',
  securityUrl: 'https://example.test/fr/compte/securite',
  trackingUrl: 'https://tracking.example.test/TRK0090182773',
  adminUrl: 'https://admin.example.test/tableau-de-bord',
};

function withPayload(...fields: string[]): Record<string, unknown> {
  const vars = { ...BASE_VARS };
  for (const field of fields) vars[field] = PAYLOAD;
  return vars;
}

function expectNoLiveMarkup(html: string): void {
  for (const fragment of LIVE_MARKUP) expect(html).not.toContain(fragment);
}

describe('file-tier template escaping', () => {
  describe.each(MAIL_LOCALES)('contact-form, anonymous storefront input (%s)', (locale) => {
    const out = renderContactForm(
      locale,
      {
        fromName: PAYLOAD,
        fromEmail: PAYLOAD,
        subjectLine: PAYLOAD,
        message: PAYLOAD,
        submittedAt: 'mardi 24 mars 2026 à 14:32',
      },
      BRAND,
    );

    it('escapes every submitted field in the html body', () => {
      // Four separate cells, so four occurrences of the escaped form.
      expect(out.html.split(ESCAPED_PAYLOAD)).toHaveLength(5);
    });

    it('leaves no live markup in the html body', () => {
      expectNoLiveMarkup(out.html);
    });

    it('keeps the raw characters in the plain-text part', () => {
      expect(out.text).toContain(PAYLOAD);
      expect(out.text).not.toContain('&amp;');
      expect(out.text).not.toContain('&lt;');
    });

    it('keeps the raw characters in the subject header', () => {
      expect(out.subject).toContain(PAYLOAD);
      expect(out.subject).not.toContain('&amp;');
    });
  });

  /**
   * Flows carrying a value some other party authored. `inText` / `inSubject`
   * record whether that flow's text arm and subject actually quote the field:
   * several only surface it in the HTML body.
   */
  const UNTRUSTED_FIELDS: ReadonlyArray<{
    code: MailJobName;
    field: string;
    inText: boolean;
    inSubject: boolean;
  }> = [
    { code: 'giftcard.purchase', field: 'personalMessage', inText: true, inSubject: false },
    { code: 'giftcard.purchase', field: 'purchaserName', inText: false, inSubject: true },
    { code: 'order.placed', field: 'customerName', inText: false, inSubject: false },
    { code: 'return.requested', field: 'customerName', inText: false, inSubject: false },
    { code: 'order.cancelled', field: 'reason', inText: false, inSubject: false },
    { code: 'order.shipped', field: 'carrier', inText: true, inSubject: false },
    { code: 'order.shipped', field: 'trackingNumber', inText: true, inSubject: false },
    { code: 'product.back-in-stock', field: 'productName', inText: true, inSubject: true },
    { code: 'question.answered', field: 'productName', inText: true, inSubject: false },
    { code: 'review.approved', field: 'productName', inText: true, inSubject: false },
    { code: 'customer.welcome', field: 'firstName', inText: true, inSubject: false },
    { code: 'auth.change-email-verification', field: 'newEmail', inText: true, inSubject: false },
  ];

  const FIELD_CASES = UNTRUSTED_FIELDS.flatMap((c) =>
    MAIL_LOCALES.map((locale) => ({ ...c, locale })),
  );

  describe.each(FIELD_CASES)('$code / $field / $locale', ({ code, field, inText, locale }) => {
    const out = TEMPLATE_REGISTRY[code](locale, withPayload(field), BRAND);

    it('escapes the untrusted value in the html body', () => {
      expect(out.html).toContain(ESCAPED_PAYLOAD);
      expect(out.html).not.toContain(PAYLOAD);
    });

    it('leaves no live markup in the html body', () => {
      expectNoLiveMarkup(out.html);
    });

    it('keeps the raw value in the plain-text part when the flow quotes it', () => {
      if (!inText) return;
      expect(out.text).toContain(PAYLOAD);
    });
  });

  describe.each(FIELD_CASES.filter((c) => c.inSubject))(
    '$code / $field / $locale subject',
    ({ code, field, locale }) => {
      it('keeps the raw value in the subject header', () => {
        const out = TEMPLATE_REGISTRY[code](locale, withPayload(field), BRAND);
        expect(out.subject).toContain(PAYLOAD);
      });
    },
  );

  describe.each(MAIL_LOCALES)('an ampersand in an action url (%s)', (locale) => {
    const confirmUrl = 'https://example.test/fr/newsletter/confirmer?token=abc&sig=def';
    const out = renderNewsletterConfirm(locale, { confirmUrl }, BRAND);

    it('renders the valid attribute form in the href', () => {
      expect(out.html).toContain(
        'href="https://example.test/fr/newsletter/confirmer?token=abc&amp;sig=def"',
      );
      expect(out.html).not.toContain('token=abc&sig=def');
    });

    it('keeps the bare ampersand in the plain-text part', () => {
      expect(out.text).toContain(confirmUrl);
    });
  });

  /**
   * Registry-wide net: feed the payload into EVERY string variable of EVERY
   * flow. A template added later that interpolates a raw `${vars.x}` into its
   * HTML fails here without anyone remembering to extend the table above.
   */
  describe('registry-wide hostile-variable sweep', () => {
    const HOSTILE_VARS = Object.fromEntries(
      Object.entries(BASE_VARS).map(([key, value]) => [
        key,
        typeof value === 'string' ? PAYLOAD : value,
      ]),
    );
    const PAIRS: ReadonlyArray<readonly [MailJobName, MailLocale]> = (
      Object.keys(TEMPLATE_REGISTRY) as MailJobName[]
    ).flatMap((code) => MAIL_LOCALES.map((locale) => [code, locale] as const));

    it.each(PAIRS)('%s / %s renders no live markup from a hostile variable bag', (code, locale) => {
      const out = TEMPLATE_REGISTRY[code](locale, HOSTILE_VARS, BRAND);
      expectNoLiveMarkup(out.html);
      expect(out.html).not.toContain(PAYLOAD);
    });

    /**
     * The store name is operator data from the settings table, so a name
     * carrying markup must reach the html escaped, in the chrome and in the
     * copy alike, while the subject header keeps it raw.
     */
    it.each(PAIRS)('%s / %s escapes a hostile store name in the html only', (code, locale) => {
      const out = TEMPLATE_REGISTRY[code](locale, BASE_VARS, { storeName: PAYLOAD });
      expectNoLiveMarkup(out.html);
      expect(out.html).not.toContain(PAYLOAD);
      expect(out.html).toContain(ESCAPED_PAYLOAD);
      if (code !== 'contact-form') expect(out.subject).toContain(PAYLOAD);
    });
  });
});
