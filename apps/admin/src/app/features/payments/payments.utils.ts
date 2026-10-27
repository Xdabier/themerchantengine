import type { BadgeTone } from '@admin-ui';
import type { PaymentMethod, PaymentProvider } from '@admin-services';
import { pickTranslation, type Translatable } from '@admin-types';

export function providerLabel(provider: PaymentProvider | string): string {
  switch (provider) {
    case 'stripe':
      return 'Stripe';
    case 'paypal':
      return 'PayPal';
    case 'cod':
      return 'Cash on delivery';
    case 'manual':
      return 'Manual / bank transfer';
    case 'gift_card':
      return 'Gift card / store credit';
    default:
      return provider;
  }
}

export function activeTone(isActive: boolean): BadgeTone {
  return isActive ? 'success' : 'neutral';
}

export function testModeTone(isTestMode: boolean): BadgeTone | null {
  return isTestMode ? 'warning' : null;
}

export function methodLabel(
  method: Pick<PaymentMethod, 'name' | 'code'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    method.name as Translatable | string | null | undefined,
    locale,
    method.code,
    defaultLocale,
  );
}

const MASKED_VALUE = '***';
const SECRET_KEYS = new Set([
  'apiKey',
  'webhookSecret',
  'clientSecret',
  'privateKey',
  'signingSecret',
]);

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key);
}

export function isMasked(value: unknown): boolean {
  return value === MASKED_VALUE;
}

/** Display helper — mask-aware preview for a config value. */
export function displayConfigValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (isSecretKey(key) && typeof value === 'string') {
    return value === MASKED_VALUE ? 'Stored (hidden)' : value;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}
