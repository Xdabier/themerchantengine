import { NotFoundException } from '@nestjs/common';

export class RoleNotFoundException extends NotFoundException {
  static readonly CODE = 'ROLE_NOT_FOUND' as const;

  constructor(message = 'Role not found') {
    super({ error: { code: RoleNotFoundException.CODE, message } });
  }
}
