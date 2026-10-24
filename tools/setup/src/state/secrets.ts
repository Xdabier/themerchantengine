import { randomBytes } from 'node:crypto';

/**
 * The secrets the engine generates for itself.
 * Each is 32 random bytes as hex; Better Auth needs at least 32 bytes for its
 * HMAC key and the rest have no lower bound worth going under.
 *
 * A re-run keeps what an earlier run wrote: a rotated database password would
 * lock the running Postgres out of its own volume, and a rotated revalidate
 * secret would silently stop the storefront cache from invalidating.
 */
export const GENERATED_SECRET_KEYS = [
  'DB_PASSWORD',
  'REDIS_PASSWORD',
  'BETTER_AUTH_SECRET',
  'STOREFRONT_REVALIDATE_SECRET',
  'SIGNED_URL_SECRET',
  'UNSUBSCRIBE_TOKEN_SECRET',
  'STOREFRONT_REDIS_PASSWORD',
] as const;
export type GeneratedSecretKey = (typeof GENERATED_SECRET_KEYS)[number];
export type GeneratedSecrets = Record<GeneratedSecretKey, string>;

export const SECRET_BYTES = 32;

export function generateSecret(random: (bytes: number) => Buffer = randomBytes): string {
  return random(SECRET_BYTES).toString('hex');
}

/** Every key, generated unless `existing` already carries a non-empty value for it. */
export function generateSecrets(
  existing: Partial<Record<string, string>> = {},
  random: (bytes: number) => Buffer = randomBytes,
): GeneratedSecrets {
  const out = {} as GeneratedSecrets;
  for (const key of GENERATED_SECRET_KEYS) {
    const kept = existing[key];
    out[key] = kept && kept.length > 0 ? kept : generateSecret(random);
  }
  return out;
}
