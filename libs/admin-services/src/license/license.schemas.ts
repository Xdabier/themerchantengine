import { z } from 'zod';

/**
 * The engine's license verdict, mirroring
 * `apps/api/src/modules/license/license.types.ts`.
 *
 * Six statuses, and none of them cuts anything off: DR-31 and plan E1.5 both
 * say the banner is the whole consequence of an expired license. A schema that
 * modelled fewer statuses would throw on the exact response the operator most
 * needs to read, which is the "Could not load" bug class.
 */
export const LICENSE_STATUSES = [
  'valid',
  'expiring',
  'grace',
  'expired',
  'invalid',
  'missing',
] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const licenseClaimsSchema = z.object({
  id: z.string(),
  licensee: z.string(),
  plan: z.string(),
  storeCap: z.number().int(),
  domains: z.array(z.string()),
  issuedAt: z.string(),
  expiresAt: z.string(),
});
export type LicenseClaims = z.infer<typeof licenseClaimsSchema>;

export const licenseVerdictSchema = z.object({
  status: z.enum(LICENSE_STATUSES),
  claims: licenseClaimsSchema.nullable(),
  reason: z.string().nullable(),
  verifiedAt: z.string(),
  graceEndsAt: z.string().nullable(),
  daysToExpiry: z.number().nullable(),
});
export type LicenseVerdict = z.infer<typeof licenseVerdictSchema>;

/** The statuses that put a banner in the shell. `valid` is the quiet one. */
export function isLicenseWarning(status: LicenseStatus): boolean {
  return status !== 'valid';
}
