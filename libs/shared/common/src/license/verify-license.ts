import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { canonicalJson } from './canonical-json';
import {
  LICENSE_EXPIRING_DAYS,
  LICENSE_GRACE_DAYS,
  licenseFileSchema,
  type LicenseClaims,
  type LicenseStatus,
  type LicenseVerdict,
} from './license-claims';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure verification of one license file's content (DR-31, plan E1.5): the
 * claims parse, the Ed25519 signature holds against the given key, every host
 * the deployment answers on is bound, and expiry is graded rather than
 * refused. Every failure short of expiry is `invalid`.
 *
 * Shared by the API at boot and by the install stepper before it writes
 * anything, so the two cannot disagree about a file (§3.14).
 */
export function verifyLicenseFile(
  content: string,
  configuredHosts: readonly string[],
  publicKeyPem: string,
  now: Date = new Date(),
): LicenseVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return invalidVerdict('license file is not valid JSON', now);
  }
  const file = licenseFileSchema.safeParse(parsed);
  if (!file.success) {
    const issue = file.error.issues[0];
    return invalidVerdict(
      `license claims are malformed (${issue.path.join('.')}: ${issue.message})`,
      now,
    );
  }
  const { claims, signature } = file.data;

  if (!signatureHolds(claims, signature, publicKeyPem)) {
    return invalidVerdict('license signature does not verify against the engine key', now);
  }

  const unbound = configuredHosts.filter((host) => !isBound(host, claims.domains));
  if (unbound.length > 0) {
    return invalidVerdict(
      `license is bound to ${claims.domains.join(', ')} but this store answers on ${unbound.join(', ')}`,
      now,
    );
  }

  const expiresAt = new Date(claims.expiresAt);
  const daysToExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
  const graceEndsAt = new Date(expiresAt.getTime() + LICENSE_GRACE_DAYS * DAY_MS);
  let status: LicenseStatus = 'valid';
  if (now >= graceEndsAt) status = 'expired';
  else if (now >= expiresAt) status = 'grace';
  else if (daysToExpiry < LICENSE_EXPIRING_DAYS) status = 'expiring';

  return {
    status,
    claims,
    reason: null,
    verifiedAt: now.toISOString(),
    graceEndsAt: status === 'valid' ? null : graceEndsAt.toISOString(),
    daysToExpiry,
  };
}

export function signatureHolds(
  claims: LicenseClaims,
  signature: string,
  publicKeyPem: string,
): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (sig.length === 0) return false;
  try {
    return verifySignature(
      null,
      Buffer.from(canonicalJson(claims), 'utf8'),
      createPublicKey(publicKeyPem),
      sig,
    );
  } catch {
    return false;
  }
}

export function missingVerdict(reason: string, now: Date): LicenseVerdict {
  return {
    status: 'missing',
    claims: null,
    reason,
    verifiedAt: now.toISOString(),
    graceEndsAt: null,
    daysToExpiry: null,
  };
}

export function invalidVerdict(reason: string, now: Date): LicenseVerdict {
  return {
    status: 'invalid',
    claims: null,
    reason,
    verifiedAt: now.toISOString(),
    graceEndsAt: null,
    daysToExpiry: null,
  };
}

/** `https://admin.shop.example:8443/` gives `admin.shop.example`. */
export function hostOf(origin: string): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** A bound apex covers its subdomains; `*` covers everything. */
export function isBound(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase();
  return domains.some((bound) => {
    const b = bound.toLowerCase().replace(/^\*\./, '');
    if (bound === '*') return true;
    return h === b || h.endsWith(`.${b}`);
  });
}
