import { z } from 'zod';
import { entityIdSchema } from './ids';
import { paginationMetaSchema } from './envelope';
import { optionalDefaultTranslatableSchema } from './translatable';

/**
 * Admin campaigns module schemas (NE9 — marketing / broadcast plane). Parity
 * with the backend `campaigns` DTOs + Prisma models. Translatable subject/body
 * tolerate a missing `default` key (same {en,ar} body-only shape as NE3
 * templates) so a composer load never throws (the schema-drift bug class).
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export const campaignSegmentSchema = z.enum([
  'ALL_CONFIRMED',
  'NEW',
  'ACTIVE',
  'LOYAL',
  'AT_RISK',
  'CHURNED',
  'LAPSED',
]);
export type CampaignSegment = z.infer<typeof campaignSegmentSchema>;

export const campaignStatusSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'CANCELLED',
  'FAILED',
]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignKindSchema = z.enum(['BROADCAST', 'WINBACK']);
export type CampaignKind = z.infer<typeof campaignKindSchema>;

// ── Campaign ──────────────────────────────────────────────────────────────────

const dateLike = z.union([z.string().datetime(), z.date()]);

export const campaignSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  subject: optionalDefaultTranslatableSchema,
  body: optionalDefaultTranslatableSchema,
  segment: campaignSegmentSchema,
  couponCode: z.string().nullable().optional(),
  status: campaignStatusSchema,
  kind: campaignKindSchema,
  scheduledAt: dateLike.nullable().optional(),
  sentAt: dateLike.nullable().optional(),
  createdById: z.string().nullable().optional(),
  createdAt: dateLike.optional(),
  updatedAt: dateLike.optional(),
});
export type Campaign = z.infer<typeof campaignSchema>;

export const listCampaignsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  status: campaignStatusSchema.optional(),
  kind: campaignKindSchema.optional(),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

export const listCampaignsResponseSchema = z.object({
  data: z.array(campaignSchema),
  meta: paginationMetaSchema,
});
export type ListCampaignsResponse = z.infer<typeof listCampaignsResponseSchema>;

export const createCampaignRequestSchema = z.object({
  name: z.string().min(1).max(200),
  subject: optionalDefaultTranslatableSchema,
  body: optionalDefaultTranslatableSchema,
  segment: campaignSegmentSchema,
  couponCode: z.string().max(100).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

export const updateCampaignRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: optionalDefaultTranslatableSchema.optional(),
  body: optionalDefaultTranslatableSchema.optional(),
  segment: campaignSegmentSchema.optional(),
  couponCode: z.string().max(100).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type UpdateCampaignRequest = z.infer<typeof updateCampaignRequestSchema>;

export const campaignStatsSchema = z.record(z.string(), z.number());
export type CampaignStats = z.infer<typeof campaignStatsSchema>;

export const sendCampaignResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
});
export type SendCampaignResponse = z.infer<typeof sendCampaignResponseSchema>;

export const sendTestCampaignRequestSchema = z.object({
  /**
   * Open string rather than an enum. The locale set a campaign can render in
   * is the mail renderer's, not the store's, and the backend `@IsIn` guard on
   * `SendTestCampaignDto` is the real allowlist. Narrowing here would only
   * duplicate that list in a second place and go stale when D7 moves it.
   */
  locale: z.string().min(2).optional(),
});
export type SendTestCampaignRequest = z.infer<typeof sendTestCampaignRequestSchema>;

/** Live-preview a draft campaign (NE9). Omitted fields fall back to the saved row. */
export const previewCampaignRequestSchema = z.object({
  subject: optionalDefaultTranslatableSchema.optional(),
  body: optionalDefaultTranslatableSchema.optional(),
  sampleVariables: z.record(z.string(), z.string()).optional(),
});
export type PreviewCampaignRequest = z.infer<typeof previewCampaignRequestSchema>;

const previewLocaleSchema = z.object({ subject: z.string(), html: z.string(), text: z.string() });

/**
 * Keyed by whatever locales the mail renderer returns, not by a fixed pair.
 *
 * The renderer emits the store's own locales. It emitted a different pair
 * before the storefront migration, and this schema absorbed that move without an
 * edit; a fixed shape would have thrown on it instead. That throw is the
 * schema-drift bug class this repository has already shipped twice.
 */
export const previewCampaignResponseSchema = z.record(z.string(), previewLocaleSchema);
export type PreviewCampaignResponse = z.infer<typeof previewCampaignResponseSchema>;

export const sendTestCampaignResponseSchema = z.object({
  status: z.string(),
  recipient: z.string(),
});
export type SendTestCampaignResponse = z.infer<typeof sendTestCampaignResponseSchema>;

// ── Subscribers ─────────────────────────────────────────────────────────────

export const subscriberSchema = z.object({
  id: entityIdSchema,
  email: z.string(),
  userId: z.string().nullable().optional(),
  locale: z.string(),
  source: z.string(),
  confirmedAt: dateLike.nullable().optional(),
  unsubscribedAt: dateLike.nullable().optional(),
  createdAt: dateLike.optional(),
});
export type Subscriber = z.infer<typeof subscriberSchema>;

export const subscriberStatusSchema = z.enum(['confirmed', 'pending', 'unsubscribed']);
export type SubscriberStatus = z.infer<typeof subscriberStatusSchema>;

export const listSubscribersQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  status: subscriberStatusSchema.optional(),
  source: z.string().max(50).optional(),
  search: z.string().max(254).optional(),
});
export type ListSubscribersQuery = z.infer<typeof listSubscribersQuerySchema>;

export const listSubscribersResponseSchema = z.object({
  data: z.array(subscriberSchema),
  meta: paginationMetaSchema,
});
export type ListSubscribersResponse = z.infer<typeof listSubscribersResponseSchema>;

export const updateSubscriberRequestSchema = z.object({
  unsubscribed: z.boolean(),
});
export type UpdateSubscriberRequest = z.infer<typeof updateSubscriberRequestSchema>;
