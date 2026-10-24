import { BadRequestException } from '@nestjs/common';

/**
 * An adjustment named neither mode, or both.
 *
 * Enforced in the service rather than by `@ValidateIf` on the DTO:
 * class-validator whitelisting strips only properties carrying no validation
 * metadata, and the conditional metadata `@ValidateIf` registers counts as
 * metadata, so `forbidNonWhitelisted` never fires on a body sending both
 * `quantity` and `setTo`. The exclusivity has to be checked somewhere that
 * actually runs.
 */
export class InventoryAdjustModeException extends BadRequestException {
  static readonly CODE = 'INVENTORY_ADJUST_MODE' as const;

  constructor(message: string) {
    super({ error: { code: InventoryAdjustModeException.CODE, message } });
  }
}
