import { NotFoundException } from '@nestjs/common';

export class StaffNotFoundException extends NotFoundException {
  static readonly CODE = 'STAFF_NOT_FOUND' as const;

  constructor(message = 'Staff user not found') {
    super({ error: { code: StaffNotFoundException.CODE, message } });
  }
}
