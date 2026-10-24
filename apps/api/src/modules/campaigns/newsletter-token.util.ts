/**
 * Stateless, signed newsletter double-opt-in confirmation token (NE9).
 *
 * Mirrors the NE7 unsubscribe token: an HMAC over `confirm:${subscriberId}`
 * keyed by the same server secret, so the public confirm endpoint verifies it
 * with no stored token row. Distinct payload namespace (`confirm:`) so a confirm
 * token can never be replayed as an unsubscribe token or vice-versa.
 *
 * Format: `base64url(subscriberId).base64url(HMAC-SHA256)`. Verification is
 * constant-time and rejects any tamper. No expiry — a confirm link must keep
 * working from an arbitrarily old mail; the worst a leaked token does is confirm
 * a subscription the holder can immediately unsubscribe from.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SEP = '.';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromB64url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

/** Mint a token that proves the holder may confirm `subscriberId`'s subscription. */
export function signNewsletterConfirmToken(subscriberId: string, secret: string): string {
  const sig = sign(`confirm:${subscriberId}`, secret);
  return `${b64url(subscriberId)}${SEP}${sig}`;
}

/**
 * Verify + decode a confirm token. Returns the `subscriberId` it was signed for,
 * or `null` for any malformed, tampered, or wrong-secret token.
 */
export function verifyNewsletterConfirmToken(token: string, secret: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split(SEP);
  if (parts.length !== 2) return null;

  let subscriberId: string;
  try {
    subscriberId = fromB64url(parts[0]);
  } catch {
    return null;
  }
  if (!subscriberId) return null;

  const expected = sign(`confirm:${subscriberId}`, secret);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return subscriberId;
}

/**
 * Subscriber-scoped unsubscribe token (NE9.4a) — backs the RFC 8058 one-click
 * `List-Unsubscribe` on a newsletter campaign sent to a Subscriber (anonymous or
 * account-linked). Distinct `unsub:` payload namespace so it cannot be replayed
 * as a confirm token; same 2-part shape, distinguished from confirm by the route
 * + the signed namespace. Account-customer win-back mail uses the mail module's
 * user+MARKETING token instead (it opts out the NotificationPreference row).
 */
export function signSubscriberUnsubscribeToken(subscriberId: string, secret: string): string {
  const sig = sign(`unsub:${subscriberId}`, secret);
  return `${b64url(subscriberId)}${SEP}${sig}`;
}

export function verifySubscriberUnsubscribeToken(token: string, secret: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split(SEP);
  if (parts.length !== 2) return null;

  let subscriberId: string;
  try {
    subscriberId = fromB64url(parts[0]);
  } catch {
    return null;
  }
  if (!subscriberId) return null;

  const expected = sign(`unsub:${subscriberId}`, secret);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return subscriberId;
}
