import { z } from 'zod';
import { entityIdSchema } from './ids';
import { paginationMetaSchema } from './envelope';
import { optionalDefaultTranslatableSchema, translatableSchema } from './translatable';

/**
 * Admin notifications module schemas — templates, send-log, in-app notification
 * feed, and the NE6 editor surfaces (preview + send-test).
 *
 * Relocated to `libs/admin-types/` per constitution §3.14 + DR-21's opportunistic
 * per-module revival path: NE6 re-touches this module (adds the preview +
 * send-test endpoints and the per-flow matrix), so the grandfathered schema
 * files at `libs/admin-services/src/notifications/*.schemas.ts` migrate here in
 * the same PR. Those files now re-export from this module so consumer imports
 * via `@admin-services` keep working.
 */

// ── Channels / statuses / categories ────────────────────────────────────────

export const templateChannelSchema = z.enum(['email', 'sms', 'push']);
export type TemplateChannel = z.infer<typeof templateChannelSchema>;

// Mirrors the backend NotificationLogStatus union (apps/api .../mail.constants.ts)
// and LOG_STATUSES (query-log.dto.ts). MUST list every status the pipeline can
// write — a missing value makes listLogResponseSchema.parse throw and the admin
// send-log page "Could not load". `skipped` was added in NE1; `enqueue-failed`
// in NE4; queued/complained/suppressed were already reachable and previously
// absent here.
export const logStatusSchema = z.enum([
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'suppressed',
  'skipped',
  'enqueue-failed',
]);
export type LogStatus = z.infer<typeof logStatusSchema>;

// Delivery class (NE1) — drives the NE7 consent gate. Mirrors NOTIFICATION_CATEGORIES.
export const notificationCategorySchema = z.enum(['TRANSACTIONAL', 'LIFECYCLE', 'MARKETING']);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

const codePattern = /^[a-z][a-z0-9_.]*$/;

// ── Notification templates ──────────────────────────────────────────────────

export const notificationTemplateSchema = z.object({
  id: entityIdSchema,
  code: z.string(),
  // Templates persist body-only blocks keyed by the store's locales, with no
  // `default` key (NE3). Tolerate the missing default so the matrix and the
  // editor never throw.
  subject: optionalDefaultTranslatableSchema.nullable().optional(),
  body: optionalDefaultTranslatableSchema,
  channel: templateChannelSchema,
  event: z.string(),
  variables: z.array(z.string()),
  isEnabled: z.boolean(),
  // NE1 fields — tolerate absence on older rows so the response parse never
  // throws, but surface them so NE6 can render the toggle + locked state.
  sendEnabled: z.boolean().optional(),
  category: notificationCategorySchema.optional(),
  isLocked: z.boolean().optional(),
  createdAt: z.union([z.string().datetime(), z.date()]).optional(),
  updatedAt: z.union([z.string().datetime(), z.date()]).optional(),
});
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

export const listTemplatesQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  channel: templateChannelSchema.optional(),
  event: z.string().optional(),
  isEnabled: z.boolean().optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

export const listTemplatesResponseSchema = z.object({
  data: z.array(notificationTemplateSchema),
  meta: paginationMetaSchema,
});
export type ListTemplatesResponse = z.infer<typeof listTemplatesResponseSchema>;

export const createTemplateRequestSchema = z.object({
  code: z.string().min(2).max(100).regex(codePattern),
  subject: optionalDefaultTranslatableSchema.optional(),
  body: optionalDefaultTranslatableSchema,
  channel: templateChannelSchema,
  event: z.string().regex(codePattern),
  variables: z.array(z.string()).max(50).optional(),
  isEnabled: z.boolean().optional(),
  sendEnabled: z.boolean().optional(),
  category: notificationCategorySchema.optional(),
});
export type CreateTemplateRequest = z.infer<typeof createTemplateRequestSchema>;

export const updateTemplateRequestSchema = z.object({
  subject: optionalDefaultTranslatableSchema.optional(),
  body: optionalDefaultTranslatableSchema.optional(),
  variables: z.array(z.string()).max(50).optional(),
  isEnabled: z.boolean().optional(),
  sendEnabled: z.boolean().optional(),
  category: notificationCategorySchema.optional(),
});
export type UpdateTemplateRequest = z.infer<typeof updateTemplateRequestSchema>;

// ── Send log ────────────────────────────────────────────────────────────────

