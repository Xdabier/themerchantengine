import { z } from 'zod';
import { STORE_CONFIG_LOCALES } from '@common/store-config-fixtures/store-config-fixture.schema';

/** Public newsletter signup (NE9). Double opt-in: the API replies with a neutral
 *  status and (if applicable) sends a confirmation email.
 *
 *  The locale is the build catalogue, not one install's pair: the API validates
 *  it against the store's enabled set (`IsEnabledLocaleValue`), so restating a
 *  pair here would reject a locale the store actually serves (plan E2.5). */
export const subscribeNewsletterRequestSchema = z.object({
  email: z.string().email().max(254),
  locale: z.enum(STORE_CONFIG_LOCALES).optional(),
});
export type SubscribeNewsletterRequest = z.infer<typeof subscribeNewsletterRequestSchema>;

export const subscribeNewsletterResponseSchema = z.object({
  status: z.string(),
});
export type SubscribeNewsletterResponse = z.infer<typeof subscribeNewsletterResponseSchema>;
