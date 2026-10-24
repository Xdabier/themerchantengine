import { translatableSchema } from '@admin-types';
import * as z from 'zod';

/**
 * Schemas for `/v1/admin/analytics/*`. Every endpoint response shape is parsed
 * at the client boundary so page components consume typed data instead of
 * `unknown`. Shapes mirror `apps/api/src/modules/analytics/analytics.service.ts`.
 */

export const analyticsDateQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsDateQuery = z.infer<typeof analyticsDateQuerySchema>;

/** Dashboard payload snapshot — minimum shape we assert. */
export const dashboardSummarySchema = z.object({
  today: z.object({
    orders: z.number().int().nonnegative(),
    revenue: z.number().nonnegative(),
    uniqueSessions: z.number().int().nonnegative(),
    conversionRate: z.number().nonnegative(),
  }),
  thisWeek: z.object({
    orders: z.number().int().nonnegative(),
    revenue: z.number().nonnegative(),
    uniqueSessions: z.number().int().nonnegative(),
    conversionRate: z.number().nonnegative(),
  }),
  thisMonth: z.object({
    orders: z.number().int().nonnegative(),
    revenue: z.number().nonnegative(),
    uniqueSessions: z.number().int().nonnegative(),
    conversionRate: z.number().nonnegative(),
  }),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const pixelConfigSchema = z.object({
  googleAnalyticsId: z.string().nullable().optional(),
  metaPixelId: z.string().nullable().optional(),
  tiktokPixelId: z.string().nullable().optional(),
  snapPixelId: z.string().nullable().optional(),
});
export type PixelConfig = z.infer<typeof pixelConfigSchema>;

/** Bucketed time series — see apps/api/src/modules/analytics/analytics.service.ts#getTimeseries. */
export const timeseriesMetricSchema = z.enum(['orders', 'revenue', 'sessions']);
export type TimeseriesMetric = z.infer<typeof timeseriesMetricSchema>;

export const timeseriesGranularitySchema = z.enum(['hour', 'day', 'week']);
export type TimeseriesGranularity = z.infer<typeof timeseriesGranularitySchema>;

export const timeseriesQuerySchema = z.object({
  metric: timeseriesMetricSchema,
  granularity: timeseriesGranularitySchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type TimeseriesQuery = z.infer<typeof timeseriesQuerySchema>;

export const timeseriesResponseSchema = z.object({
  metric: timeseriesMetricSchema,
  granularity: timeseriesGranularitySchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
  buckets: z.array(
    z.object({
      bucket: z.string().datetime(),
      value: z.number().nonnegative(),
    }),
  ),
});
export type TimeseriesResponse = z.infer<typeof timeseriesResponseSchema>;

/** Funnel step from `analytics.service.ts#getFunnel`. */
export const funnelStepSchema = z.object({
  step: z.string(),
  count: z.number().int().nonnegative(),
  dropOffRate: z.number(),
  overallConversionRate: z.number(),
});
export type FunnelStep = z.infer<typeof funnelStepSchema>;
export const funnelResponseSchema = z.array(funnelStepSchema);
export type FunnelResponse = z.infer<typeof funnelResponseSchema>;

/** Product row from `analytics.service.ts#getProductAnalytics`. Name is Translatable. */
export const productAnalyticsRowSchema = z.object({
  productId: z.string(),
  name: translatableSchema,
  slug: z.string(),
  views: z.number().int().nonnegative(),
  carts: z.number().int().nonnegative(),
  purchases: z.number().int().nonnegative(),
  viewToCartRate: z.number(),
  conversionRate: z.number(),
  revenue: z.number(),
});
export type ProductAnalyticsRow = z.infer<typeof productAnalyticsRowSchema>;
export const productAnalyticsResponseSchema = z.array(productAnalyticsRowSchema);
export type ProductAnalyticsResponse = z.infer<typeof productAnalyticsResponseSchema>;

/** Revenue metrics from `analytics.service.ts#getRevenueAnalytics`. */
export const revenueAnalyticsResponseSchema = z.object({
  grossRevenue: z.number(),
  netRevenue: z.number(),
  totalDiscounts: z.number(),
  totalRefunds: z.number(),
  orderCount: z.number().int().nonnegative(),
  aov: z.number(),
  uniqueSessions: z.number().int().nonnegative(),
  revenuePerVisitor: z.number(),
});
export type RevenueAnalyticsResponse = z.infer<typeof revenueAnalyticsResponseSchema>;

/** Customer metrics from `analytics.service.ts#getCustomerAnalytics`. */
export const customerAnalyticsResponseSchema = z.object({
  totalCustomers: z.number().int().nonnegative(),
  newCustomers: z.number().int().nonnegative(),
  returningCustomers: z.number().int().nonnegative(),
  retentionRate: z.number(),
  avgCustomerRevenue: z.number(),
});
export type CustomerAnalyticsResponse = z.infer<typeof customerAnalyticsResponseSchema>;

/** Search metrics from `analytics.service.ts#getSearchAnalytics`. */
export const searchAnalyticsTopQuerySchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
});
export type SearchAnalyticsTopQuery = z.infer<typeof searchAnalyticsTopQuerySchema>;
export const searchAnalyticsResponseSchema = z.object({
  totalSearches: z.number().int().nonnegative(),
  topQueries: z.array(searchAnalyticsTopQuerySchema),
});
export type SearchAnalyticsResponse = z.infer<typeof searchAnalyticsResponseSchema>;

export const updatePixelsRequestSchema = z.object({
  googleAnalyticsId: z
    .string()
    .max(50)
    .regex(/^[A-Za-z0-9-]*$/)
    .optional(),
  metaPixelId: z
    .string()
    .max(50)
    .regex(/^[0-9]*$/)
    .optional(),
  tiktokPixelId: z
    .string()
    .max(50)
    .regex(/^[A-Za-z0-9]*$/)
    .optional(),
  snapPixelId: z
    .string()
    .max(50)
    .regex(/^[A-Za-z0-9-]*$/)
    .optional(),
});
export type UpdatePixelsRequest = z.infer<typeof updatePixelsRequestSchema>;
