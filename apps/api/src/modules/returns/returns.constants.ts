import { ReturnStatus } from '@prisma/client';

// ── Number prefix ────────────────────────────────────────────────────────────

export const RETURN_NUMBER_PREFIX = 'RET';

// ── Return window ────────────────────────────────────────────────────────────

/** Default return window in days. Override with RETURN_WINDOW_DAYS env var (§4.9). */
export const DEFAULT_RETURN_WINDOW_DAYS = 30;

// ── Status transition map ────────────────────────────────────────────────────

/** Allowed transitions from each status (§4.9). */
export const RETURN_STATUS_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: [ReturnStatus.APPROVED, ReturnStatus.REJECTED],
  APPROVED: [ReturnStatus.ITEM_RECEIVED],
  ITEM_RECEIVED: [ReturnStatus.REFUND_PROCESSED],
  REFUND_PROCESSED: [ReturnStatus.CLOSED],
  CLOSED: [],
  REJECTED: [],
};

// ── Sort field allowlists ────────────────────────────────────────────────────

export const VALID_RETURN_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'status',
  'returnNumber',
  'requestedAt',
] as const;

// ── Events ───────────────────────────────────────────────────────────────────

export const RETURN_EVENTS = {
  CREATED: 'return.created',
  APPROVED: 'return.approved',
  REJECTED: 'return.rejected',
  RECEIVED: 'return.received',
  REFUNDED: 'return.refunded',
  CLOSED: 'return.closed',
  /** An EXCHANGE refund minted a new EXC- order (NE5) — carries `orderId` of it. */
  EXCHANGE_CREATED: 'return.exchange-created',
} as const;
