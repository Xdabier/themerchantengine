/**
 * Declarative event→template dispatch table (NE4).
 *
 * Adding a transactional email is now DATA: append one row (+ a resolver + a
 * template default) — no new listener class, no new plumbing. `MailDispatchListener`
 * binds exactly one EventEmitter2 listener per row; the shared dispatch() does
 * recipient/locale resolution, stable dedup-key derivation, enqueue, and the
 * enqueue-failed audit row.
 *
 * Event strings come from the domain modules' OWN constants so a rename can
 * never silently unbind a flow.
 */
import { ORDER_EVENTS } from '../../orders/orders.constants';
import { GIFT_CARD_EVENTS } from '../../gift-cards/gift-cards.constants';
import { RETURN_EVENTS } from '../../returns/returns.constants';
import { REVIEW_EVENTS, QUESTION_EVENTS } from '../../reviews/reviews.constants';
import { CART_EVENTS } from '../../cart/cart.constants';
import { USER_EVENTS } from '../../users/users.constants';
import { dispatchEntry, type DispatchEntry } from './dispatch.types';
import {
  resolveOrder,
  resolveGiftcardPurchase,
  resolveGiftcardRedeemed,
  resolveStoreCredit,
  resolveReturn,
  resolveReturnRejected,
  resolveReturnRefunded,
  resolveQuestionAnswered,
  resolveReviewApproved,
  resolveCartAbandoned,
  resolveStaffInvite,
  resolvePasswordChanged,
} from './resolvers';

export const DISPATCH_TABLE: DispatchEntry[] = [
  dispatchEntry(ORDER_EVENTS.CREATED, 'order.placed', resolveOrder),
  dispatchEntry(ORDER_EVENTS.SHIPPED, 'order.shipped', resolveOrder),
  dispatchEntry(ORDER_EVENTS.DELIVERED, 'order.delivered', resolveOrder),
  dispatchEntry(ORDER_EVENTS.CANCELLED, 'order.cancelled', resolveOrder),
  // order.confirmed already fires (only webhooks consumed it before NE5); the
  // exchange-order event carries `orderId` of the EXC- order, so both reuse
  // resolveOrder unchanged.
  dispatchEntry(ORDER_EVENTS.CONFIRMED, 'order.confirmed', resolveOrder),
  dispatchEntry(RETURN_EVENTS.EXCHANGE_CREATED, 'order.exchange-created', resolveOrder),
  dispatchEntry(GIFT_CARD_EVENTS.PURCHASED, 'giftcard.purchase', resolveGiftcardPurchase),
  dispatchEntry(GIFT_CARD_EVENTS.REDEEMED, 'giftcard.redeemed', resolveGiftcardRedeemed),
  dispatchEntry(GIFT_CARD_EVENTS.STORE_CREDIT_ISSUED, 'giftcard.store-credit', resolveStoreCredit),
  dispatchEntry(RETURN_EVENTS.CREATED, 'return.requested', resolveReturn),
  dispatchEntry(RETURN_EVENTS.APPROVED, 'return.approved', resolveReturn),
  dispatchEntry(RETURN_EVENTS.REJECTED, 'return.rejected', resolveReturnRejected),
  dispatchEntry(RETURN_EVENTS.RECEIVED, 'return.received', resolveReturn),
  dispatchEntry(RETURN_EVENTS.REFUNDED, 'return.refunded', resolveReturnRefunded),
  dispatchEntry(QUESTION_EVENTS.ANSWERED, 'question.answered', resolveQuestionAnswered),
  dispatchEntry(REVIEW_EVENTS.APPROVED, 'review.approved', resolveReviewApproved),
  dispatchEntry(CART_EVENTS.ABANDONED, 'cart.abandoned', resolveCartAbandoned),
  dispatchEntry(USER_EVENTS.STAFF_INVITED, 'admin.staff-invite', resolveStaffInvite),
  dispatchEntry(USER_EVENTS.PASSWORD_CHANGED, 'auth.password-changed', resolvePasswordChanged),
];
