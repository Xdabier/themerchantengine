import { z } from 'zod';

/**
 * Storefront notification-preference schemas (NE7). Mirrors:
 * - `apps/api/src/modules/mail/dto/notification-preference.dto.ts`
 * - the `NotificationPreferenceService` response map.
 *
 * Consent is opt-in: every channel defaults false server-side and a missing
 * category row reads as all-off. Only the LIFECYCLE + MARKETING categories are
 * customer-editable; transactional mail is always sent and carries no row.
 * Route is class-level `@OwnerGuard()` — the server enforces self-service.
 */
export const channelConsentSchema = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  push: z.boolean(),
});
export type ChannelConsent = z.infer<typeof channelConsentSchema>;

export const notificationPreferencesSchema = z.object({
  LIFECYCLE: channelConsentSchema,
  MARKETING: channelConsentSchema,
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

const channelConsentUpdateSchema = channelConsentSchema.partial();

/** PATCH payload — only the supplied categories/channels change. */
export const updateNotificationPreferencesRequestSchema = z
  .object({
    LIFECYCLE: channelConsentUpdateSchema.optional(),
    MARKETING: channelConsentUpdateSchema.optional(),
  })
  .strict();
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof updateNotificationPreferencesRequestSchema
>;
