/**
 * Dispatch-table resolvers (NE4).
 *
 * Each resolver is a stateless `(payload, ctx) → DispatchResolution | null`
 * function that replicates — byte-for-byte — the lookup + variable-build of the
 * listener it replaces. `null` = skip (no recipient / null purchaser), matching
 * the listeners' early returns. Recipient data is read via `ctx.prisma` (the
 * mail module's injected PrismaService) — never another module's internals
 * (constitution §3.1).
 */
import type { MailLocale } from '../mail.types';
import { copyEntry } from '../templates/layout';
import type { DispatchContext, DispatchResolution } from './dispatch.types';
import { resolveLocale } from '../listeners/locale.util';
import { storeMoney } from '@common/money';
import { pickLocale } from '../templates/render';
import {
  buildOrderUrl,
  buildRedemptionUrl,
  buildReturnUrl,
  buildProductUrl,
  buildCartRecoveryUrl,
  buildAdminLoginUrl,
} from './url.util';

/**
 * Currency for the abandoned-cart email, which is the one dispatch path with
 * no row to read a currency from: it fires against a cart, and `Cart` carries
 * no currency column. The store currency from the runtime config (DR-31).
 */
function abandonedCartCurrency(): string {
  return storeMoney.currencyCode();
}

/**
 * Resolve a Translatable name to the recipient locale. Delegates the chain to
 * `pickLocale` so the mail tree has one fallback order rather than a copy per
 * file, which is the cluster `plan.md` §7 records.
 */
function pickName(name: unknown, locale: MailLocale): string {
  if (name && typeof name === 'object') {
    return pickLocale(name as Record<string, string | undefined>, locale);
  }
  return typeof name === 'string' ? name : '';
}

/** order.created/shipped/delivered/cancelled — payload emitted by orders.service. */
interface OrderEventPayload {
  orderId: string;
  orderNumber?: string;
  userId?: string;
  total?: number | string;
}

/** giftcard.purchased — payload emitted by gift-cards.service. */
interface PurchasedPayload {
  cardId: string;
  code: string;
  recipientEmail: string | null;
  recipientName: string | null;
  personalMessage: string | null;
  initialBalance: number;
  currency: string;
  /** Null for admin-issued / store-credit cards (NE5). */
  purchaserUserId: string | null;
  /** Admin "resend" re-emits PURCHASED with this set — bypasses dedup for a real resend (NE5). */
  forceResend?: boolean;
}

/** giftcard.store-credit-issued — admin granted store credit to an email (NE5). */
interface StoreCreditPayload {
  cardId: string;
  code: string;
  recipientEmail: string | null;
  balance: number;
  currency: string;
}

/** giftcard.redeemed — payload emitted by gift-cards.service. */
interface RedeemedPayload {
  cardId: string;
  code: string;
  amount: number;
  remainingBalance: number;
  currency: string;
  orderId: string;
}

/** Shared by all four order flows — the template differs, the resolution does not. */
export async function resolveOrder(
  payload: OrderEventPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const order = await ctx.prisma.order.findUnique({
    where: { id: payload.orderId },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      currency: true,
      user: { select: { email: true, firstName: true, locale: true } },
      // A guest order has no user row, so its contact address and the locale it
      // was placed in live on the order itself. Without these two columns this
      // resolver returns null for every guest order, and a null resolution
      // means the dispatcher sends nothing: the customer pays and never hears
      // back (plan F, finding K3).
      guestEmail: true,
      guestLocale: true,
      items: { select: { id: true } },
      shipments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { trackingNumber: true, carrier: true },
      },
    },
  });
  const recipient = order?.user?.email ?? order?.guestEmail ?? null;
  if (!order || !recipient) return null;

  const shipment = order.shipments[0];
  const locale = resolveLocale(order.user?.locale ?? order.guestLocale);
  return {
    to: recipient,
    locale,
    // The order is the logical entity; a re-fire of the same status event for
    // the same order dedupes (a two-parcel order's distinct shipped events can
    // collapse within the BullMQ retention window — accepted tradeoff, NE4
    // execution-note 4).
    dedupeId: order.id,
    variables: {
      orderNumber: order.orderNumber,
      // A guest gave us an address, not a name. Left undefined so the template
      // falls back to its neutral greeting rather than addressing nobody.
      customerName: order.user?.firstName ?? undefined,
      total: storeMoney.format(order.total, order.currency),
      itemCount: order.items.length,
      orderUrl: buildOrderUrl(ctx.config, locale, order.id),
      ...(shipment?.trackingNumber ? { trackingNumber: shipment.trackingNumber } : {}),
      ...(shipment?.carrier ? { carrier: shipment.carrier } : {}),
    },
  };
}

