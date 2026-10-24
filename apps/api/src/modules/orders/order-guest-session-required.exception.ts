import { BadRequestException } from '@nestjs/common';

/**
 * An anonymous order arrived with no cart session cookie.
 *
 * Two things depend on it and neither has a sensible fallback. The cart being
 * bought lives under that session, so there is nothing to buy without it. And
 * the idempotency key binds to it: falling back to a shared sentinel would give
 * every cookieless guest the same caller hash, which is precisely the collision
 * the binding exists to prevent.
 *
 * In practice unreachable from a browser, because the cookie is minted on the
 * first add-to-cart. Explicit anyway, so the guarantee does not rest on that.
 */
export class OrderGuestSessionRequiredException extends BadRequestException {
  static readonly CODE = 'ORDER_GUEST_SESSION_REQUIRED' as const;

  constructor() {
    super({
      error: {
        code: OrderGuestSessionRequiredException.CODE,
        message: 'A cart session is required to check out as a guest',
      },
    });
  }
}
