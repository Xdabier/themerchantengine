/**
 * Customer notification-preference DTOs (NE7).
 *
 * Mirrors the storefront Zod schema in `libs/storefront-types`. Every channel
 * flag is optional so a PATCH carries only what changed. `whitelist:true` +
 * `forbidNonWhitelisted` (global pipe) reject unknown categories/channels;
 * nested objects need explicit `@ValidateNested` + `@Type` to be checked rather
 * than passed through (the NE6 index-signature whitelist lesson).
 */
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';

export class ChannelConsentDto {
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelConsentDto)
  LIFECYCLE?: ChannelConsentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelConsentDto)
  MARKETING?: ChannelConsentDto;
}
