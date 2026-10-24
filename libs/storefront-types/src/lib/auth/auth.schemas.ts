import { z } from 'zod';

/**
 * Form-input Zod contracts for the storefront auth screens.
 *
 * Authentication is owned by Better Auth (DR-24): the storefront calls the
 * vanilla Better Auth client (`libs/storefront-services/src/lib/auth/`), not a
 * hand-rolled `/v1/auth/*` controller — the custom controller + its DTOs were
 * retired in BA2. These schemas validate a form payload before it reaches the
 * client, so a malformed input fails fast and locally rather than as a
 * round-trip error.
 *
 * The session is one `HttpOnly` cookie the browser owns and JavaScript cannot
 * read — there is no access token, no refresh token, and no `/v1/auth/refresh`
 * round-trip on the storefront (constitution §3.3 / §3.11.6).
 */

/** Password policy — mirrors the backend `emailAndPassword` config (min 8). */
const passwordRule = z
  .string()
  .min(8)
  .max(128)
  .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
  });

export const registerRequestSchema = z.object({
  email: z.string().email().min(1),
  password: passwordRule,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email().min(1),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordRule,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Password-less sign-in: the customer receives a one-time link by email. */
export const magicLinkRequestSchema = z.object({
  email: z.string().email().min(1),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;
