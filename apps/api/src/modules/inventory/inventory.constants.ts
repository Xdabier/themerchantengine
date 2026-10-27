// ── Sort field allowlists ──────────────────────────────────────────────────────

export const VALID_STOCK_SORT_FIELDS = ['onHand', 'reserved', 'updatedAt'] as const;
export type ValidStockSortField = (typeof VALID_STOCK_SORT_FIELDS)[number];

export const VALID_MOVEMENT_SORT_FIELDS = ['createdAt', 'quantity', 'type'] as const;
export type ValidMovementSortField = (typeof VALID_MOVEMENT_SORT_FIELDS)[number];

// ── Thresholds ─────────────────────────────────────────────────────────────────

/**
 * Fallback low-stock threshold, used only when the `defaultLowStockThreshold`
 * store setting is missing or invalid. The effective value comes from settings
 * (see `InventoryService.effectiveLowStockThreshold`).
 */
export const LOW_STOCK_THRESHOLD = 10;

export const STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/**
 * Grades a stock count into the three-state status. Callers pass different
 * counts on purpose: the admin surfaces (`listStockLevels`, `listAlerts`) pass
 * stored `onHand`, so the badge matches the list filter, which must stay a
 * plain indexed WHERE. The storefront and search surfaces pass net available
 * (`onHand - reserved`), so a fully reserved shelf reads as out of stock.
 */
export function stockStatusFor(onHand: number, threshold: number): StockStatus {
  if (onHand <= 0) return 'OUT_OF_STOCK';
  return onHand <= threshold ? 'LOW_STOCK' : 'IN_STOCK';
}

// ── Events ────────────────────────────────────────────────────────────────────

export const INVENTORY_EVENTS = {
  LOW_STOCK: 'inventory.low_stock',
  OUT_OF_STOCK: 'inventory.out_of_stock',
  // NE8 — emitted when a variant's total onHand crosses from <=0 to >0. The
  // string MUST match the webhooks catalogue entry (WEBHOOK_EVENT_TYPES) so the
  // already-wired webhooks listener fan-out stays connected.
  RESTOCKED: 'inventory.restocked',
} as const;
