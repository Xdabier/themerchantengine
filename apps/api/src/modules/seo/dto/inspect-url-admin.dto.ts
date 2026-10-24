import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';
import { IsRegistryLocale } from '../../../common/dto/translatable-locale-keys.dto';
import type { SupportedLocale } from '../seo.constants';

/**
 * Admin query DTO for the per-product URL-Inspection readout (DR-17 D5). The caller
 * supplies the inspection target as EITHER an absolute `url` OR a `productId` (whose
 * public storefront URL is resolved server-side via the single-source helper so the
 * admin never needs the storefront base URL, §3.14). The "exactly one of url|
 * productId" cardinality is enforced in the service — an `@IsOptional` rule here
 * would skip the all-absent case (mirrors the D2 submit orchestrator). `locale`
 * narrows which locale variant of a `productId` is inspected; the allowlist is the
 * §3.5 guard, never interpolated. `whitelist: true` strips anything else.
 */
export class InspectUrlAdminDto {
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @IsRegistryLocale()
  locale?: SupportedLocale;
}
