/**
 * Canonical fr/en/ar defaults for every transactional-email flow (NE3).
 *
 * These are the seeded + backfilled `NotificationTemplate` bodies, the live,
 * operator-editable source of truth the renderer prefers once a row's body is
 * non-empty (`render.ts` two-tier resolver). The matching TS file templates
 * under `apps/api/src/modules/mail/templates/*.ts` stay as the compile-checked
 * fallback the renderer uses only when a DB row is missing/empty/corrupt.
 *
 * IMPORTANT: this file is imported by `prisma/seed.ts`, which runs in the slim
 * PROD runtime image that does NOT include `apps/api/src`. It therefore must
 * stay self-contained: NO imports from `apps/api`. The CTA-button / code-block
 * markup below is reproduced inline (a snapshot of `templates/layout.ts`'s
 * `ctaButton` / `codeBlock` output) rather than imported. The palette constants
 * mirror `templates/layout.ts` `BRAND` value for value, so the two tiers cannot
 * drift.
 *
 * Body shape: each body is the INNER content block only. `render.ts` composes
 * it into the shared brand layout (`renderLayout`) at send time, so the bodies
 * here carry no `<html>`/header/footer chrome. Variables are interpolated by
 * the tiny `{{escaped}}` / `{{{raw}}}` interpolator: use `{{{token}}}` inside
 * an `href`, `{{token}}` everywhere else. That rule covers THIS tier only. The
 * TS file fallbacks are template literals with no interpolator, so each of them
 * escapes at its own call site with `escapeVars` from `templates/layout.ts`,
 * HTML arm only. Both tiers escape the same five characters the same way.
 *
 * Store name: never a literal. The renderer adds `{{storeName}}` to the
 * variables of every send from the runtime config (DR-31), resolved to the
 * message locale, so a flow that names the store declares `storeName` in its
 * `variables` and interpolates it.
 *
 * Direction: the renderer's own layout reads the store's locale set at send
 * time for `dir` and alignment. The one aligned block this file snapshots (the
 * CTA) reads the direction from the locale registry.
 *
 * Authoring rule (no-conditional interpolator): the default copy uses only the
 * REQUIRED variables of a flow and reads cleanly when optional variables are
 * absent. Optional variables (e.g. `customerName`, `trackingNumber`, `reason`)
 * stay declared in `variables` as an editor insert-menu but are not baked into
 * the default copy, so a send never renders a dangling "Motif : ." artifact.
 * The richer per-send conditional copy lives in the TS file fallbacks.
 *
 * Money: every amount reaches a template already formatted for display, in
 * the store's own currency. There is no `currency` variable any more. The tax
 * mention is literal copy beside the amount: `TTC` on a paid total, `HT` on a
 * catalogue or line figure, the spelled-out forms in Arabic.
 */

import {
  getLocaleDefinition,
  type RegistryLocale,
} from '../libs/shared/common/src/locale/locale-registry';

export type MailLocale = RegistryLocale;

// A `type` alias (not an `interface`) on purpose: a named interface is not
// assignable to Prisma's `InputJsonValue` (interfaces have no implicit index
// signature), so seeding `body: def.body` would fail to type-check. A closed
// type alias satisfies the Json index-signature constraint.
export type Translatable = {
  fr: string;
  en: string;
  ar: string;
};

export interface NotificationTemplateDefault {
  subject: Translatable;
  body: Translatable;
  variables: string[];
}

// ── Inline layout primitives (snapshot of templates/layout.ts) ───────────────

/** Mirrors `templates/layout.ts` `BRAND`. */
const BRAND = {
  primary: '#5043BF', // accent, links
  primaryDark: '#3E33A0', // deep accent, the ground for small white text
  text: '#0A1A26', // ink
  muted: '#55606A', // interface grey
  surface: '#EEEDFB', // tint
  border: '#E4E6EB', // rule
  paper: '#FFFFFF', // paper
} as const;

/** The tax mention beside a paid total, per locale. */
const TTC: Record<MailLocale, string> = { fr: 'TTC', en: 'TTC', ar: 'شامل الضريبة' };

/** The tax mention beside a catalogue or line figure, per locale. */
const HT: Record<MailLocale, string> = { fr: 'HT', en: 'HT', ar: 'دون احتساب الضريبة' };

const h1 = (text: string): string => `<h1 style="font-size:22px;margin:0 0 12px;">${text}</h1>`;
const p = (text: string): string => `<p style="margin:0 0 16px;">${text}</p>`;

function textAlign(locale: MailLocale): 'left' | 'right' {
  return getLocaleDefinition(locale)?.direction === 'rtl' ? 'right' : 'left';
}

function cta(hrefToken: string, label: string, locale: MailLocale): string {
  return (
    `<div style="margin:24px 0;text-align:${textAlign(locale)};">` +
    `<a href="{{{${hrefToken}}}}" style="display:inline-block;background:${BRAND.primaryDark};color:${BRAND.paper};padding:12px 28px;text-decoration:none;font-weight:600;font-size:15px;border:1px solid ${BRAND.primaryDark};">` +
    `${label}</a></div>`
  );
}

function codeBox(codeToken: string): string {
  return (
    `<div style="margin:24px 0;padding:16px 20px;background:${BRAND.surface};color:${BRAND.text};` +
    `font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;` +
    `font-size:18px;font-weight:500;letter-spacing:0.08em;display:inline-block;">{{${codeToken}}}</div>`
  );
}

/**
 * Inline monospace identifier: a snapshot of `templates/layout.ts` `monoId`.
 *
 * `codeBox` above is the standalone form; this is the same face inside a
 * sentence, for the order / return / tracking / gift-card references set in
 * JetBrains Mono. It takes a TOKEN rather than markup and emits the escaped
 * `{{token}}` rung, because every identifier here is per-send data rather
 * than copy.
 *
 * A money value keeps `<strong>` deliberately: prices are set in tabular
 * numerals rather than mono.
 */
function mono(token: string): string {
  return (
    `<span style="font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;` +
    `font-weight:500;white-space:nowrap;">{{${token}}}</span>`
  );
}

/** A "copy this link" fallback line, surfaces the URL for clients that block buttons. */
function linkFallback(label: string, urlToken: string): string {
  return (
    `<p style="margin:24px 0 0;color:${BRAND.muted};font-size:13px;">${label}<br>` +
    `<a href="{{{${urlToken}}}}" style="color:${BRAND.primary};word-break:break-all;">{{${urlToken}}}</a></p>`
  );
}

/** Caption above an identifier block. */
const codeLabel = (text: string): string =>
  `<p style="margin:16px 0 4px;color:${BRAND.muted};font-size:13px;">${text}</p>`;

/** A two-column metrics table row, value aligned to the reading end. */
const metricRow = (label: string, valueHtml: string): string =>
  `<tr><td style="padding:6px 0;">${label}</td><td style="padding:6px 0;text-align:end;">${valueHtml}</td></tr>`;

const metricsTable = (rows: string): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;margin:8px 0 4px;">${rows}</table>`;

const FR_LINK_FALLBACK = "Si le bouton ne s'ouvre pas, copiez ce lien dans votre navigateur&nbsp;:";
const EN_LINK_FALLBACK = 'If the button does not open, copy this link into your browser:';
const AR_LINK_FALLBACK = 'إذا لم يفتح الزر، انسخ هذا الرابط إلى المتصفح:';

/** The transactional flows, must mirror `apps/api/.../mail.types.ts` MailJobName. */
export const MAIL_FLOW_CODES = [
  'auth.password-reset',
  'auth.email-verification',
  'auth.magic-link',
  'auth.change-email-verification',
  'auth.delete-account',
  'auth.password-changed',
  'auth.email-change-alert',
  'customer.welcome',
  'order.placed',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'order.confirmed',
  'order.exchange-created',
  'giftcard.purchase',
  'giftcard.redeemed',
  'giftcard.store-credit',
  'return.requested',
  'return.approved',
  'return.rejected',
  'return.received',
  'return.refunded',
  'question.answered',
  'review.approved',
  'cart.abandoned',
  'admin.staff-invite',
  'contact-form',
  // NE8: staff digests + scheduled lifecycle flows
  'product.back-in-stock',
  'review.request',
  'giftcard.expiry-reminder',
  'auth.2fa-otp',
  'auth.2fa-enabled',
  'auth.2fa-disabled',
  'admin.ops-digest',
  'admin.kpi-digest',
  // NE9: marketing / broadcast plane
  'newsletter.confirm',
] as const;

export type MailFlowCode = (typeof MAIL_FLOW_CODES)[number];

