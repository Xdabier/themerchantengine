import { IsISO8601, IsOptional } from 'class-validator';

/** Optional date range filter shared by admin analytics query endpoints. */
export class AnalyticsDateQueryDto {
  /** ISO 8601 start date/datetime (inclusive). */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** ISO 8601 end date/datetime (inclusive). */
  @IsOptional()
  @IsISO8601()
  to?: string;
}
