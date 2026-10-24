import { NotFoundException } from '@nestjs/common';

export class CustomerNotFoundException extends NotFoundException {
  static readonly CODE = 'CUSTOMER_NOT_FOUND' as const;

  constructor(message = 'Customer not found') {
    super({ error: { code: CustomerNotFoundException.CODE, message } });
  }
}
