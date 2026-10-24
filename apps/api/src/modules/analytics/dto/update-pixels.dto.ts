import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Pixel IDs use different vendor formats; we allow the empty string to
 * clear a configured pixel, and reject any character outside safe
 * alphanumeric / separator sets to prevent injection.
 */
export class UpdatePixelsAdminDto {
  /** Google Analytics 4 measurement ID (e.g. G-XXXXXXXX) or UA property. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9\-]*$/)
  googleAnalyticsId?: string;

  /** Meta (Facebook) pixel ID — numeric string. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[0-9]*$/)
  metaPixelId?: string;

  /** TikTok pixel ID — alphanumeric. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9]*$/)
  tiktokPixelId?: string;

  /** Snap pixel ID — alphanumeric + dashes. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9\-]*$/)
  snapPixelId?: string;
}
