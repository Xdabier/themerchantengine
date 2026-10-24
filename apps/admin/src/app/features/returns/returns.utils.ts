import type { BadgeTone } from '@admin-ui';
import type { ReturnStatus } from '@admin-services';
import { humanizeCode } from '../../shared/format/enum-label';
import { formatMoney as sharedFormatMoney } from '../../shared/format/money';

/** Friendly label for the `ReturnStatus` enum (e.g. REFUND_PROCESSED → "Refund Processed"). */
export function statusLabel(status: string | null | undefined): string {
  return humanizeCode(status);
}

/** Friendly label for a return-item restock decision (e.g. RESTOCK → "Restock"). */
export function restockDecisionLabel(decision: string | null | undefined): string {
  return humanizeCode(decision);
}

/** Friendly label for a refund method (e.g. ORIGINAL_PAYMENT → "Original Payment"). */
export function refundMethodLabel(method: string | null | undefined): string {
  return humanizeCode(method);
}

/** Maps `ReturnStatus` to brand-approved badge tones. */
export function returnStatusTone(status: ReturnStatus | string): BadgeTone {
  switch (status) {
    case 'REFUND_PROCESSED':
    case 'CLOSED':
      return 'success';
    case 'APPROVED':
    case 'ITEM_RECEIVED':
      return 'info';
    case 'REQUESTED':
      return 'warning';
    case 'REJECTED':
      return 'error';
    default:
      return 'neutral';
  }
}

/**
 * State machine for the five actions exposed on a return detail. A given
 * transition is only valid from a subset of statuses — gating the buttons
 * client-side mirrors the 409 responses the API throws on invalid moves and
 * keeps operators from queuing conflicting writes.
 */
export const allowedActionsByStatus: Record<string, ReadonlySet<ReturnAction>> = {
  REQUESTED: new Set(['approve', 'reject']),
  APPROVED: new Set(['receive', 'reject']),
  ITEM_RECEIVED: new Set(['refund', 'close']),
  REFUND_PROCESSED: new Set(['close']),
  CLOSED: new Set<ReturnAction>(),
  REJECTED: new Set(['close']),
} as const;

export type ReturnAction = 'approve' | 'reject' | 'receive' | 'refund' | 'close';

export function canRun(action: ReturnAction, status: ReturnStatus | string): boolean {
  const allowed = allowedActionsByStatus[status];
  return allowed ? allowed.has(action) : false;
}

/**
 * Money in the currency recorded on the row. Delegates to the one shared
 * formatter (`shared/format/money`); the local Intl copy this replaced carried
 * its own dollar default, which is how a euro store rendered dollars.
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  return sharedFormatMoney(value, currency);
}

export type TimelineStage = 'requested' | 'approved' | 'received' | 'refunded';

export type TimelineEntry = {
  stage: TimelineStage;
  label: string;
  at: string | null;
  /** True when this stage is timestamped before a populated earlier stage. */
  outOfOrder: boolean;
};

/** Canonical stage order, and the labels the timeline renders. */
const TIMELINE_STAGES: ReadonlyArray<{ stage: TimelineStage; label: string }> = [
  { stage: 'requested', label: 'Requested' },
  { stage: 'approved', label: 'Approved' },
  { stage: 'received', label: 'Received' },
  { stage: 'refunded', label: 'Refunded' },
];

type TimelineSource = {
  requestedAt?: string | null;
  createdAt?: string | null;
  approvedAt?: string | null;
  receivedAt?: string | null;
  refundedAt?: string | null;
};

function timeOf(at: string | null): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * The return's milestones in the order they actually happened, with any entry
 * that precedes a populated canonically-earlier stage flagged.
 *
 * Sorting by real time makes the timeline tell the truth instead of quietly
 * normalising impossible data into stage order (a seeded return reads
 * "approved two months before requested"). The flag says the source record is
 * suspect rather than hiding it. Unset stages come last so operators still see
 * what is pending.
 */
export function orderedTimeline(ret: TimelineSource | null | undefined): TimelineEntry[] {
  if (!ret) return [];

  const raw = TIMELINE_STAGES.map(({ stage, label }) => {
    const at =
      stage === 'requested'
        ? (ret.requestedAt ?? ret.createdAt ?? null)
        : stage === 'approved'
          ? (ret.approvedAt ?? null)
          : stage === 'received'
            ? (ret.receivedAt ?? null)
            : (ret.refundedAt ?? null);
    return { stage, label, at, time: timeOf(at) };
  });

  const entries = raw.map((entry, index) => ({
    stage: entry.stage,
    label: entry.label,
    at: entry.at,
    time: entry.time,
    outOfOrder:
      entry.time !== null &&
      raw.slice(0, index).some((earlier) => earlier.time !== null && earlier.time > entry.time!),
  }));

  // Unset — and unparseable — stages sort last: there is nothing to place them
  // by, and treating them as epoch zero would push them to the top.
  const dated = entries.filter((e) => e.time !== null).sort((a, b) => a.time! - b.time!);
  const undated = entries.filter((e) => e.time === null);
  return [...dated, ...undated].map(({ stage, label, at, outOfOrder }) => ({
    stage,
    label,
    at,
    outOfOrder,
  }));
}

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  return reason
    .toLowerCase()
    .split('_')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : ''))
    .join(' ');
}
