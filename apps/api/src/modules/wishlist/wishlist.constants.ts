// ── Sort field allowlists ────────────────────────────────────────────────────

export const VALID_WISHLIST_SORT_FIELDS = ['createdAt', 'productName', 'price'] as const;

// ── Events ───────────────────────────────────────────────────────────────────

export const WISHLIST_EVENTS = {
  ITEM_ADDED: 'wishlist.item_added',
  ITEM_REMOVED: 'wishlist.item_removed',
} as const;