export const TEMPLATE_DEFAULTS: Record<MailFlowCode, NotificationTemplateDefault> = {
  'auth.password-reset': {
    subject: {
      fr: 'Réinitialisation de votre mot de passe · {{storeName}}',
      en: 'Reset your password · {{storeName}}',
      ar: 'إعادة تعيين كلمة المرور · {{storeName}}',
    },
    variables: ['actionUrl', 'storeName'],
    body: {
      fr:
        h1('Réinitialisation de votre mot de passe') +
        p(
          'Vous avez demandé un nouveau mot de passe. Le bouton ci-dessous ouvre la page de ' +
            "réinitialisation. Le lien est valable 1 heure et ne fonctionne qu'une seule fois. " +
            "Si vous n'êtes pas à l'origine de cette demande, aucune action n'est nécessaire, " +
            'votre mot de passe actuel reste valable.',
        ) +
        cta('actionUrl', 'Réinitialiser le mot de passe', 'fr') +
        linkFallback(FR_LINK_FALLBACK, 'actionUrl'),
      en:
        h1('Reset your password') +
        p(
          'You asked for a new password. The button below opens the reset page. The link is ' +
            'valid for 1 hour and works once. If you did not make this request, no action is ' +
            'needed, your current password stays valid.',
        ) +
        cta('actionUrl', 'Reset password', 'en') +
        linkFallback(EN_LINK_FALLBACK, 'actionUrl'),
      ar:
        h1('إعادة تعيين كلمة المرور') +
        p(
          'طلبت كلمة مرور جديدة. الزر أدناه يفتح صفحة إعادة التعيين. الرابط صالح لمدة ساعة ' +
            'واحدة ويعمل مرة واحدة فقط. إذا لم تطلب ذلك، فلا حاجة لأي إجراء، وتبقى كلمة ' +
            'المرور الحالية صالحة.',
        ) +
        cta('actionUrl', 'إعادة تعيين كلمة المرور', 'ar') +
        linkFallback(AR_LINK_FALLBACK, 'actionUrl'),
    },
  },

  'auth.email-verification': {
    subject: {
      fr: 'Confirmez votre adresse e-mail · {{storeName}}',
      en: 'Confirm your email address · {{storeName}}',
      ar: 'تأكيد عنوان بريدك الإلكتروني · {{storeName}}',
    },
    variables: ['actionUrl', 'storeName'],
    body: {
      fr:
        h1('Confirmez votre adresse e-mail') +
        p(
          'Votre compte {{storeName}} est créé. Il reste à confirmer cette adresse pour ' +
            "l'activer, et le bouton ci-dessous le fait en une étape. Le lien est valable " +
            "24 heures. Si vous n'êtes pas à l'origine de cette inscription, aucune action " +
            "n'est nécessaire.",
        ) +
        cta('actionUrl', 'Confirmer mon adresse', 'fr') +
        linkFallback(FR_LINK_FALLBACK, 'actionUrl'),
      en:
        h1('Confirm your email address') +
        p(
          'Your {{storeName}} account is created. Confirming this address activates it, and ' +
            'the button below does that in one step. The link is valid for 24 hours. If you did ' +
            'not sign up, no action is needed.',
        ) +
        cta('actionUrl', 'Confirm my address', 'en') +
        linkFallback(EN_LINK_FALLBACK, 'actionUrl'),
      ar:
        h1('تأكيد عنوان بريدك الإلكتروني') +
        p(
          'تم إنشاء حسابك في {{storeName}}. يبقى تأكيد هذا العنوان لتفعيله، والزر أدناه يقوم ' +
            'بذلك في خطوة واحدة. الرابط صالح لمدة 24 ساعة. إذا لم تقم بهذا التسجيل، فلا حاجة ' +
            'لأي إجراء.',
        ) +
        cta('actionUrl', 'تأكيد عنواني', 'ar') +
        linkFallback(AR_LINK_FALLBACK, 'actionUrl'),
    },
  },

  'auth.magic-link': {
    subject: {
      fr: 'Votre lien de connexion · {{storeName}}',
      en: 'Your sign-in link · {{storeName}}',
      ar: 'رابط تسجيل الدخول · {{storeName}}',
    },
    variables: ['actionUrl', 'storeName'],
    body: {
      fr:
        h1('Votre lien de connexion') +
        p(
          'Le bouton ci-dessous vous connecte à votre compte sans mot de passe. Le lien est ' +
            "valable 5 minutes et ne fonctionne qu'une seule fois. Si vous n'avez pas demandé " +
            "cette connexion, aucune action n'est nécessaire.",
        ) +
        cta('actionUrl', 'Se connecter', 'fr') +
        linkFallback(FR_LINK_FALLBACK, 'actionUrl'),
      en:
        h1('Your sign-in link') +
        p(
          'The button below signs you in to your account without a password. The link is ' +
            'valid for 5 minutes and works once. If you did not ask to sign in, no action is ' +
            'needed.',
        ) +
        cta('actionUrl', 'Sign in', 'en') +
        linkFallback(EN_LINK_FALLBACK, 'actionUrl'),
      ar:
        h1('رابط تسجيل الدخول') +
        p(
          'الزر أدناه يسجل دخولك إلى حسابك دون كلمة مرور. الرابط صالح لمدة 5 دقائق ويعمل ' +
            'مرة واحدة فقط. إذا لم تطلب تسجيل الدخول، فلا حاجة لأي إجراء.',
        ) +
        cta('actionUrl', 'تسجيل الدخول', 'ar') +
        linkFallback(AR_LINK_FALLBACK, 'actionUrl'),
    },
  },

  'auth.change-email-verification': {
    subject: {
      fr: 'Confirmez votre nouvelle adresse e-mail · {{storeName}}',
      en: 'Confirm your new email address · {{storeName}}',
      ar: 'تأكيد عنوان بريدك الإلكتروني الجديد · {{storeName}}',
    },
    variables: ['actionUrl', 'newEmail', 'currentEmail', 'storeName'],
    body: {
      fr:
        h1('Confirmez votre nouvelle adresse e-mail') +
        p(
          "Vous avez demandé le remplacement de l'adresse e-mail de votre compte par " +
            '<strong>{{newEmail}}</strong>.',
        ) +
        p(
          'Le bouton ci-dessous applique le changement. Le lien est valable 24 heures et ne ' +
            "fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, " +
            "aucune action n'est nécessaire, votre adresse actuelle reste en place.",
        ) +
        cta('actionUrl', 'Confirmer la nouvelle adresse', 'fr'),
      en:
        h1('Confirm your new email address') +
        p(
          'You asked to replace the email address on your account with ' +
            '<strong>{{newEmail}}</strong>.',
        ) +
        p(
          'The button below applies the change. The link is valid for 24 hours and works once. ' +
            'If you did not make this request, no action is needed, your current address stays ' +
            'in place.',
        ) +
        cta('actionUrl', 'Confirm new address', 'en'),
      ar:
        h1('تأكيد عنوان بريدك الإلكتروني الجديد') +
        p('طلبت تغيير عنوان البريد الإلكتروني لحسابك إلى <strong>{{newEmail}}</strong>.') +
        p(
          'الزر أدناه يطبق التغيير. الرابط صالح لمدة 24 ساعة ويعمل مرة واحدة فقط. إذا لم ' +
            'تطلب ذلك، فلا حاجة لأي إجراء، ويبقى عنوانك الحالي كما هو.',
        ) +
        cta('actionUrl', 'تأكيد العنوان الجديد', 'ar'),
    },
  },

  'auth.delete-account': {
    subject: {
      fr: 'Confirmez la suppression de votre compte · {{storeName}}',
      en: 'Confirm account deletion · {{storeName}}',
      ar: 'تأكيد حذف حسابك · {{storeName}}',
    },
    variables: ['actionUrl', 'storeName'],
    body: {
      fr:
        h1('Confirmez la suppression de votre compte') +
        p(
          'Vous avez demandé la suppression de votre compte. Le bouton ci-dessous confirme ' +
            "l'opération, qui est définitive et ne peut pas être annulée. Le lien est valable " +
            "24 heures et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de " +
            "cette demande, aucune action n'est nécessaire, votre compte reste actif.",
        ) +
        cta('actionUrl', 'Supprimer mon compte', 'fr'),
      en:
        h1('Confirm account deletion') +
        p(
          'You asked to delete your account. The button below confirms it, and deletion is ' +
            'permanent and cannot be undone. The link is valid for 24 hours and works once. If ' +
            'you did not make this request, no action is needed, your account stays active.',
        ) +
        cta('actionUrl', 'Delete my account', 'en'),
      ar:
        h1('تأكيد حذف حسابك') +
        p(
          'طلبت حذف حسابك. الزر أدناه يؤكد العملية، وهي نهائية ولا يمكن التراجع عنها. ' +
            'الرابط صالح لمدة 24 ساعة ويعمل مرة واحدة فقط. إذا لم تطلب ذلك، فلا حاجة لأي ' +
            'إجراء، ويبقى حسابك نشطاً.',
        ) +
        cta('actionUrl', 'حذف حسابي', 'ar'),
    },
  },

  'auth.password-changed': {
    subject: {
      fr: 'Votre mot de passe a été modifié · {{storeName}}',
      en: 'Your password was changed · {{storeName}}',
      ar: 'تم تغيير كلمة المرور · {{storeName}}',
    },
    variables: ['storeName'],
    body: {
      fr:
        h1('Votre mot de passe a été modifié') +
        p(
          "Le mot de passe de votre compte vient d'être modifié, et toutes les sessions ont " +
            "été déconnectées. Si vous êtes à l'origine de ce changement, aucune action n'est " +
            'nécessaire. Sinon, réinitialisez le mot de passe depuis la page de connexion, puis ' +
            'prévenez notre service client.',
        ),
      en:
        h1('Your password was changed') +
        p(
          'The password on your account was just changed, and all sessions were signed out. ' +
            'If this was you, no action is needed. If it was not, reset the password from the ' +
            'sign-in page, then tell our customer service.',
        ),
      ar:
        h1('تم تغيير كلمة المرور') +
        p(
          'تم تغيير كلمة مرور حسابك للتو، وتم تسجيل الخروج من جميع الجلسات. إذا كنت أنت من ' +
            'قام بهذا التغيير، فلا حاجة لأي إجراء. وإلا، أعد تعيين كلمة المرور من صفحة تسجيل ' +
            'الدخول، ثم أبلغ خدمة العملاء.',
        ),
    },
  },

  'auth.email-change-alert': {
    subject: {
      fr: "Demande de changement d'adresse e-mail · {{storeName}}",
      en: 'Email change requested · {{storeName}}',
      ar: 'طلب تغيير عنوان البريد الإلكتروني · {{storeName}}',
    },
    variables: ['newEmail', 'storeName'],
    body: {
      fr:
        h1("Demande de changement d'adresse e-mail") +
        p(
          "Une demande a été enregistrée pour remplacer l'adresse e-mail de votre compte par " +
            '<strong>{{newEmail}}</strong>. Un lien de confirmation a été envoyé à cette ' +
            "nouvelle adresse, et le changement ne prend effet qu'une fois ce lien utilisé. " +
            "Si vous n'êtes pas à l'origine de cette demande, prévenez notre service client. " +
            'Votre adresse actuelle reste active jusque-là.',
        ),
      en:
        h1('Email change requested') +
        p(
          'A request was recorded to replace the email address on your account with ' +
            '<strong>{{newEmail}}</strong>. A confirmation link was sent to that new address, ' +
            'and the change only takes effect once that link is used. If you did not make this ' +
            'request, tell our customer service. Your current address stays active until then.',
        ),
      ar:
        h1('طلب تغيير عنوان البريد الإلكتروني') +
        p(
          'تم تسجيل طلب لتغيير عنوان البريد الإلكتروني لحسابك إلى ' +
            '<strong>{{newEmail}}</strong>. أرسلنا رابط تأكيد إلى هذا العنوان الجديد، ولا يسري ' +
            'التغيير إلا بعد استخدام هذا الرابط. إذا لم تطلب ذلك، أبلغ خدمة العملاء. يبقى ' +
            'عنوانك الحالي نشطاً حتى ذلك الحين.',
        ),
    },
  },

  'customer.welcome': {
    subject: {
      fr: 'Votre compte est ouvert · {{storeName}}',
      en: 'Your account is open · {{storeName}}',
      ar: 'تم فتح حسابك · {{storeName}}',
    },
    variables: ['firstName', 'storefrontUrl', 'storeName'],
    body: {
      fr:
        h1('Votre compte est ouvert') +
        p(
          'Votre compte est vérifié et actif. Vous y trouvez le catalogue complet avec les ' +
            `prix ${HT.fr}, l'historique de vos commandes et vos factures en téléchargement. Les ` +
            'adresses de livraison enregistrées sont reprises à la commande suivante.',
        ) +
        cta('storefrontUrl', 'Voir le catalogue', 'fr'),
      en:
        h1('Your account is open') +
        p(
          `Your account is verified and active. It gives you the full catalogue with ${HT.en} ` +
            'prices, your order history, and your invoices to download. Saved delivery ' +
            'addresses carry over to your next order.',
        ) +
        cta('storefrontUrl', 'View the catalogue', 'en'),
      ar:
        h1('تم فتح حسابك') +
        p(
          `حسابك مؤكد ونشط. تجد فيه الكتالوج الكامل بالأسعار ${HT.ar}، وسجل طلباتك، ` +
            'وفواتيرك للتنزيل. تُستخدم عناوين التوصيل المحفوظة في الطلب التالي.',
        ) +
        cta('storefrontUrl', 'عرض الكتالوج', 'ar'),
    },
  },

  'order.placed': {
    subject: {
      fr: 'Commande {{orderNumber}} reçue · {{storeName}}',
      en: 'Order {{orderNumber}} received · {{storeName}}',
      ar: 'تم استلام الطلب {{orderNumber}} · {{storeName}}',
    },
    variables: ['orderNumber', 'customerName', 'total', 'itemCount', 'orderUrl', 'storeName'],
    body: {
      fr:
        h1('Commande reçue') +
        p(
          'Nous avons bien reçu votre commande ' +
            mono('orderNumber') +
            '&nbsp;: ' +
            `{{itemCount}} article(s) pour un total de <strong>{{total}}</strong> ${TTC.fr}. Vous ` +
            "recevrez un message dès l'expédition.",
        ) +
        cta('orderUrl', 'Voir la commande', 'fr'),
      en:
        h1('Order received') +
        p(
          'We received your order ' +
            mono('orderNumber') +
            ': {{itemCount}} ' +
            `item(s) for a total of <strong>{{total}}</strong> ${TTC.en}. We will write again when it ` +
            'ships.',
        ) +
        cta('orderUrl', 'View order', 'en'),
      ar:
        h1('تم استلام الطلب') +
        p(
          'استلمنا طلبك ' +
            mono('orderNumber') +
            ': {{itemCount}} ' +
            `منتج بإجمالي <strong>{{total}}</strong> ${TTC.ar}. سنراسلك عند الشحن.`,
        ) +
        cta('orderUrl', 'عرض الطلب', 'ar'),
    },
  },

  'order.shipped': {
    subject: {
      fr: 'Commande {{orderNumber}} expédiée · {{storeName}}',
      en: 'Order {{orderNumber}} shipped · {{storeName}}',
      ar: 'تم شحن الطلب {{orderNumber}} · {{storeName}}',
    },
    variables: ['orderNumber', 'trackingNumber', 'carrier', 'orderUrl', 'storeName'],
    body: {
      fr:
        h1('Commande expédiée') +
        p(
          'La commande ' +
            mono('orderNumber') +
            ' est expédiée. Le transporteur et le ' +
            'numéro de suivi sont indiqués sur la page de la commande.',
        ) +
        cta('orderUrl', 'Voir la commande', 'fr'),
      en:
        h1('Order shipped') +
        p(
          'Order ' +
            mono('orderNumber') +
            ' has shipped. The carrier and the tracking ' +
            'number are shown on the order page.',
        ) +
        cta('orderUrl', 'View order', 'en'),
      ar:
        h1('تم شحن الطلب') +
        p(
          'تم شحن الطلب ' + mono('orderNumber') + '. شركة الشحن ورقم التتبع مذكوران في صفحة الطلب.',
        ) +
        cta('orderUrl', 'عرض الطلب', 'ar'),
    },
  },

  'order.delivered': {
    subject: {
      fr: 'Commande {{orderNumber}} livrée · {{storeName}}',
      en: 'Order {{orderNumber}} delivered · {{storeName}}',
      ar: 'تم تسليم الطلب {{orderNumber}} · {{storeName}}',
    },
    variables: ['orderNumber', 'orderUrl', 'storeName'],
    body: {
      fr:
        h1('Commande livrée') +
        p(
          'La commande ' +
            mono('orderNumber') +
            ' est marquée comme livrée. Si un article ' +
            'manque ou ne correspond pas, signalez-le depuis votre compte.',
        ) +
        cta('orderUrl', 'Voir la commande', 'fr'),
      en:
        h1('Order delivered') +
        p(
          'Order ' +
            mono('orderNumber') +
            ' is marked as delivered. If an item is missing ' +
            'or does not match, report it from your account.',
        ) +
        cta('orderUrl', 'View order', 'en'),
      ar:
        h1('تم تسليم الطلب') +
        p(
          'تم تسجيل الطلب ' +
            mono('orderNumber') +
            ' كمُسلَّم. إذا كان هناك منتج ناقص أو غير مطابق، أبلغ عنه من حسابك.',
        ) +
        cta('orderUrl', 'عرض الطلب', 'ar'),
    },
  },

  'order.cancelled': {
    subject: {
      fr: 'Commande {{orderNumber}} annulée · {{storeName}}',
      en: 'Order {{orderNumber}} cancelled · {{storeName}}',
      ar: 'تم إلغاء الطلب {{orderNumber}} · {{storeName}}',
    },
    variables: ['orderNumber', 'reason', 'refundAmount', 'orderUrl', 'storeName'],
    body: {
      fr:
        h1('Commande annulée') +
        p(
          'La commande ' +
            mono('orderNumber') +
            ' est annulée. Nous en sommes désolés. Si ' +
            'un paiement a été enregistré, il vous est remboursé sous 5 à 10 jours ouvrés.',
        ) +
        cta('orderUrl', 'Voir la commande', 'fr'),
      en:
        h1('Order cancelled') +
        p(
          'Order ' +
            mono('orderNumber') +
            ' has been cancelled. We are sorry about that. ' +
            'If a payment was recorded, it is refunded within 5 to 10 business days.',
        ) +
        cta('orderUrl', 'View order', 'en'),
      ar:
        h1('تم إلغاء الطلب') +
        p(
          'تم إلغاء الطلب ' +
            mono('orderNumber') +
            '. نأسف لذلك. إذا تم تسجيل دفعة، فسيُرد إليك المبلغ خلال 5 إلى 10 أيام عمل.',
        ) +
        cta('orderUrl', 'عرض الطلب', 'ar'),
    },
  },

  'order.confirmed': {
    subject: {
      fr: 'Commande {{orderNumber}} confirmée · {{storeName}}',
      en: 'Order {{orderNumber}} confirmed · {{storeName}}',
      ar: 'تم تأكيد الطلب {{orderNumber}} · {{storeName}}',
    },
    variables: ['orderNumber', 'customerName', 'total', 'orderUrl', 'storeName'],
    body: {
      fr:
        h1('Commande confirmée') +
        p(
          'Votre commande ' +
            mono('orderNumber') +
            ' est confirmée. La facture est ' +
            `disponible dans votre compte, pour un total de <strong>{{total}}</strong> ${TTC.fr}. ` +
            "Vous recevrez un message dès l'expédition.",
        ) +
        cta('orderUrl', 'Voir la commande et la facture', 'fr'),
      en:
        h1('Order confirmed') +
        p(
          'Your order ' +
            mono('orderNumber') +
            ' is confirmed. The invoice is available ' +
            `in your account, for a total of <strong>{{total}}</strong> ${TTC.en}. We will write ` +
            'again when it ships.',
        ) +
        cta('orderUrl', 'View order and invoice', 'en'),
      ar:
        h1('تم تأكيد الطلب') +
        p(
          'تم تأكيد طلبك ' +
            mono('orderNumber') +
            `. الفاتورة متاحة في حسابك، بإجمالي <strong>{{total}}</strong> ${TTC.ar}. ` +
            'سنراسلك عند الشحن.',
        ) +
        cta('orderUrl', 'عرض الطلب والفاتورة', 'ar'),
    },
  },

  'order.exchange-created': {
    subject: {
      fr: "Commande d'échange {{orderNumber}} créée · {{storeName}}",
      en: 'Exchange order {{orderNumber}} created · {{storeName}}',
      ar: 'تم إنشاء طلب الاستبدال {{orderNumber}} · {{storeName}}',
    },
    variables: ['orderNumber', 'returnNumber', 'total', 'orderUrl', 'storeName'],
    body: {
      fr:
        h1("Commande d'échange créée") +
        p(
          "La commande d'échange " +
            mono('orderNumber') +
            ' a été créée pour votre ' +
            `retour, pour un total de <strong>{{total}}</strong> ${TTC.fr}. Elle est en préparation, ` +
            "vous recevrez un message dès l'expédition.",
        ) +
        cta('orderUrl', "Voir la commande d'échange", 'fr'),
      en:
        h1('Exchange order created') +
        p(
          'Exchange order ' +
            mono('orderNumber') +
            ' was created for your return, for a ' +
            `total of <strong>{{total}}</strong> ${TTC.en}. It is being prepared, and we will write ` +
            'again when it ships.',
        ) +
        cta('orderUrl', 'View exchange order', 'en'),
      ar:
        h1('تم إنشاء طلب الاستبدال') +
        p(
          'تم إنشاء طلب الاستبدال ' +
            mono('orderNumber') +
            ` لإرجاعك، بإجمالي <strong>{{total}}</strong> ${TTC.ar}. يجري تجهيزه، وسنراسلك عند الشحن.`,
        ) +
        cta('orderUrl', 'عرض طلب الاستبدال', 'ar'),
    },
  },

  'giftcard.purchase': {
    subject: {
      fr: 'Votre carte cadeau · {{storeName}}',
      en: 'Your gift card · {{storeName}}',
      ar: 'بطاقة الهدية الخاصة بك · {{storeName}}',
    },
    variables: [
      'code',
      'initialBalance',
      'recipientName',
      'purchaserName',
      'personalMessage',
      'redemptionUrl',
      'storeName',
    ],
    body: {
      fr:
        h1('Votre carte cadeau') +
        p(
          `Une carte cadeau {{storeName}} de <strong>{{initialBalance}}</strong> ${TTC.fr} vous a ` +
            "été adressée. Le code ci-dessous s'utilise au moment du paiement, en une ou " +
            "plusieurs commandes, jusqu'à épuisement du solde.",
        ) +
        codeLabel('Code de la carte cadeau') +
        codeBox('code') +
        cta('redemptionUrl', 'Utiliser la carte', 'fr'),
      en:
        h1('Your gift card') +
        p(
          `A {{storeName}} gift card for <strong>{{initialBalance}}</strong> ${TTC.en} has been ` +
            'sent to you. The code below applies at payment, across one or several orders, ' +
            'until the balance runs out.',
        ) +
        codeLabel('Gift card code') +
        codeBox('code') +
        cta('redemptionUrl', 'Use the card', 'en'),
      ar:
        h1('بطاقة الهدية الخاصة بك') +
        p(
          `أُرسلت إليك بطاقة هدية من {{storeName}} بقيمة <strong>{{initialBalance}}</strong> ${TTC.ar}. ` +
            'يُستخدم الرمز أدناه عند الدفع، في طلب واحد أو عدة طلبات، حتى نفاد الرصيد.',
        ) +
        codeLabel('رمز بطاقة الهدية') +
        codeBox('code') +
        cta('redemptionUrl', 'استخدام البطاقة', 'ar'),
    },
  },

  'giftcard.redeemed': {
    subject: {
      fr: 'Carte cadeau utilisée · {{storeName}}',
      en: 'Gift card used · {{storeName}}',
      ar: 'تم استخدام بطاقة الهدية · {{storeName}}',
    },
    variables: [
      'code',
      'amountRedeemed',
      'remainingBalance',
      'orderNumber',
      'orderUrl',
      'storeName',
    ],
    body: {
      fr:
        h1('Carte cadeau utilisée') +
        p(
          `<strong>{{amountRedeemed}}</strong> ${TTC.fr} ont été déduits de la carte cadeau ` +
            mono('code') +
            '. Solde restant&nbsp;: ' +
            `<strong>{{remainingBalance}}</strong> ${TTC.fr}.`,
        ) +
        cta('orderUrl', 'Voir la commande', 'fr'),
      en:
        h1('Gift card used') +
        p(
          `<strong>{{amountRedeemed}}</strong> ${TTC.en} was taken from gift card ` +
            mono('code') +
            '. Remaining balance: ' +
            `<strong>{{remainingBalance}}</strong> ${TTC.en}.`,
        ) +
        cta('orderUrl', 'View order', 'en'),
      ar:
        h1('تم استخدام بطاقة الهدية') +
        p(
          `تم خصم <strong>{{amountRedeemed}}</strong> ${TTC.ar} من بطاقة الهدية ` +
            mono('code') +
            '. الرصيد المتبقي: ' +
            `<strong>{{remainingBalance}}</strong> ${TTC.ar}.`,
        ) +
        cta('orderUrl', 'عرض الطلب', 'ar'),
    },
  },

  'giftcard.store-credit': {
    subject: {
      fr: 'Avoir crédité sur votre compte · {{storeName}}',
      en: 'Store credit added to your account · {{storeName}}',
      ar: 'تمت إضافة رصيد إلى حسابك · {{storeName}}',
    },
    variables: ['code', 'balance', 'redemptionUrl', 'storeName'],
    body: {
      fr:
        h1('Avoir crédité') +
        p(
          `Un avoir de <strong>{{balance}}</strong> ${TTC.fr} est crédité sur votre compte. ` +
            "Le code ci-dessous s'utilise au moment du paiement, en une ou plusieurs " +
            "commandes, jusqu'à épuisement du solde.",
        ) +
        codeLabel("Code de l'avoir") +
        codeBox('code') +
        cta('redemptionUrl', 'Voir le catalogue', 'fr'),
      en:
        h1('Store credit added') +
        p(
          `Store credit of <strong>{{balance}}</strong> ${TTC.en} is on your account. The code ` +
            'below applies at payment, across one or several orders, until the balance runs ' +
            'out.',
        ) +
        codeLabel('Store credit code') +
        codeBox('code') +
        cta('redemptionUrl', 'View the catalogue', 'en'),
      ar:
        h1('تمت إضافة رصيد') +
        p(
          `تمت إضافة رصيد بقيمة <strong>{{balance}}</strong> ${TTC.ar} إلى حسابك. يُستخدم الرمز ` +
            'أدناه عند الدفع، في طلب واحد أو عدة طلبات، حتى نفاد الرصيد.',
        ) +
        codeLabel('رمز الرصيد') +
        codeBox('code') +
        cta('redemptionUrl', 'عرض الكتالوج', 'ar'),
    },
  },

  'return.requested': {
    subject: {
      fr: 'Demande de retour {{returnNumber}} enregistrée · {{storeName}}',
      en: 'Return request {{returnNumber}} logged · {{storeName}}',
      ar: 'تم تسجيل طلب الإرجاع {{returnNumber}} · {{storeName}}',
    },
    variables: ['returnNumber', 'orderNumber', 'customerName', 'returnUrl', 'storeName'],
    body: {
      fr:
        h1('Demande de retour enregistrée') +
        p(
          'Nous avons enregistré votre demande de retour ' +
            mono('returnNumber') +
            ' pour la commande ' +
            mono('orderNumber') +
            '. Elle passe en examen. Vous recevrez par e-mail ' +
            'notre décision et, si le retour est accepté, la marche à suivre pour le renvoi.',
        ) +
        cta('returnUrl', 'Voir le retour', 'fr'),
      en:
        h1('Return request logged') +
        p(
          'We have logged your return request ' +
            mono('returnNumber') +
            ' for order ' +
            mono('orderNumber') +
            '. It is now under review. We will email you ' +
            'the decision and, if the return is accepted, the instructions for sending the items ' +
            'back.',
        ) +
        cta('returnUrl', 'View return', 'en'),
      ar:
        h1('تم تسجيل طلب الإرجاع') +
        p(
          'سجلنا طلب الإرجاع ' +
            mono('returnNumber') +
            ' للطلب ' +
            mono('orderNumber') +
            '. وهو الآن قيد المراجعة. سنراسلك بقرارنا، وإذا قُبل الإرجاع، بخطوات إعادة المنتجات.',
        ) +
        cta('returnUrl', 'عرض الإرجاع', 'ar'),
    },
  },

  'return.approved': {
    subject: {
      fr: 'Retour {{returnNumber}} accepté · {{storeName}}',
      en: 'Return {{returnNumber}} approved · {{storeName}}',
      ar: 'تمت الموافقة على الإرجاع {{returnNumber}} · {{storeName}}',
    },
    variables: ['returnNumber', 'orderNumber', 'returnUrl', 'storeName'],
    body: {
      fr:
        h1('Retour accepté') +
        p(
          'Le retour ' +
            mono('returnNumber') +
            ' de la commande ' +
            mono('orderNumber') +
            ' est accepté. Renvoyez les articles dans leur ' +
            "emballage d'origine, en suivant les instructions affichées sur la page du retour. " +
            'À réception, nous contrôlons les articles, puis nous lançons le remboursement.',
        ) +
        cta('returnUrl', 'Voir le retour', 'fr'),
      en:
        h1('Return approved') +
        p(
          'Return ' +
            mono('returnNumber') +
            ' from order ' +
            mono('orderNumber') +
            ' is approved. Send the items back in their ' +
            'original packaging, following the instructions shown on the return page. Once they ' +
            'reach us we inspect them, then we start the refund.',
        ) +
        cta('returnUrl', 'View return', 'en'),
      ar:
        h1('تمت الموافقة على الإرجاع') +
        p(
          'تمت الموافقة على الإرجاع ' +
            mono('returnNumber') +
            ' للطلب ' +
            mono('orderNumber') +
            '. أعد المنتجات في عبوتها الأصلية باتباع التعليمات المعروضة في صفحة الإرجاع. ' +
            'عند الاستلام نفحص المنتجات، ثم نبدأ الاسترداد.',
        ) +
        cta('returnUrl', 'عرض الإرجاع', 'ar'),
    },
  },

  'return.rejected': {
    subject: {
      fr: 'Retour {{returnNumber}} refusé · {{storeName}}',
      en: 'Return {{returnNumber}} not approved · {{storeName}}',
      ar: 'لم تتم الموافقة على الإرجاع {{returnNumber}} · {{storeName}}',
    },
    variables: ['returnNumber', 'orderNumber', 'reason', 'returnUrl', 'storeName'],
    body: {
      fr:
        h1('Retour refusé') +
        p(
          'Nous ne pouvons pas accepter le retour ' +
            mono('returnNumber') +
            ' de la commande ' +
            mono('orderNumber') +
            '. Nous en sommes désolés. Les articles ' +
            'restent en votre possession. Pour toute question sur cette décision, contactez ' +
            'notre service client.',
        ) +
        cta('returnUrl', 'Voir le retour', 'fr'),
      en:
        h1('Return not approved') +
        p(
          'We cannot accept return ' +
            mono('returnNumber') +
            ' from order ' +
            mono('orderNumber') +
            '. We are sorry about that. The items stay with ' +
            'you. For any question about this decision, contact our customer service team.',
        ) +
        cta('returnUrl', 'View return', 'en'),
      ar:
        h1('لم تتم الموافقة على الإرجاع') +
        p(
          'لا يمكننا قبول الإرجاع ' +
            mono('returnNumber') +
            ' للطلب ' +
            mono('orderNumber') +
            '. نأسف لذلك. تبقى المنتجات لديك. لأي سؤال حول هذا القرار، تواصل مع خدمة العملاء.',
        ) +
        cta('returnUrl', 'عرض الإرجاع', 'ar'),
    },
  },

  'return.received': {
    subject: {
      fr: 'Retour {{returnNumber}} reçu · {{storeName}}',
      en: 'Return {{returnNumber}} received · {{storeName}}',
      ar: 'تم استلام الإرجاع {{returnNumber}} · {{storeName}}',
    },
    variables: ['returnNumber', 'returnUrl', 'storeName'],
    body: {
      fr:
        h1('Retour reçu') +
        p(
          'Les articles du retour ' +
            mono('returnNumber') +
            ' sont arrivés dans ' +
            'notre entrepôt et passent au contrôle. Le remboursement est lancé dès le contrôle ' +
            'terminé, et vous en recevez la confirmation par e-mail, montant compris.',
        ) +
        cta('returnUrl', 'Voir le retour', 'fr'),
      en:
        h1('Return received') +
        p(
          'The items from return ' +
            mono('returnNumber') +
            ' have reached our ' +
            'warehouse and are being inspected. The refund starts as soon as the inspection is ' +
            'done, and you get the confirmation by email, amount included.',
        ) +
        cta('returnUrl', 'View return', 'en'),
      ar:
        h1('تم استلام الإرجاع') +
        p(
          'وصلت منتجات الإرجاع ' +
            mono('returnNumber') +
            ' إلى مستودعنا وهي قيد الفحص. يبدأ الاسترداد فور انتهاء الفحص، وستصلك رسالة ' +
            'تأكيد بالبريد الإلكتروني تتضمن المبلغ.',
        ) +
        cta('returnUrl', 'عرض الإرجاع', 'ar'),
    },
  },

  'return.refunded': {
    subject: {
      fr: 'Remboursement du retour {{returnNumber}} · {{storeName}}',
      en: 'Refund for return {{returnNumber}} · {{storeName}}',
      ar: 'استرداد الإرجاع {{returnNumber}} · {{storeName}}',
    },
    variables: ['returnNumber', 'refundAmount', 'refundDetail', 'returnUrl', 'storeName'],
    body: {
      fr:
        h1('Remboursement du retour') +
        p(
          'Le montant remboursé pour le retour ' +
            mono('returnNumber') +
            ' est ' +
            `de <strong>{{refundAmount}} ${HT.fr}</strong>. {{refundDetail}}`,
        ) +
        cta('returnUrl', 'Voir le retour', 'fr'),
      en:
        h1('Refund for your return') +
        p(
          'The amount refunded for return ' +
            mono('returnNumber') +
            ' is ' +
            `<strong>{{refundAmount}} ${HT.en}</strong>. {{refundDetail}}`,
        ) +
        cta('returnUrl', 'View return', 'en'),
      ar:
        h1('استرداد الإرجاع') +
        p(
          'المبلغ المسترد للإرجاع ' +
            mono('returnNumber') +
            ' هو ' +
            `<strong>{{refundAmount}} ${HT.ar}</strong>. {{refundDetail}}`,
        ) +
        cta('returnUrl', 'عرض الإرجاع', 'ar'),
    },
  },

  'question.answered': {
    subject: {
      fr: 'Réponse à votre question · {{storeName}}',
      en: 'Your question has an answer · {{storeName}}',
      ar: 'رد على سؤالك · {{storeName}}',
    },
    variables: ['productName', 'productUrl', 'storeName'],
    body: {
      fr:
        h1('Réponse à votre question') +
        p(
          'Votre question sur <strong>{{productName}}</strong> a reçu une réponse. Elle est ' +
            'publiée sur la fiche produit.',
        ) +
        cta('productUrl', 'Lire la réponse', 'fr'),
      en:
        h1('Your question has an answer') +
        p(
          'Your question about <strong>{{productName}}</strong> has been answered. The answer ' +
            'is published on the product page.',
        ) +
        cta('productUrl', 'Read the answer', 'en'),
      ar:
        h1('رد على سؤالك') +
        p('تلقى سؤالك عن <strong>{{productName}}</strong> رداً. وهو منشور في صفحة المنتج.') +
        cta('productUrl', 'قراءة الرد', 'ar'),
    },
  },

  'review.approved': {
    subject: {
      fr: 'Votre avis est publié · {{storeName}}',
      en: 'Your review is published · {{storeName}}',
      ar: 'تم نشر تقييمك · {{storeName}}',
    },
    variables: ['productName', 'productUrl', 'storeName'],
    body: {
      fr:
        h1('Avis publié') +
        p(
          'Votre avis sur <strong>{{productName}}</strong> est en ligne sur la fiche produit. ' +
            'Merci du temps que vous y avez consacré&nbsp;: il servira aux autres clients qui ' +
            'évaluent le même produit.',
        ) +
        cta('productUrl', 'Voir la fiche produit', 'fr'),
      en:
        h1('Review published') +
        p(
          'Your review of <strong>{{productName}}</strong> is live on the product page. Thank ' +
            'you for the time you gave it. It will serve other customers weighing up the same ' +
            'product.',
        ) +
        cta('productUrl', 'View product page', 'en'),
      ar:
        h1('تم نشر التقييم') +
        p(
          'تقييمك لـ <strong>{{productName}}</strong> منشور الآن في صفحة المنتج. شكراً على ' +
            'الوقت الذي خصصته له: سيفيد العملاء الآخرين الذين يقيّمون المنتج نفسه.',
        ) +
        cta('productUrl', 'عرض صفحة المنتج', 'ar'),
    },
  },

  'cart.abandoned': {
    subject: {
      fr: 'Votre panier est enregistré · {{storeName}}',
      en: 'Your cart is saved · {{storeName}}',
      ar: 'سلتك محفوظة · {{storeName}}',
    },
    variables: ['itemCount', 'subtotal', 'cartUrl', 'storeName'],
    body: {
      fr:
        h1('Votre panier est enregistré') +
        p(
          'Votre panier contient {{itemCount}} article(s), pour un sous-total de ' +
            `<strong>{{subtotal}}</strong> ${HT.fr}. Il reste enregistré sur votre compte, vous ` +
            'pouvez reprendre la commande quand vous le souhaitez.',
        ) +
        cta('cartUrl', 'Reprendre le panier', 'fr'),
      en:
        h1('Your cart is saved') +
        p(
          'Your cart holds {{itemCount}} item(s), for a subtotal of ' +
            `<strong>{{subtotal}}</strong> ${HT.en}. It stays saved on your account, so you can pick ` +
            'the order back up whenever you want.',
        ) +
        cta('cartUrl', 'Open the cart', 'en'),
      ar:
        h1('سلتك محفوظة') +
        p(
          'تحتوي سلتك على {{itemCount}} منتج، بمجموع فرعي ' +
            `<strong>{{subtotal}}</strong> ${HT.ar}. تبقى محفوظة في حسابك، ويمكنك استئناف الطلب ` +
            'متى شئت.',
        ) +
        cta('cartUrl', 'فتح السلة', 'ar'),
    },
  },

  'admin.staff-invite': {
    subject: {
      fr: "Votre accès à l'administration · {{storeName}}",
      en: 'Your admin access · {{storeName}}',
      ar: 'صلاحية الوصول إلى لوحة الإدارة · {{storeName}}',
    },
    variables: ['actionUrl', 'inviterName', 'role', 'storeName'],
    body: {
      fr:
        h1("Votre compte d'administration est créé") +
        p(
          "Un compte d'administration {{storeName}} a été créé pour vous. Connectez-vous avec " +
            'le mot de passe qui vous a été transmis, ou réinitialisez-le depuis la page de ' +
            'connexion.',
        ) +
        cta('actionUrl', 'Se connecter', 'fr'),
      en:
        h1('You have an admin account') +
        p(
          'A {{storeName}} admin account has been created for you. Sign in with the password ' +
            'you were given, or reset it from the sign-in page.',
        ) +
        cta('actionUrl', 'Sign in', 'en'),
      ar:
        h1('تم إنشاء حساب الإدارة الخاص بك') +
        p(
          'تم إنشاء حساب إدارة لك في {{storeName}}. سجّل الدخول بكلمة المرور التي تلقيتها، ' +
            'أو أعد تعيينها من صفحة تسجيل الدخول.',
        ) +
        cta('actionUrl', 'تسجيل الدخول', 'ar'),
    },
  },

  'contact-form': {
    subject: {
      fr: '[Contact] {{subjectLine}}',
      en: '[Contact] {{subjectLine}}',
      ar: '[Contact] {{subjectLine}}',
    },
    variables: ['fromName', 'fromEmail', 'subjectLine', 'message', 'submittedAt'],
    body: {
      fr:
        '<h1 style="font-size:22px;margin:0 0 16px;">Nouveau message du formulaire de contact</h1>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">' +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;width:120px;">Expéditeur</td><td style="padding:6px 0;">{{fromName}} &lt;{{fromEmail}}&gt;</td></tr>` +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;">Objet</td><td style="padding:6px 0;">{{subjectLine}}</td></tr>` +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;">Reçu le</td><td style="padding:6px 0;">{{submittedAt}}</td></tr>` +
        '</table>' +
        `<div style="margin-top:20px;padding:16px 18px;background:${BRAND.paper};border:1px solid ${BRAND.border};">` +
        `<div style="color:${BRAND.muted};font-size:12px;margin-bottom:8px;">Message</div>` +
        '<div style="white-space:pre-wrap;">{{message}}</div></div>',
      en:
        '<h1 style="font-size:22px;margin:0 0 16px;">New contact form submission</h1>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">' +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;width:120px;">From</td><td style="padding:6px 0;">{{fromName}} &lt;{{fromEmail}}&gt;</td></tr>` +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;">Subject</td><td style="padding:6px 0;">{{subjectLine}}</td></tr>` +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;">Received</td><td style="padding:6px 0;">{{submittedAt}}</td></tr>` +
        '</table>' +
        `<div style="margin-top:20px;padding:16px 18px;background:${BRAND.paper};border:1px solid ${BRAND.border};">` +
        `<div style="color:${BRAND.muted};font-size:12px;margin-bottom:8px;">Message</div>` +
        '<div style="white-space:pre-wrap;">{{message}}</div></div>',
      ar:
        '<h1 style="font-size:22px;margin:0 0 16px;">رسالة جديدة من نموذج التواصل</h1>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">' +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;width:120px;">المرسل</td><td style="padding:6px 0;">{{fromName}} &lt;{{fromEmail}}&gt;</td></tr>` +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;">الموضوع</td><td style="padding:6px 0;">{{subjectLine}}</td></tr>` +
        `<tr><td style="color:${BRAND.muted};padding:6px 0;">تاريخ الاستلام</td><td style="padding:6px 0;">{{submittedAt}}</td></tr>` +
        '</table>' +
        `<div style="margin-top:20px;padding:16px 18px;background:${BRAND.paper};border:1px solid ${BRAND.border};">` +
        `<div style="color:${BRAND.muted};font-size:12px;margin-bottom:8px;">الرسالة</div>` +
        '<div style="white-space:pre-wrap;">{{message}}</div></div>',
    },
  },

  // ── NE8: staff digests + scheduled lifecycle flows ──────────────────────────

  'product.back-in-stock': {
    subject: {
      fr: '{{productName}} est de nouveau disponible · {{storeName}}',
      en: '{{productName}} is available again · {{storeName}}',
      ar: '{{productName}} متوفر من جديد · {{storeName}}',
    },
    variables: ['productName', 'productUrl', 'storeName'],
    body: {
      fr:
        h1('De nouveau disponible') +
        p(
          '<strong>{{productName}}</strong> est de nouveau disponible. Vous aviez demandé à ' +
            'être prévenu de son retour en stock. La fiche produit indique la quantité ' +
            "disponible aujourd'hui.",
        ) +
        cta('productUrl', 'Voir la fiche produit', 'fr'),
      en:
        h1('Available again') +
        p(
          '<strong>{{productName}}</strong> is in stock again. You asked to be told when it ' +
            'came back. The product page shows the quantity available today.',
        ) +
        cta('productUrl', 'View product page', 'en'),
      ar:
        h1('متوفر من جديد') +
        p(
          '<strong>{{productName}}</strong> متوفر من جديد. كنت قد طلبت تنبيهاً عند إعادة ' +
            'توفره. تعرض صفحة المنتج الكمية المتاحة اليوم.',
        ) +
        cta('productUrl', 'عرض صفحة المنتج', 'ar'),
    },
  },

  'review.request': {
    subject: {
      fr: 'Votre avis sur la commande {{orderNumber}} · {{storeName}}',
      en: 'Your review of order {{orderNumber}} · {{storeName}}',
      ar: 'تقييمك للطلب {{orderNumber}} · {{storeName}}',
    },
    variables: ['orderNumber', 'reviewUrl', 'storeName'],
    body: {
      fr:
        h1('Votre avis') +
        p(
          'La commande ' +
            mono('orderNumber') +
            ' vous a été livrée. Si vous avez déjà utilisé les produits, votre avis servira ' +
            "aux autres clients qui évaluent les mêmes références. Il n'y a ni contrepartie ni " +
            'délai, et ce message ne sera pas relancé.',
        ) +
        cta('reviewUrl', 'Rédiger un avis', 'fr'),
      en:
        h1('Your review') +
        p(
          'Order ' +
            mono('orderNumber') +
            ' has been delivered. If you have already put the products to use, your review ' +
            'will serve other customers weighing up the same references. There is no reward ' +
            'and no deadline, and this message will not be sent again.',
        ) +
        cta('reviewUrl', 'Write a review', 'en'),
      ar:
        h1('تقييمك') +
        p(
          'تم تسليم الطلب ' +
            mono('orderNumber') +
            '. إذا كنت قد استخدمت المنتجات، فسيفيد تقييمك العملاء الآخرين الذين يقيّمون ' +
            'المنتجات نفسها. لا مقابل ولا مهلة، ولن تُرسل هذه الرسالة مرة أخرى.',
        ) +
        cta('reviewUrl', 'كتابة تقييم', 'ar'),
    },
  },

  'giftcard.expiry-reminder': {
    subject: {
      fr: 'Votre carte cadeau expire le {{expiresOn}} · {{storeName}}',
      en: 'Your gift card expires on {{expiresOn}} · {{storeName}}',
      ar: 'تنتهي بطاقة الهدية في {{expiresOn}} · {{storeName}}',
    },
    variables: ['code', 'balance', 'expiresOn', 'redemptionUrl', 'storeName'],
    body: {
      fr:
        h1('Solde de votre carte cadeau') +
        p(
          `Il reste <strong>{{balance}}</strong> ${TTC.fr} sur votre carte cadeau {{storeName}}. ` +
            'Elle expire le <strong>{{expiresOn}}</strong>, et le solde non utilisé est perdu à ' +
            'cette date.',
        ) +
        codeLabel('Code de la carte cadeau') +
        codeBox('code') +
        cta('redemptionUrl', 'Utiliser le solde', 'fr'),
      en:
        h1('Your gift card balance') +
        p(
          `<strong>{{balance}}</strong> ${TTC.en} is left on your {{storeName}} gift card. It ` +
            'expires on <strong>{{expiresOn}}</strong>, and any balance left on that date is ' +
            'lost.',
        ) +
        codeLabel('Gift card code') +
        codeBox('code') +
        cta('redemptionUrl', 'Use the balance', 'en'),
      ar:
        h1('رصيد بطاقة الهدية') +
        p(
          `يتبقى <strong>{{balance}}</strong> ${TTC.ar} في بطاقة الهدية الخاصة بك من {{storeName}}. ` +
            'تنتهي صلاحيتها في <strong>{{expiresOn}}</strong>، ويُفقد الرصيد غير المستخدم في ' +
            'ذلك التاريخ.',
        ) +
        codeLabel('رمز بطاقة الهدية') +
        codeBox('code') +
        cta('redemptionUrl', 'استخدام الرصيد', 'ar'),
    },
  },

  'auth.2fa-otp': {
    subject: {
      fr: 'Code de vérification · {{storeName}}',
      en: 'Your verification code · {{storeName}}',
      ar: 'رمز التحقق · {{storeName}}',
    },
    variables: ['otp', 'storeName'],
    body: {
      fr:
        h1('Votre code de vérification') +
        p(
          'Utilisez le code ci-dessous pour terminer votre connexion. Il ne fonctionne ' +
            "qu'une seule fois et expire au bout de quelques minutes. Ne le communiquez à " +
            'personne. Personne chez {{storeName}} ne vous le demandera.',
        ) +
        codeBox('otp'),
      en:
        h1('Your verification code') +
        p(
          'Use the code below to finish signing in. It works once only and expires after a ' +
            'few minutes. Do not share it with anyone. Nobody at {{storeName}} will ever ask ' +
            'you for it.',
        ) +
        codeBox('otp'),
      ar:
        h1('رمز التحقق الخاص بك') +
        p(
          'استخدم الرمز أدناه لإكمال تسجيل الدخول. يعمل مرة واحدة فقط وتنتهي صلاحيته بعد ' +
            'بضع دقائق. لا تشاركه مع أحد. لن يطلبه منك أي شخص في {{storeName}}.',
        ) +
        codeBox('otp'),
    },
  },

  'auth.2fa-enabled': {
    subject: {
      fr: 'Double authentification activée · {{storeName}}',
      en: 'Two-factor authentication enabled · {{storeName}}',
      ar: 'تم تفعيل المصادقة الثنائية · {{storeName}}',
    },
    variables: ['securityUrl', 'storeName'],
    body: {
      fr:
        h1('La double authentification est active') +
        p(
          "La double authentification vient d'être activée sur votre compte {{storeName}}. " +
            'À la prochaine connexion, un code de vérification vous sera demandé en plus de ' +
            "votre mot de passe. Si vous êtes à l'origine de ce changement, vous n'avez rien à " +
            'faire. Sinon, ouvrez la sécurité du compte et changez votre mot de passe.',
        ) +
        cta('securityUrl', 'Ouvrir la sécurité du compte', 'fr'),
      en:
        h1('Two-factor authentication is on') +
        p(
          'Two-factor authentication was just enabled on your {{storeName}} account. At your ' +
            'next sign-in you will be asked for a verification code as well as your password. ' +
            'If you made this change, nothing further is needed. If you did not, open your ' +
            'account security and change your password.',
        ) +
        cta('securityUrl', 'Review account security', 'en'),
      ar:
        h1('المصادقة الثنائية مفعلة') +
        p(
          'تم تفعيل المصادقة الثنائية للتو على حسابك في {{storeName}}. عند تسجيل الدخول ' +
            'القادم سيُطلب منك رمز تحقق إضافة إلى كلمة المرور. إذا كنت أنت من قام بهذا ' +
            'التغيير، فلا حاجة لأي إجراء. وإلا، افتح إعدادات أمان الحساب وغيّر كلمة المرور.',
        ) +
        cta('securityUrl', 'فتح أمان الحساب', 'ar'),
    },
  },

  'auth.2fa-disabled': {
    subject: {
      fr: 'Double authentification désactivée · {{storeName}}',
      en: 'Two-factor authentication disabled · {{storeName}}',
      ar: 'تم تعطيل المصادقة الثنائية · {{storeName}}',
    },
    variables: ['securityUrl', 'storeName'],
    body: {
      fr:
        h1('La double authentification est désactivée') +
        p(
          "La double authentification vient d'être désactivée sur votre compte " +
            "{{storeName}}. Votre mot de passe protège désormais seul l'accès au compte. Si " +
            "vous n'êtes pas à l'origine de ce changement, réactivez-la depuis la sécurité du " +
            'compte et changez votre mot de passe.',
        ) +
        cta('securityUrl', 'Ouvrir la sécurité du compte', 'fr'),
      en:
        h1('Two-factor authentication is off') +
        p(
          'Two-factor authentication was just disabled on your {{storeName}} account. Your ' +
            'password alone now protects access to it. If you did not make this change, turn it ' +
            'back on from your account security and change your password.',
        ) +
        cta('securityUrl', 'Review account security', 'en'),
      ar:
        h1('المصادقة الثنائية معطلة') +
        p(
          'تم تعطيل المصادقة الثنائية للتو على حسابك في {{storeName}}. أصبحت كلمة المرور ' +
            'وحدها تحمي الوصول إلى الحساب الآن. إذا لم تقم بهذا التغيير، فأعد تفعيلها من ' +
            'إعدادات أمان الحساب وغيّر كلمة المرور.',
        ) +
        cta('securityUrl', 'فتح أمان الحساب', 'ar'),
    },
  },

  'admin.ops-digest': {
    subject: {
      fr: 'Récapitulatif des opérations du jour · {{storeName}}',
      en: 'Daily operations digest · {{storeName}}',
      ar: 'ملخص العمليات اليومي · {{storeName}}',
    },
    variables: [
      'lowStockCount',
      'outOfStockCount',
      'newReturnsCount',
      'pendingReviewsCount',
      'adminUrl',
      'storeName',
    ],
    body: {
      fr:
        h1('Récapitulatif des opérations du jour') +
        p("Ce qui demande une action dans la boutique aujourd'hui.") +
        metricsTable(
          metricRow('Stock bas', '<strong>{{lowStockCount}}</strong>') +
            metricRow('Rupture de stock', '<strong>{{outOfStockCount}}</strong>') +
            metricRow('Nouveaux retours (24 h)', '<strong>{{newReturnsCount}}</strong>') +
            metricRow('Avis en attente de modération', '<strong>{{pendingReviewsCount}}</strong>'),
        ) +
        cta('adminUrl', 'Ouvrir le tableau de bord', 'fr'),
      en:
        h1('Daily operations digest') +
        p('What needs action in the store today.') +
        metricsTable(
          metricRow('Low stock', '<strong>{{lowStockCount}}</strong>') +
            metricRow('Out of stock', '<strong>{{outOfStockCount}}</strong>') +
            metricRow('New returns (24h)', '<strong>{{newReturnsCount}}</strong>') +
            metricRow('Reviews awaiting moderation', '<strong>{{pendingReviewsCount}}</strong>'),
        ) +
        cta('adminUrl', 'Open dashboard', 'en'),
      ar:
        h1('ملخص العمليات اليومي') +
        p('ما يحتاج إلى إجراء في المتجر اليوم.') +
        metricsTable(
          metricRow('مخزون منخفض', '<strong>{{lowStockCount}}</strong>') +
            metricRow('نفاد المخزون', '<strong>{{outOfStockCount}}</strong>') +
            metricRow('إرجاعات جديدة (24 ساعة)', '<strong>{{newReturnsCount}}</strong>') +
            metricRow('تقييمات بانتظار المراجعة', '<strong>{{pendingReviewsCount}}</strong>'),
        ) +
        cta('adminUrl', 'فتح لوحة التحكم', 'ar'),
    },
  },

  'admin.kpi-digest': {
    subject: {
      fr: 'Performance de la semaine · {{storeName}}',
      en: 'Weekly performance digest · {{storeName}}',
      ar: 'أداء الأسبوع · {{storeName}}',
    },
    variables: ['periodLabel', 'revenue', 'orders', 'aov', 'newCustomers', 'adminUrl', 'storeName'],
    body: {
      fr:
        h1('Performance de la semaine') +
        p('Chiffres sur <strong>{{periodLabel}}</strong>.') +
        metricsTable(
          metricRow("Chiffre d'affaires", `<strong>{{revenue}}</strong> ${TTC.fr}`) +
            metricRow('Commandes', '<strong>{{orders}}</strong>') +
            metricRow('Panier moyen', `<strong>{{aov}}</strong> ${TTC.fr}`) +
            metricRow('Nouveaux clients', '<strong>{{newCustomers}}</strong>'),
        ) +
        cta('adminUrl', 'Ouvrir les statistiques', 'fr'),
      en:
        h1('Weekly performance digest') +
        p('Figures for <strong>{{periodLabel}}</strong>.') +
        metricsTable(
          metricRow('Revenue', `<strong>{{revenue}}</strong> ${TTC.en}`) +
            metricRow('Orders', '<strong>{{orders}}</strong>') +
            metricRow('Average order value', `<strong>{{aov}}</strong> ${TTC.en}`) +
            metricRow('New customers', '<strong>{{newCustomers}}</strong>'),
        ) +
        cta('adminUrl', 'Open analytics', 'en'),
      ar:
        h1('أداء الأسبوع') +
        p('الأرقام عن <strong>{{periodLabel}}</strong>.') +
        metricsTable(
          metricRow('الإيرادات', `<strong>{{revenue}}</strong> ${TTC.ar}`) +
            metricRow('الطلبات', '<strong>{{orders}}</strong>') +
            metricRow('متوسط قيمة الطلب', `<strong>{{aov}}</strong> ${TTC.ar}`) +
            metricRow('عملاء جدد', '<strong>{{newCustomers}}</strong>'),
        ) +
        cta('adminUrl', 'فتح الإحصاءات', 'ar'),
    },
  },

  // ── NE9: marketing / broadcast plane ─────────────────────────────────────
  'newsletter.confirm': {
    subject: {
      fr: 'Confirmez votre abonnement · {{storeName}}',
      en: 'Confirm your subscription · {{storeName}}',
      ar: 'تأكيد اشتراكك · {{storeName}}',
    },
    variables: ['confirmUrl', 'storeName'],
    body: {
      fr:
        h1('Confirmez votre abonnement') +
        p(
          'Vous avez demandé à recevoir les nouveautés du catalogue {{storeName}}. Le bouton ' +
            'ci-dessous confirme votre adresse. Sans cette confirmation, aucun message ne vous ' +
            "sera envoyé. Si vous n'êtes pas à l'origine de cette demande, aucune action n'est " +
            'nécessaire.',
        ) +
        cta('confirmUrl', 'Confirmer mon abonnement', 'fr') +
        linkFallback(FR_LINK_FALLBACK, 'confirmUrl'),
      en:
        h1('Confirm your subscription') +
        p(
          'You asked to receive news of the {{storeName}} catalogue. The button below confirms ' +
            'your address. Without that confirmation, nothing is sent to you. If you did not ' +
            'make this request, no action is needed.',
        ) +
        cta('confirmUrl', 'Confirm my subscription', 'en') +
        linkFallback(EN_LINK_FALLBACK, 'confirmUrl'),
      ar:
        h1('تأكيد اشتراكك') +
        p(
          'طلبت استقبال جديد كتالوج {{storeName}}. الزر أدناه يؤكد عنوانك. دون هذا التأكيد ' +
            'لن تُرسل إليك أي رسالة. إذا لم تطلب ذلك، فلا حاجة لأي إجراء.',
        ) +
        cta('confirmUrl', 'تأكيد اشتراكي', 'ar') +
        linkFallback(AR_LINK_FALLBACK, 'confirmUrl'),
    },
  },
};
