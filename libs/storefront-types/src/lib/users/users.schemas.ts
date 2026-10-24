import { z } from 'zod';
import { addressSchema, customerUserSchema } from '../shared/entities';

/**
 * Storefront users schemas. Mirrors:
 * - `apps/api/src/modules/users/dto/customer/update-profile.dto.ts:UpdateProfileDto`
 * - `apps/api/src/modules/users/dto/customer/create-address.dto.ts:CreateAddressDto`
 * - `apps/api/src/modules/users/dto/customer/update-address.dto.ts:UpdateAddressDto`
 * - `apps/api/src/modules/users/dto/customer/set-default-address.dto.ts:SetDefaultAddressDto`
 *
 * All routes class-level `@OwnerGuard()` — server enforces self-service.
 */

const phonePattern = /^\+?[0-9]{6,15}$/;
const passwordRule = z
  .string()
  .min(8)
  .max(128)
  .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
  });

export const updateProfileRequestSchema = z
  .object({
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().regex(phonePattern, 'Invalid phone number format').optional(),
    avatarUrl: z.string().url().optional(),
    currentPassword: z.string().optional(),
    newPassword: passwordRule.optional(),
    locale: z
      .string()
      .min(2)
      .max(10)
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Locale must be a BCP-47 code like "en" or "en-US"')
      .optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.email || value.newPassword) && !value.currentPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'currentPassword is required when changing email or password',
        path: ['currentPassword'],
      });
    }
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

const addressInputBase = {
  label: z.string().max(50).optional(),
  fullName: z.string().max(100),
  phone: z.string().regex(phonePattern, 'Invalid phone number format'),
  addressLine1: z.string().max(255),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, 'Country must be a valid ISO 3166-1 alpha-2 code (e.g. US, GB)'),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
};

export const createAddressRequestSchema = z.object(addressInputBase);
export type CreateAddressRequest = z.infer<typeof createAddressRequestSchema>;

export const updateAddressRequestSchema = createAddressRequestSchema.partial();
export type UpdateAddressRequest = z.infer<typeof updateAddressRequestSchema>;

export const setDefaultAddressRequestSchema = z.object({
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
});
export type SetDefaultAddressRequest = z.infer<typeof setDefaultAddressRequestSchema>;

export { addressSchema, customerUserSchema };
export type { Address, CustomerUser } from '../shared/entities';