export async function resolveGiftcardPurchase(
  p: PurchasedPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  // Look up the purchaser only when one is recorded (admin-issued cards have
  // none). Used for the buyer's name + locale and the self-buy email fallback.
  const purchaser = p.purchaserUserId
    ? await ctx.prisma.user.findUnique({
        where: { id: p.purchaserUserId },
        select: { email: true, firstName: true, lastName: true, locale: true },
      })
    : null;

  // Self-buy: a customer buying for themselves leaves recipientEmail null — fall
  // back to the purchaser's own address so the code is not silently dropped (NE5).
  const to = p.recipientEmail ?? purchaser?.email ?? null;
  if (!to) return null;

  const purchaserName = purchaser
    ? [purchaser.firstName, purchaser.lastName].filter(Boolean).join(' ')
    : undefined;

  const locale = resolveLocale(purchaser?.locale);
  return {
    to,
    locale,
    // Admin "resend" bypasses dedup so a repeat genuinely re-sends; normal
    // purchases dedupe on the card (Risk R5).
    ...(p.forceResend ? {} : { dedupeId: p.cardId }),
    variables: {
      code: p.code,
      initialBalance: storeMoney.format(p.initialBalance, p.currency),
      ...(p.recipientName ? { recipientName: p.recipientName } : {}),
      ...(purchaserName ? { purchaserName } : {}),
      ...(p.personalMessage ? { personalMessage: p.personalMessage } : {}),
      redemptionUrl: buildRedemptionUrl(ctx.config, locale, p.code),
    },
  };
}

/** giftcard.store-credit-issued — admin grant; recipient is the granted email. */
export async function resolveStoreCredit(
  p: StoreCreditPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  if (!p.recipientEmail) return null;
  // The email may not belong to a registered user (admin can grant to anyone);
  // resolveLocale falls back to the store default when there is no row.
  const user = await ctx.prisma.user.findUnique({
    where: { email: p.recipientEmail },
    select: { locale: true },
  });
  const locale = resolveLocale(user?.locale);
  return {
    to: p.recipientEmail,
    locale,
    dedupeId: p.cardId,
    variables: {
      code: p.code,
      balance: storeMoney.format(p.balance, p.currency),
      redemptionUrl: buildRedemptionUrl(ctx.config, locale, p.code),
    },
  };
}

export async function resolveGiftcardRedeemed(
  p: RedeemedPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const card = await ctx.prisma.giftCard.findUnique({
    where: { id: p.cardId },
    select: { purchasedBy: true, recipientEmail: true },
  });
  if (!card) return null;

  // Receipt goes to the purchaser when there is one; for purchaser-less cards
  // (store credit / admin-issued) fall back to the card's recipient so the
  // redemption is not silently un-notified (NE5).
  const purchaser = card.purchasedBy
    ? await ctx.prisma.user.findUnique({
        where: { id: card.purchasedBy },
        select: { email: true, locale: true },
      })
    : null;
  const to = purchaser?.email ?? card.recipientEmail ?? null;
  if (!to) return null;

  const order = await ctx.prisma.order.findUnique({
    where: { id: p.orderId },
    select: { id: true, orderNumber: true },
  });

  const locale = resolveLocale(purchaser?.locale);
  return {
    to,
    locale,
    // A card is redeemed across multiple orders — key on (card, order) so each
    // per-order receipt is distinct, while a re-fire of the SAME redemption
    // dedupes (NE4 execution-note 4).
    dedupeId: `${p.cardId}:${p.orderId}`,
    variables: {
      code: p.code,
      amountRedeemed: storeMoney.format(p.amount, p.currency),
      remainingBalance: storeMoney.format(p.remainingBalance, p.currency),
      ...(order?.orderNumber ? { orderNumber: order.orderNumber } : {}),
      ...(order ? { orderUrl: buildOrderUrl(ctx.config, locale, order.id) } : {}),
    },
  };
}

// ── Returns (NE5) ─────────────────────────────────────────────────────────────

