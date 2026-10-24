import { IsEnum, IsISO8601, IsOptional } from 'class-validator';

/**
 * Metrics the admin dashboard sparklines / charts can chart across a date
 * window. `orders` / `revenue` source from the `Order` table; `sessions`
 * sources from the `AnalyticsEvent` table via distinct `sessionId`.
 */
export const TIMESERIES_METRICS = ['orders', 'revenue', 'sessions'] as const;
export type TimeseriesMetric = (typeof TIMESERIES_METRICS)[number];

export const TIMESERIES_GRANULARITIES = ['hour', 'day', 'week'] as const;
export type TimeseriesGranularity = (typeof TIMESERIES_GRANULARITIES)[number];

export class TimeseriesQueryDto {
  @IsEnum(TIMESERIES_METRICS)
  metric!: TimeseriesMetric;

  @IsOptional()
  @IsEnum(TIMESERIES_GRANULARITIES)
  granularity?: TimeseriesGranularity;

  /** Inclusive window start (default: 30 days before `to`). */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Inclusive window end (default: now). */
  @IsOptional()
  @IsISO8601()
  to?: string;
}
