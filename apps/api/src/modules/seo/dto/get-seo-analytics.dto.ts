import { IsIn, IsOptional, IsString } from 'class-validator';
import { SEO_ANALYTICS_RANGES, type SeoAnalyticsRange } from '../seo.constants';

/**
 * Admin query DTO for the GSC Search Analytics readout (DR-17 D4). The only input
 * is the lookback window, constrained to a fixed allowlist (§3.5 — the range is
 * never interpolated; it selects a pre-computed date span and a cache key). Absent
 * → the service applies the default 28-day window. `whitelist: true` strips
 * anything else.
 */
export class GetSeoAnalyticsAdminDto {
  @IsOptional()
  @IsString()
  @IsIn(SEO_ANALYTICS_RANGES)
  range?: SeoAnalyticsRange;
}
