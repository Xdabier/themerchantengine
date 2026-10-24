import { z } from 'zod';
import { STORE_CONFIG_LOCALES } from '@common/store-config-fixtures/store-config-fixture.schema';

/**
 * First-party analytics event, the request half of `POST /v1/analytics/events`.
 *
 * Mirrors `IngestEventDto` on the API. Validated on the way OUT, not on the way
 * in, which is unusual for this lib and deliberate: the endpoint answers 204
 * with no body, so a malformed emission would otherwise be invisible. Parsing
 * before the post turns a typo into a caught exception the tracker swallows,
 * rather than a silent gap in the operator's dashboards.
 */

/** Mirrors `ANALYTICS_EVENT_TYPES` in `apps/api/src/modules/analytics/analytics.constants.ts`. */
export const ANALYTICS_EVENT_TYPES = [
  'page_view',
  'product_view',
  'add_to_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
  'search',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const analyticsEventSchema = z.object({
  eventType: z.enum(ANALYTICS_EVENT_TYPES),
  /** Same character set the API's `@Matches` enforces, so a bad id fails here
   * rather than as an opaque 400 the tracker throws away. */
  sessionId: z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  userId: z.string().optional(),
  productId: z.string().optional(),
  orderId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  locale: z.enum(STORE_CONFIG_LOCALES).optional(),
});

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
