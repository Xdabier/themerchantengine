import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { CART_EVENTS } from '../cart/cart.constants';
import { OrdersService } from './orders.service';

interface CartMergedPayload {
  userId?: string;
  sessionId?: string;
}

/**
 * Claim a guest's orders when their anonymous cart is merged at sign-in.
 *
 * This lives in the orders module rather than in the cart merge itself because
 * orders already imports cart, so the reverse call would be a cycle. The event
 * is the seam.
 *
 * `CartService` emits it with `emitAsync` and awaits the result, so this runs
 * before the endpoint clears the `sessionId` cookie. That ordering is the whole
 * point: the cookie is the only key to a guest order, and clearing it first
 * would leave a window where the customer can reach their own order by neither
 * the cookie nor their account.
 */
@Injectable()
export class GuestOrderClaimListener {
  private readonly logger = new Logger(GuestOrderClaimListener.name);

  constructor(private readonly orders: OrdersService) {}

  @OnEvent(CART_EVENTS.MERGED, { async: true })
  async onCartMerged(payload: CartMergedPayload): Promise<void> {
    try {
      await this.orders.claimGuestOrders(payload.userId, payload.sessionId);
    } catch (err: unknown) {
      // A failed claim must not fail the sign-in the customer is in the middle
      // of. The order is still reachable by number and email through the public
      // track page, which is the fallback this degrades to.
      this.logger.error(
        `claiming guest orders failed for userId=${payload.userId}: ${String(err)}`,
      );
    }
  }
}