/**
 * Payload shapes emitted by `returns.service.ts` for the return lifecycle. The
 * recipient is NEVER in the payload — it is loaded via `ctx.prisma` (§3.1).
 */
interface ReturnEventPayload {
  returnId: string;
  returnNumber?: string;
  customerId?: string;
  reason?: string;
  refundMethod?: string;
  refundAmount?: number | string;
  currency?: string;
  /** Set only when a STORE_CREDIT refund minted a card — surfaced in the body. */
  storeCreditCode?: string;
}

/** Loads the return's customer (email/locale/name) + order number via ctx.prisma. */
async function loadReturn(returnId: string, ctx: DispatchContext) {
  return ctx.prisma.return.findUnique({
    where: { id: returnId },
    select: {
      returnNumber: true,
      customer: { select: { email: true, firstName: true, locale: true } },
      order: { select: { orderNumber: true } },
    },
  });
}

/** Shared by return.requested / return.approved / return.received. */
export async function resolveReturn(
  p: ReturnEventPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const ret = await loadReturn(p.returnId, ctx);
  if (!ret?.customer?.email) return null;
  const locale = resolveLocale(ret.customer.locale);
  return {
    to: ret.customer.email,
    locale,
    dedupeId: p.returnId,
    variables: {
      returnNumber: ret.returnNumber,
      orderNumber: ret.order?.orderNumber ?? '',
      customerName: ret.customer.firstName ?? undefined,
      returnUrl: buildReturnUrl(ctx.config, locale),
    },
  };
}

/** return.rejected — folds in the (optional) rejection reason. */
export async function resolveReturnRejected(
  p: ReturnEventPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const base = await resolveReturn(p, ctx);
  if (!base) return null;
  return {
    ...base,
    variables: { ...base.variables, ...(p.reason ? { reason: p.reason } : {}) },
  };
}

/** return.refunded — branches the detail sentence on refundMethod (plan §3b). */
export async function resolveReturnRefunded(
  p: ReturnEventPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const base = await resolveReturn(p, ctx);
  if (!base) return null;
  const currency = p.currency ?? storeMoney.currencyCode();
  const refundAmount = storeMoney.format(p.refundAmount ?? 0, currency);
  return {
    ...base,
    variables: {
      ...base.variables,
      refundAmount,
      refundDetail: refundDetailCopy(p.refundMethod, base.locale, p.storeCreditCode),
    },
  };
}

/**
 * Localized, refund-method-specific sentence. Lives in the resolver (not the
 * editable body) because the no-conditional interpolator cannot branch — the
 * surrounding copy stays operator-editable; this one clause is composed here.
 */
function refundDetailCopy(method: string | undefined, locale: MailLocale, code?: string): string {
  if (method === 'STORE_CREDIT') {
    const withCode: Record<string, string> = {
      fr: `Le montant a été porté en avoir sur votre compte. Votre code : ${code}`,
      en: `It was issued as store credit. Your code: ${code}`,
      ar: `تم إصدار المبلغ كرصيد في حسابك. رمزك: ${code}`,
    };
    const withoutCode: Record<string, string> = {
      fr: 'Le montant a été porté en avoir sur votre compte.',
      en: 'It was issued as store credit to your account.',
      ar: 'تم إصدار المبلغ كرصيد في حسابك.',
    };
    return code ? copyEntry(withCode, locale) : copyEntry(withoutCode, locale);
  }
  if (method === 'EXCHANGE') {
    const exchange: Record<string, string> = {
      fr: "Une commande d'échange a été créée. Nous vous en envoyons le détail.",
      en: 'An exchange order has been created. We will email its details shortly.',
      ar: 'تم إنشاء طلب استبدال. سنرسل إليك تفاصيله.',
    };
    return copyEntry(exchange, locale);
  }
  const original: Record<string, string> = {
    fr: "Le remboursement est effectué sur le moyen de paiement d'origine.",
    en: 'It will be refunded to your original payment method.',
    ar: 'سيُرد المبلغ إلى وسيلة الدفع الأصلية.',
  };
  return copyEntry(original, locale);
}

// ── Reviews & Q&A (NE5) ───────────────────────────────────────────────────────

/** question.answered — payload carries the ANSWERER (Risk R6); the asker is loaded. */
interface QuestionAnsweredPayload {
  questionId: string;
  productId?: string;
  userId?: string;
}

/** review.approved — payload carries the review id; the author is loaded. */
interface ReviewApprovedPayload {
  reviewId: string;
  productId?: string;
}

