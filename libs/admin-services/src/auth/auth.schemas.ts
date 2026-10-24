import { z } from 'zod';

/**
 * Form-input Zod contracts for the admin auth screens.
 *
 * Authentication itself is owned by Better Auth (DR-24) — the admin calls the
 * Better Auth client, not a hand-rolled `/v1/auth/*` controller. These schemas
 * validate the form payloads before they reach the client, so a malformed
 * input fails fast and locally rather than as a round-trip error.
 */

/** Password policy — mirrors the backend `emailAndPassword` config (min 8). */
export const passwordPolicy = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/\d/, 'Password must contain a digit.');

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordPolicy,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const magicLinkRequestSchema = z.object({
  email: z.string().email(),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/** A TOTP code is exactly six digits. Used by the 2FA enrol + challenge forms. */
export const totpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.');
export type TotpCode = z.infer<typeof totpCodeSchema>;
