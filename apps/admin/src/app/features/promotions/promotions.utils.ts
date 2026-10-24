import type { BadgeTone } from '@admin-ui';
import type { Promotion } from '@admin-services';
import { formatAdminDate } from '../../shared/format/datetime';
import { formatMoney, type MoneyCurrency } from '../../shared/format/money';
import { pickTranslation, type Translatable } from '@admin-types';

export type PromotionStatus = 'scheduled' | 'live' | 'expired' | 'inactive';

/**
 * Derive a UI status from the promotion row. `isActive=false` always wins.
 * Otherwise compare the window vs `now` — scheduled < startsAt, live inside
 * the window, expired past endsAt. A promotion with no window is "live"
 * whenever it is active (consumer consistency with the backend behaviour).
 */
export function promotionStatus(
  p: Pick<Promotion, 'isActive' | 'startsAt' | 'endsAt'>,
): PromotionStatus {
  if (!p.isActive) return 'inactive';
  const now = Date.now();
  const starts = p.startsAt ? Date.parse(p.startsAt) : null;
  const ends = p.endsAt ? Date.parse(p.endsAt) : null;
  if (starts !== null && now < starts) return 'scheduled';
  if (ends !== null && now > ends) return 'expired';
  return 'live';
}

export function promotionStatusTone(status: PromotionStatus): BadgeTone {
  switch (status) {
    case 'live':
      return 'success';
    case 'scheduled':
      return 'warning';
    case 'expired':
      return 'error';
    default:
      return 'neutral';
  }
}

export function promotionTypeLabel(type: string): string {
  switch (type) {
    case 'PERCENTAGE':
      return 'Percent off';
    case 'FIXED_AMOUNT':
      return 'Fixed off';
    case 'FREE_SHIPPING':
      return 'Free shipping';
    case 'BUY_X_GET_Y':
      return 'Buy X get Y';
    case 'VOLUME_DISCOUNT':
      return 'Volume';
    case 'TIERED_PRICE':
      return 'Tiered';
    default:
      return type;
  }
}

/**
 * Format the "discount" column.
 *
 * Only `FIXED_AMOUNT` is money. Everything else has its own vocabulary, and
 * formatting it as money lies about what the promotion does: the backend
 * ignores `value` entirely for `BUY_X_GET_Y` (it gives `getQuantity` items free
 * per `buyQuantity` bought) and for the tier-driven types, so a `10` there is
 * not ten of anything spendable.
 *
 * `currency` is required and has no default. Promotions carry no per-record
 * currency, so callers pass the store currency; an unhydrated store passes
 * null and the amount renders bare rather than in an invented currency.
 */
export function formatPromotionDiscount(
  p: Pick<Promotion, 'type' | 'value'> & Partial<Pick<Promotion, 'buyQuantity' | 'getQuantity'>>,
  currency: MoneyCurrency,
): string {
  const v = typeof p.value === 'string' ? Number(p.value) : p.value;
  switch (p.type) {
    case 'PERCENTAGE':
      return `${v}%`;
    case 'FREE_SHIPPING':
      return 'Shipping';
    case 'BUY_X_GET_Y':
      return p.buyQuantity && p.getQuantity
        ? `Buy ${p.buyQuantity}, get ${p.getQuantity} free`
        : '—';
    case 'VOLUME_DISCOUNT':
      return 'Volume';
    case 'TIERED_PRICE':
      return 'Tiered';
    default:
      return formatMoney(v, currency);
  }
}

/**
 * A promotion window, in the store timezone. `timeZone` is required for the
 * same reason `formatMoney` requires a currency: a schedule rendered in the
 * operator's own zone is a different schedule.
 */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  timeZone: string,
): string {
  if (!start && !end) return 'Always';
  const fmt = (iso: string): string => formatAdminDate(iso, timeZone);
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end as string)}`;
}

/**
 * Resolve the promotion's display name in the operator's locale. Backend stores
 * Translatable, but older seeds and some fixtures keep plain strings, and
 * `pickTranslation` is idempotent on an already-resolved string.
 */
export function promotionLabel(
  p: Pick<Promotion, 'name'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    p.name as Translatable | string | null | undefined,
    locale,
    '—',
    defaultLocale,
  );
}
