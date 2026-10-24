import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Admin DTO — activate or deactivate a gift card.
 * Only isActive is mutable after creation (spec §4.12).
 */
export class UpdateGiftCardAdminDto {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
