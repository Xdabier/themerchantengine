/**
 * Default copy for the system win-back campaign (NE9). The scheduled win-back
 * job materialises a Campaign row with this Translatable subject/body, attaches
 * a coupon, and sends it on the campaign plane. Body is the inner content
 * block, which `renderDraft` composes into the shared layout at send time.
 *
 * Variables: `couponCode`, `discountLabel`, `shopUrl`, `storeName`. Win-back
 * never sends without a coupon (operator decision: "win-back w/ coupon"), so
 * the copy can reference `{{couponCode}}` unconditionally. `storeName` is the
 * runtime config value the renderer injects (DR-31).
 *
 * The copy is a plain reorder notice, not a nudge: no urgency framing, no
 * manufactured sentiment, so there is no "we miss you", no "shop now", and no
 * exclamation. Every catalogue locale ships copy; the send picks the
 * recipient's. `ar` renders right-to-left, so `cta` aligns per locale.
 */
import { storeLocales } from '@common/locale';

export type Translatable = Record<string, string>;

// Palette mirrors `mail/templates/layout.ts`.
const ARDOISE_DARK = '#3E33A0';
const PAPIER = '#FFFFFF';
const ENCRE = '#0A1A26';
const VOILE = '#EEEDFB';
const GRIS = '#55606A';

const h1 = (text: string): string => `<h1 style="font-size:22px;margin:0 0 12px;">${text}</h1>`;
const p = (text: string): string => `<p style="margin:0 0 16px;">${text}</p>`;
const meta = (text: string): string =>
  `<p style="margin:16px 0 4px;color:${GRIS};font-size:13px;">${text}</p>`;

function cta(hrefToken: string, label: string, locale: string): string {
  const align = storeLocales.direction(locale) === 'rtl' ? 'right' : 'left';
  return (
    `<div style="margin:24px 0;text-align:${align};">` +
    `<a href="{{{${hrefToken}}}}" style="display:inline-block;background:${ARDOISE_DARK};color:${PAPIER};padding:12px 28px;text-decoration:none;font-weight:600;font-size:15px;border:1px solid ${ARDOISE_DARK};">` +
    `${label}</a></div>`
  );
}

function codeBox(codeToken: string): string {
  return (
    `<div style="margin:24px 0;padding:16px 20px;background:${VOILE};color:${ENCRE};` +
    `font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;` +
    `font-size:18px;font-weight:500;letter-spacing:0.08em;display:inline-block;">{{${codeToken}}}</div>`
  );
}

export const WINBACK_DEFAULT_SUBJECT: Translatable = {
  fr: 'Votre code de remise {{discountLabel}} · {{storeName}}',
  en: 'Your {{discountLabel}} discount code · {{storeName}}',
  ar: 'رمز الخصم {{discountLabel}} الخاص بك · {{storeName}}',
};

export const WINBACK_DEFAULT_BODY: Translatable = {
  fr:
    h1('Votre code de remise') +
    p(
      'Un code de remise est rattaché à votre compte {{storeName}}. ' +
        "Il s'applique à votre prochaine commande.",
    ) +
    p('Remise sur le total&nbsp;: <strong>{{discountLabel}}</strong>.') +
    meta('Le code&nbsp;:') +
    codeBox('couponCode') +
    p('Saisissez ce code au moment du paiement.') +
    cta('shopUrl', 'Voir le catalogue', 'fr'),
  en:
    h1('Your discount code') +
    p('A discount code is attached to your {{storeName}} account. It applies to your next order.') +
    p('Discount on the total: <strong>{{discountLabel}}</strong>.') +
    meta('The code:') +
    codeBox('couponCode') +
    p('Enter this code at checkout.') +
    cta('shopUrl', 'View the catalogue', 'en'),
  ar:
    h1('رمز الخصم الخاص بك') +
    p('تم ربط رمز خصم بحسابك في {{storeName}}. يسري على طلبك القادم.') +
    p('الخصم على الإجمالي: <strong>{{discountLabel}}</strong>.') +
    meta('الرمز:') +
    codeBox('couponCode') +
    p('أدخل هذا الرمز عند الدفع.') +
    cta('shopUrl', 'عرض الكتالوج', 'ar'),
};

export const WINBACK_VARIABLES = ['couponCode', 'discountLabel', 'shopUrl', 'storeName'] as const;
