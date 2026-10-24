import * as z from 'zod';

/**
 * The claims a license file carries (DR-31, plan E1.5). `domains` are bare
 * hostnames (an apex covers its subdomains, `*` covers everything);
 * `storeCap` is the number of stores the plan allows and is informational
 * until activation counting lands in a later epic.
 */
export const licenseClaimsSchema = z
  .object({
    id: z.string().min(1).max(64),
    licensee: z.string().min(1).max(200),
    plan: z.string().min(1).max(64),
    storeCap: z.number().int().min(1),
    domains: z.array(z.string().min(1).max(253)).min(1),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type LicenseClaims = z.infer<typeof licenseClaimsSchema>;

export const licenseFileSchema = z
  .object({
    claims: licenseClaimsSchema,
    /** Base64 Ed25519 signature over the canonical JSON of `claims`. */
    signature: z.string().min(1),
  })
  .strict();

export type LicenseFile = z.infer<typeof licenseFileSchema>;

export const LICENSE_STATUSES = [
  'valid',
  'expiring',
  'grace',
  'expired',
  'invalid',
  'missing',
] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export interface LicenseVerdict {
  status: LicenseStatus;
  claims: LicenseClaims | null;
  /** Why an `invalid` or `missing` verdict was reached, for the boot message and the banner. */
  reason: string | null;
  verifiedAt: string;
  /** For `expiring`, `grace` and `expired`: when the grace period ends. */
  graceEndsAt: string | null;
  /** Days until expiry (negative once expired). Null without claims. */
  daysToExpiry: number | null;
}

/** Days before expiry during which the status reads `expiring`. */
export const LICENSE_EXPIRING_DAYS = 30;

/**
 * Days after expiry during which the status reads `grace`. After that it
 * reads `expired`. Neither state cuts anything: the admin shows a banner and
 * the storefront never goes down (DR-31).
 */
export const LICENSE_GRACE_DAYS = 30;
