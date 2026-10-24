import * as z from 'zod';
import { entityIdSchema, paginationMetaSchema } from '@admin-types';

/**
 * Event types mirror `apps/api/src/modules/webhooks/webhooks.constants.ts`.
 * Update this list when the backend catalog changes.
 */
export const webhookEventTypeSchema = z.enum([
  'order.created',
  'order.confirmed',
  'order.status_changed',
  'order.cancelled',
  'order.shipped',
  'order.delivered',
  'product.created',
  'product.updated',
  'product.deleted',
  'inventory.low_stock',
  'inventory.out_of_stock',
  'inventory.restocked',
  'customer.created',
  'customer.updated',
  'cart.abandoned',
  'return.requested',
  'return.approved',
  'return.refunded',
  'review.submitted',
  'payment.received',
  'payment.refunded',
]);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

/** HTTPS-only URL validator. Internal/SSRF protection lives on the server. */
const httpsUrlSchema = z
  .string()
  .url()
  .regex(/^https:\/\//i, 'URL must start with https://');

/**
 * Mirrors the `select` shape of `WebhooksService.listSubscriptions` /
 * `getSubscription` in `apps/api/src/modules/webhooks/webhooks.service.ts`
 * and the `WebhookSubscription` Prisma model. `secret` is omitted here
 * because list/get responses never include it; only `webhookWithSecretSchema`
 * (used by `create`) exposes it.
 */
export const webhookSchema = z.object({
  id: entityIdSchema,
  url: httpsUrlSchema,
  events: z.array(webhookEventTypeSchema),
  isActive: z.boolean(),
  failureCount: z.number().int().nonnegative(),
  lastDeliveredAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Webhook = z.infer<typeof webhookSchema>;

/** Create response contains the generated/echoed secret (one-time). */
export const webhookWithSecretSchema = webhookSchema.extend({
  secret: z.string().min(16),
});
export type WebhookWithSecret = z.infer<typeof webhookWithSecretSchema>;

export const listWebhooksQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type ListWebhooksQuery = z.infer<typeof listWebhooksQuerySchema>;

export const listWebhooksResponseSchema = z.object({
  data: z.array(webhookSchema),
  meta: paginationMetaSchema,
});
export type ListWebhooksResponse = z.infer<typeof listWebhooksResponseSchema>;

export const createWebhookRequestSchema = z.object({
  url: httpsUrlSchema,
  events: z.array(webhookEventTypeSchema).min(1),
  secret: z.string().min(16).max(128).optional(),
});
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;

export const updateWebhookRequestSchema = z.object({
  url: httpsUrlSchema.optional(),
  events: z.array(webhookEventTypeSchema).min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWebhookRequest = z.infer<typeof updateWebhookRequestSchema>;

/**
 * `POST /v1/admin/webhooks/:id/test` returns the queued delivery identifier;
 * the actual outbound HTTP call happens asynchronously in the BullMQ
 * `webhook-delivery` queue, so the synchronous response only confirms that a
 * `WebhookDelivery` row was created. Mirrors `WebhooksService.sendTestEvent`
 * at `apps/api/src/modules/webhooks/webhooks.service.ts:180`.
 */
export const webhookTestResultSchema = z.object({
  eventId: z.string(),
  deliveryId: entityIdSchema,
});
export type WebhookTestResult = z.infer<typeof webhookTestResultSchema>;

/**
 * Mirrors the raw Prisma `WebhookDelivery` row returned by
 * `WebhooksService.listDeliveries`. Field names match the Prisma columns at
 * `prisma/schema.prisma:1467-1488`. The UI derives a status badge from the
 * presence of `succeededAt`, `failedAt`, and `nextRetryAt` — there is no
 * `status` column on the row.
 */
export const webhookDeliverySchema = z.object({
  id: entityIdSchema,
  subscriptionId: entityIdSchema,
  eventType: webhookEventTypeSchema,
  eventId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  responseStatus: z.number().int().nullable().optional(),
  responseBody: z.string().nullable().optional(),
  attempt: z.number().int().nonnegative(),
  succeededAt: z.string().datetime().nullable().optional(),
  failedAt: z.string().datetime().nullable().optional(),
  nextRetryAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const listDeliveriesQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;

export const listDeliveriesResponseSchema = z.object({
  data: z.array(webhookDeliverySchema),
  meta: paginationMetaSchema,
});
export type ListDeliveriesResponse = z.infer<typeof listDeliveriesResponseSchema>;
