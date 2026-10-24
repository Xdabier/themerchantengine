import type { BadgeTone } from '@admin-ui';
import type { AlertType, AdjustmentReason, MovementType, StockStatus } from '@admin-services';
import { humanizeCode, labelFromMap } from '../../shared/format/enum-label';

const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

/** Friendly label for the `StockStatus` enum, dash when the row carries none. */
export function stockStatusLabel(status: string | null | undefined): string {
  return labelFromMap(STOCK_STATUS_LABELS, status as StockStatus | null | undefined);
}

/** Friendly label for the `AlertType` enum (e.g. LOW_STOCK → "Low Stock"). */
export function alertTypeLabel(type: string | null | undefined): string {
  return humanizeCode(type);
}

/** Friendly label for the `MovementType` enum (e.g. RESERVATION_RELEASE → "Reservation Release"). */
export function movementTypeLabel(type: string | null | undefined): string {
  return humanizeCode(type);
}

/**
 * Tone for a stock badge. An absent status is neutral, never success: a
 * truthy-looking default is what let every row claim "In stock" (finding F1).
 */
export function stockStatusTone(status: StockStatus | undefined): BadgeTone {
  switch (status) {
    case 'OUT_OF_STOCK':
      return 'error';
    case 'LOW_STOCK':
      return 'warning';
    case 'IN_STOCK':
      return 'success';
    default:
      return 'neutral';
  }
}

export function alertTypeTone(type: AlertType): BadgeTone {
  return type === 'OUT_OF_STOCK' ? 'error' : 'warning';
}

export const adjustmentReasons: readonly AdjustmentReason[] = [
  'RECOUNT',
  'DAMAGE',
  'SHRINKAGE',
  'RECEIVED',
  'RETURN_RESTOCK',
  'RETURN_DAMAGED',
  'CORRECTION',
  'OTHER',
];

export const movementTypes: readonly MovementType[] = [
  'SALE',
  'RETURN',
  'ADJUSTMENT',
  'TRANSFER',
  'RESERVATION',
  'RESERVATION_RELEASE',
];

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  return reason
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function signedQuantityColor(q: number): string {
  if (q > 0) return 'text-status-success';
  if (q < 0) return 'text-status-error';
  return 'text-ink-muted';
}
