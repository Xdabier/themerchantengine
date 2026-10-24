import * as z from 'zod';

export const checkoutRequiredFieldSchema = z.enum([
  'email',
  'phone',
  'shippingAddress',
  'billingAddress',
  'company',
  'note',
]);
export type CheckoutRequiredField = z.infer<typeof checkoutRequiredFieldSchema>;

export const checkoutSettingsSchema = z.object({
  guestCheckoutEnabled: z.boolean(),
  requiredFields: z.array(checkoutRequiredFieldSchema),
  termsOfServiceUrl: z.string().nullable(),
  postPurchaseRedirectUrl: z.string().nullable(),
  checkoutMessage: z.string().nullable(),
});
export type CheckoutSettings = z.infer<typeof checkoutSettingsSchema>;

export const updateCheckoutSettingsRequestSchema = z.object({
  guestCheckoutEnabled: z.boolean().optional(),
  requiredFields: z.array(checkoutRequiredFieldSchema).optional(),
  termsOfServiceUrl: z.string().url().nullable().optional(),
  postPurchaseRedirectUrl: z.string().url().nullable().optional(),
  checkoutMessage: z.string().max(500).nullable().optional(),
});
export type UpdateCheckoutSettingsRequest = z.infer<typeof updateCheckoutSettingsRequestSchema>;
