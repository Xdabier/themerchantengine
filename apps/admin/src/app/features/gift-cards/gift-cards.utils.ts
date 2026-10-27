import type { BadgeTone } from '@admin-ui';
import type { GiftCard } from '@admin-services';
import { formatMoney as sharedFormatMoney } from '../../shared/format/money';

export type GiftCardStatus = 'active' | 'inactive' | 'expired' | 'empty';

export function giftCardStatus(
  g: Pick<GiftCard, 'isActive' | 'expiresAt' | 'currentBalance'>,
): GiftCardStatus {
  if (!g.isActive) return 'inactive';
  if (g.expiresAt && Date.parse(g.expiresAt) < Date.now()) return 'expired';
  const balance =
    typeof g.currentBalance === 'string' ? Number(g.currentBalance) : g.currentBalance;
  if (Number.isFinite(balance) && balance <= 0) return 'empty';
  return 'active';
}

export function giftCardStatusTone(status: GiftCardStatus): BadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'expired':
      return 'error';
    case 'empty':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Money in the currency recorded on the row. Delegates to the one shared
 * formatter (`shared/format/money`); the local Intl copy this replaced carried
 * its own dollar default, which is how a euro store rendered dollars.
 */
export function formatGiftCardMoney(
  value: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  return sharedFormatMoney(value, currency);
}

export function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
