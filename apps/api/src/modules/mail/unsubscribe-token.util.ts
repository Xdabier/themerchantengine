/**
 * Stateless, signed unsubscribe token (NE7).
 *
 * Backs the public RFC 8058 one-click endpoint + the email footer link. There
 * is NO stored token — the token IS an HMAC over `${userId}:${category}` keyed
 * by a server secret, so verification needs no DB row (plan §4 "signed token"
 * branch). A leaked token can only flip ONE user+category email preference to
 * off (re-enableable in the preference center), so no expiry is needed —
 * important because an unsubscribe link must keep working from arbitrarily old
 * mail (RFC 8058).
 *
 * Format: `base64url(userId).base64url(category).base64url(HMAC-SHA256)`.
 * Verification is constant-time (`timingSafeEqual`) and rejects any tamper.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SEP = '.';

/**
 * Resolve the signing key. A dedicated `UNSUBSCRIBE_TOKEN_SECRET` wins;
 * otherwise we reuse `BETTER_AUTH_SECRET` (already required in prod) so no new
 * production env var is mandatory. Callers may pass an explicit secret (tests).
 */
export function resolveUnsubscribeSecret(fromConfig?: string | undefined): string {
  const secret =
    fromConfig || process.env.UNSUBSCRIBE_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'UNSUBSCRIBE_TOKEN_SECRET or BETTER_AUTH_SECRET must be set to sign unsubscribe tokens',
    );
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromB64url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

/** Mint a token that proves the holder may opt `userId` out of `category`. */
export function signUnsubscribeToken(userId: string, category: string, secret: string): string {
  const sig = sign(`${userId}:${category}`, secret);
  return `${b64url(userId)}${SEP}${b64url(category)}${SEP}${sig}`;
}

/**
 * Verify + decode a token. Returns the `{ userId, category }` it was signed for,
 * or `null` for any malformed, tampered, or wrong-secret token. Category-scoped:
 * a token minted for MARKETING never validates as LIFECYCLE because the category
 * is part of the signed payload.
 */
export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): { userId: string; category: string } | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split(SEP);
  if (parts.length !== 3) return null;

  let userId: string;
  let category: string;
  try {
    userId = fromB64url(parts[0]);
    category = fromB64url(parts[1]);
  } catch {
    return null;
  }
  if (!userId || !category) return null;

  const expected = sign(`${userId}:${category}`, secret);
  const provided = parts[2];
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length check first — timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { userId, category };
}