export const notificationLogEntrySchema = z.object({
  id: entityIdSchema,
  templateId: entityIdSchema.nullable().optional(),
  templateCode: z.string(),
  channel: templateChannelSchema,
  recipient: z.string(),
  status: logStatusSchema,
  error: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  sentAt: z.union([z.string().datetime(), z.date()]),
});
export type NotificationLogEntry = z.infer<typeof notificationLogEntrySchema>;

export const listLogQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  channel: templateChannelSchema.optional(),
  status: logStatusSchema.optional(),
  templateCode: z.string().optional(),
  recipient: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListLogQuery = z.infer<typeof listLogQuerySchema>;

export const listLogResponseSchema = z.object({
  data: z.array(notificationLogEntrySchema),
  meta: paginationMetaSchema,
});
export type ListLogResponse = z.infer<typeof listLogResponseSchema>;

// NE2: the backend resend re-dispatches through the genuine enqueue pipeline
// and reports the real outcome, so `status` is the honest enqueue result — not
// the literal 'queued' the old stub always returned. `logId` points at the new
// send-log row. Keep both tolerant so an older/edge response never throws a
// parse error on the admin send-log page (the translatable-schema-drift class).
export const resendResponseSchema = z.object({
  status: z.enum(['queued', 'suppressed', 'skipped']),
  recipient: z.string(),
  logId: z.string().min(1).optional(),
});
export type ResendResponse = z.infer<typeof resendResponseSchema>;

// ── NE6: editor preview + test-send ─────────────────────────────────────────

/** Live-preview a DRAFT template; omitted fields fall back to the saved row. */
export const previewTemplateRequestSchema = z.object({
  subject: optionalDefaultTranslatableSchema.optional(),
  body: optionalDefaultTranslatableSchema.optional(),
  variables: z.array(z.string()).max(50).optional(),
  sampleVariables: z.record(z.string(), z.string()).optional(),
});
export type PreviewTemplateRequest = z.infer<typeof previewTemplateRequestSchema>;

/** One locale's rendered output — subject + full layout-wrapped html + text. */
export const previewLocaleResultSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});
export type PreviewLocaleResult = z.infer<typeof previewLocaleResultSchema>;

/**
 * Keyed by whatever locales the mail renderer returns, not by a fixed pair.
 * See the matching note on `previewCampaignResponseSchema`.
 */
export const previewTemplateResponseSchema = z.record(z.string(), previewLocaleResultSchema);
export type PreviewTemplateResponse = z.infer<typeof previewTemplateResponseSchema>;

/** Send a test of the template to the calling admin's own inbox. */
export const sendTestRequestSchema = z.object({
  /** Open string; the backend `@IsIn` guard on `SendTestTemplateDto` is the allowlist. */
  locale: z.string().min(2).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});
export type SendTestRequest = z.infer<typeof sendTestRequestSchema>;

export const sendTestResponseSchema = z.object({
  status: z.enum(['queued', 'suppressed', 'skipped']),
  recipient: z.string(),
  logId: z.string().min(1),
});
export type SendTestResponse = z.infer<typeof sendTestResponseSchema>;

// ── In-app admin notification feed ──────────────────────────────────────────

export const adminNotificationSchema = z.object({
  id: entityIdSchema,
  userId: entityIdSchema,
  type: z.string(),
  title: translatableSchema.optional(),
  body: translatableSchema.optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  isRead: z.boolean(),
  readAt: z.union([z.string().datetime(), z.date()]).nullable().optional(),
  createdAt: z.union([z.string().datetime(), z.date()]),
});
export type AdminNotification = z.infer<typeof adminNotificationSchema>;

export const listNotificationsQuerySchema = z.object({
  isRead: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const listNotificationsResponseSchema = z.object({
  data: z.array(adminNotificationSchema),
  meta: paginationMetaSchema,
});
export type ListNotificationsResponse = z.infer<typeof listNotificationsResponseSchema>;

export const unreadCountSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof unreadCountSchema>;

/** Resolve a Translatable title to a display string. Fallback chain: locale → default → 'Notification'. */
export function notificationTitleText(n: AdminNotification, locale?: string): string {
  const t = n.title;
  if (!t) return 'Notification';
  if (locale && typeof t[locale] === 'string' && t[locale]) return t[locale] as string;
  return t.default || 'Notification';
}

/** Resolve a Translatable body to a display string. Fallback chain: locale → default → ''. */
export function notificationBodyText(n: AdminNotification, locale?: string): string {
  const b = n.body;
  if (!b) return '';
  if (locale && typeof b[locale] === 'string' && b[locale]) return b[locale] as string;
  return b.default || '';
}
