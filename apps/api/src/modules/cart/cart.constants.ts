/** BullMQ queue name for abandoned-cart detection jobs. */
export const CART_ABANDONED_QUEUE = 'cart-abandoned';

/** Job name emitted by the repeatable scheduler. */
export const CART_ABANDONED_JOB = 'scan-abandoned';

/** Anonymous cart expiry: 30 days of inactivity. */
export const ANON_CART_EXPIRY_DAYS = 30;

/** A cart with items untouched for this long is considered abandoned. */
export const ABANDONED_THRESHOLD_MS = 60 * 60 * 1_000; // 1 hour

/** Cookie name used to identify anonymous carts. Matches the storefront-api-reference.md §Cart contract. */
export const SESSION_COOKIE_NAME = 'sessionId';

/** Cross-sell stub — SearchModule not yet implemented (spec §9.8 SC1). */
export const CROSS_SELL_STUB: string[] = [];

/**
 * Cart domain events. The mail dispatch table binds `cart.abandoned` to the
 * (marketing-class) recovery email; the resolver skips anonymous carts (NE5).
 */
export const CART_EVENTS = {
  ABANDONED: 'cart.abandoned',
  /**
   * An anonymous cart was folded into a signed-in customer's cart.
   *
   * Announced rather than acted on here because the interesting consequence
   * lives in another module: any order the guest placed in that same session is
   * keyed by the cookie the merge is about to throw away, and has to be moved
   * onto the account first. Cart cannot call orders directly (orders imports
   * cart), so the seam is an event.
   */
  MERGED: 'cart.merged',
} as const;
