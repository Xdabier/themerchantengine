import * as z from 'zod';

/**
 * Sibling Zod schema for `PATCH /v1/admin/checkout-settings`. Mirrors the
 * backend class-validator DTO at
 * `apps/api/src/modules/checkout/dto/update-checkout-settings.dto.ts:29-60`
 * so the admin client can parse / validate the wire shape without re-importing
 * backend types. Required-fields tuple is duplicated here per audit plan §6
 * ("three similar lines is better than a premature abstraction") — drift is
 * pinned by the `checkout.spec.ts` enum-rejection case.
 *
 * Two intentional asymmetries vs the backend DTO, captured for the future
 * class-validator ↔ Zod parity auditor (tasks.md E4 R4):
 *   1. `termsOfServiceUrl` + `postPurchaseRedirectUrl` use Zod v4 `z.string().url()`,
 *      which is stricter than backend's `@IsUrl({ require_tld: false })`. Zod
 *      rejects edge URLs the backend accepts (e.g. `https://localhost`).
 *      Stricter-on-the-client is safe — the backend will accept anything Zod
 *      accepts. Documented for symmetry, not a fidelity bug.
 *   2. `checkoutMessage` is `z.string().max(500).nullable().optional()`; the
 *      backend declares `@IsString() @MaxLength(500) @IsOptional()` with no
 *      `@ValidateIf((_, v) => v !== null)`. Zod accepts `null`, backend rejects
 *      `null` with class-validator's `string` constraint. Minor — admin UI
 *      should send `undefined` / omit the key rather than explicit `null`.
 */
export const CHECKOUT_REQUIRED_FIELDS = [
  'email',
  'phone',
  'shippingAddress',
  'billingAddress',
  'company',
  'note',
] as const;

export type CheckoutRequiredField = (typeof CHECKOUT_REQUIRED_FIELDS)[number];

export const updateCheckoutSettingsSchema = z.object({
  guestCheckoutEnabled: z.boolean().optional(),
  requiredFields: z
    .array(z.enum(CHECKOUT_REQUIRED_FIELDS))
    .max(CHECKOUT_REQUIRED_FIELDS.length)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'requiredFields must be unique',
    })
    .optional(),
  termsOfServiceUrl: z.string().url().max(500).nullable().optional(),
  postPurchaseRedirectUrl: z.string().url().max(500).nullable().optional(),
  checkoutMessage: z.string().max(500).nullable().optional(),
});

export type UpdateCheckoutSettingsInput = z.infer<typeof updateCheckoutSettingsSchema>;
