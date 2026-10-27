import { IsString, Length, Matches } from 'class-validator';

export class ApplyGiftCardDto {
  /**
   * Gift-card redemption code. Matches the admin CreateGiftCardDto range
   * (8–20 uppercase alphanumeric) so any operator-issued code is applicable
   * by the customer. Whitespace and dashes are rejected so the surface
   * cannot accept human-readable variants.
   */
  @IsString()
  @Length(8, 20)
  @Matches(/^[A-Z0-9]+$/, {
    message: 'code must be 8–20 uppercase alphanumeric characters',
  })
  code: string;
}
