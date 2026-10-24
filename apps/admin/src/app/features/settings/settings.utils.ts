import type { SettingsResponse } from '@admin-services';

/**
 * Grab a key from the grouped settings envelope. Backend returns
 * `{ general: {...}, localization: {...}, ... }` — we prefer a targeted
 * accessor over typing the whole response because each group's shape
 * changes independently and we only validate what we read.
 */
export function readSetting<T>(
  settings: SettingsResponse | null,
  group: string,
  key: string,
  fallback: T,
): T {
  if (!settings) return fallback;
  const g = settings[group];
  if (!g || typeof g !== 'object') return fallback;
  const v = (g as Record<string, unknown>)[key];
  return v === undefined || v === null ? fallback : (v as T);
}

const MASKED_PLACEHOLDER = '***';

/** Shared secret-key allow-list used by the Integrations screen.
 *  NB: Stripe *publishable* key is explicitly NOT here — it's
 *  client-side-safe. Only true secrets belong. */
export const INTEGRATION_SECRET_KEYS = new Set([
  'analyticsKey',
  'emailApiKey',
  'smsApiKey',
  'sentryDsn',
  'stripeWebhookSecret',
]);

export function isIntegrationSecret(key: string): boolean {
  return INTEGRATION_SECRET_KEYS.has(key);
}

export function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  return MASKED_PLACEHOLDER;
}

export function isMasked(value: unknown): boolean {
  return value === MASKED_PLACEHOLDER;
}