/**
 * question.answered → notify the ASKER (Risk R6: the event payload carries the
 * answering staff member, never the asker). Skips anonymous questions
 * (askedById null) and questions whose asker has no email.
 */
export async function resolveQuestionAnswered(
  p: QuestionAnsweredPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const question = await ctx.prisma.productQuestion.findUnique({
    where: { id: p.questionId },
    select: {
      askedById: true,
      asker: { select: { email: true, locale: true } },
      product: { select: { slug: true, name: true } },
    },
  });
  if (!question?.askedById || !question.asker?.email) return null;

  const locale = resolveLocale(question.asker.locale);
  return {
    to: question.asker.email,
    locale,
    dedupeId: p.questionId,
    variables: {
      productName: pickName(question.product?.name, locale),
      productUrl: buildProductUrl(ctx.config, locale, question.product?.slug),
    },
  };
}

/** review.approved → notify the review author (loaded via Review.userId). */
export async function resolveReviewApproved(
  p: ReviewApprovedPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const review = await ctx.prisma.review.findUnique({
    where: { id: p.reviewId },
    select: {
      user: { select: { email: true, locale: true } },
      product: { select: { slug: true, name: true } },
    },
  });
  if (!review?.user?.email) return null;

  const locale = resolveLocale(review.user.locale);
  return {
    to: review.user.email,
    locale,
    dedupeId: p.reviewId,
    variables: {
      productName: pickName(review.product?.name, locale),
      productUrl: buildProductUrl(ctx.config, locale, review.product?.slug),
    },
  };
}

// ── Cart (NE5) ────────────────────────────────────────────────────────────────

/** cart.abandoned — emitted by the abandoned-cart processor every ~15 min. */
interface CartAbandonedPayload {
  cartId: string;
  userId: string | null;
  customerEmail: string | null;
  items: Array<{ quantity?: number }>;
  subtotal: number;
}

/**
 * cart.abandoned → recovery email. Skips anonymous carts (no email). Marketing-
 * class: the NE7 consent gate will require opt-in; in NE5 it sends ungated.
 */
export async function resolveCartAbandoned(
  p: CartAbandonedPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  if (!p.customerEmail) return null;

  const user = p.userId
    ? await ctx.prisma.user.findUnique({ where: { id: p.userId }, select: { locale: true } })
    : null;
  const itemCount = Array.isArray(p.items) ? p.items.reduce((n, i) => n + (i.quantity ?? 0), 0) : 0;

  const locale = resolveLocale(user?.locale);
  return {
    to: p.customerEmail,
    locale,
    dedupeId: p.cartId,
    variables: {
      itemCount,
      subtotal: storeMoney.format(p.subtotal ?? 0, abandonedCartCurrency()),
      cartUrl: buildCartRecoveryUrl(ctx.config, locale, p.cartId),
    },
  };
}

// ── Account & auth (NE5) ──────────────────────────────────────────────────────

/** users.staff-invited — emitted by users.service.createStaff. */
interface StaffInvitedPayload {
  userId: string;
}

/** users.password-changed — emitted by users.service.updateProfile. */
interface PasswordChangedPayload {
  userId: string;
}

/** staff-invite notice → the new staff member's admin login link (Decision 3). */
export async function resolveStaffInvite(
  p: StaffInvitedPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const user = await ctx.prisma.user.findUnique({
    where: { id: p.userId },
    select: { email: true, firstName: true, role: true, locale: true },
  });
  if (!user?.email) return null;

  return {
    to: user.email,
    locale: resolveLocale(user.locale),
    dedupeId: p.userId,
    variables: {
      actionUrl: buildAdminLoginUrl(ctx.config),
      ...(user.role ? { role: String(user.role) } : {}),
    },
  };
}

/**
 * password-changed security alert → the owner's address. Deliberately returns
 * NO dedupeId: every password change is a distinct must-deliver alert, so the
 * dispatch engine must not collapse two changes within the retention window.
 */
export async function resolvePasswordChanged(
  p: PasswordChangedPayload,
  ctx: DispatchContext,
): Promise<DispatchResolution | null> {
  const user = await ctx.prisma.user.findUnique({
    where: { id: p.userId },
    select: { email: true, locale: true },
  });
  if (!user?.email) return null;

  return {
    to: user.email,
    locale: resolveLocale(user.locale),
    variables: {},
  };
}
