import { BadRequestException } from '@nestjs/common';

/**
 * An anonymous order arrived with no contact address.
 *
 * The field is optional on `CreateOrderDto` because an account order must not
 * carry it, so the requirement cannot live on the DTO and is enforced on the
 * guest branch instead. It is not a nicety: without it the order has no
 * confirmation-mail recipient and no answer to the public track page's email
 * challenge, which are the only two ways a guest ever hears about their order
 * again.
 */
export class OrderGuestEmailRequiredException extends BadRequestException {
  static readonly CODE = 'ORDER_GUEST_EMAIL_REQUIRED' as const;

  constructor() {
    super({
      error: {
        code: OrderGuestEmailRequiredException.CODE,
        message: 'A contact email is required to check out as a guest',
      },
    });
  }
}
