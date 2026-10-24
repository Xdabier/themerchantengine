import { ConflictException } from '@nestjs/common';
import type { PaymentStatus } from '@prisma/client';

/** A payment action that the current payment status does not allow. */
export class PaymentTransitionNotAllowedException extends ConflictException {
  static readonly CODE = 'PAYMENT_TRANSITION_NOT_ALLOWED' as const;

  constructor(providerId: string, from: PaymentStatus, action: string) {
    super({
      error: {
        code: PaymentTransitionNotAllowedException.CODE,
        message: 'This payment action is not allowed in the current payment status',
        details: { providerId, from, action },
      },
    });
  }
}
