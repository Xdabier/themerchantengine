import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { WEBHOOK_SECRET_BYTES } from './webhooks.constants';

// ── SSRF — blocked hostname patterns (spec §8.1 API7) ────────────────────────

const BLOCKED_PATTERNS: RegExp[] = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
  /^192\.168\.\d{1,3}\.\d{1,3}$/, // 192.168.0.0/16
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // 127.0.0.0/8
  /^169\.254\.\d{1,3}\.\d{1,3}$/, // 169.254.0.0/16 (link-local)
  /^::1$/, // IPv6 loopback
  /^fc[0-9a-f]{2}:/i, // IPv6 unique local fc00::/7
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local fe80::/10
  /^0\.0\.0\.0$/, // unspecified
  /^localhost$/i, // hostname alias for loopback
];

/**
 * Returns true when the hostname resolves to a blocked private / loopback
 * range (spec §8.1 API7 — SSRF prevention).
 */
export function isBlockedHostname(hostname: string): boolean {
  // Strip IPv6 brackets e.g. [::1] → ::1
  const h = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return BLOCKED_PATTERNS.some((re) => re.test(h));
}

/**
 * Validates that a webhook URL:
 *  - is a valid absolute URL
 *  - uses HTTPS scheme only
 *  - does not target a private / loopback IP address
 *
 * Throws `BadRequestException` with a structured error code on violation.
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException({
      error: { code: 'INVALID_WEBHOOK_URL', message: 'Webhook URL is not a valid URL' },
    });
  }

  if (parsed.protocol !== 'https:') {
    throw new BadRequestException({
      error: { code: 'WEBHOOK_URL_NOT_HTTPS', message: 'Webhook URL must use the HTTPS scheme' },
    });
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new BadRequestException({
      error: {
        code: 'WEBHOOK_URL_INTERNAL_IP',
        message: 'Webhook URL must not target internal or loopback addresses',
      },
    });
  }
}

// ── HMAC signing ─────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random hex secret for signing deliveries.
 */
export function generateSecret(): string {
  return crypto.randomBytes(WEBHOOK_SECRET_BYTES).toString('hex');
}

/**
 * Signs a serialised payload string with HMAC-SHA256.
 * Returns the hex digest that goes in `X-Webhook-Signature`.
 */
export function signPayload(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
