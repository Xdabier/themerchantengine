/** Shared helpers for the analytics feature. */
import { adminIntlTag } from '../../shared/format/intl-tag';
import { formatAdminDate } from '../../shared/format/datetime';
import type { DateRangeValue } from './date-range.component';

export function formatCount(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString(adminIntlTag());
}

// `formatCurrency` is gone. It rendered a bare `6,539.2`: no code, no symbol,
// and `minimumFractionDigits: 0` truncated the decimals. Analytics aggregates
// are in the store currency by construction, so the pages render them with the
// shared `money` pipe instead.

export function formatPercent(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  const rounded = Math.round(n * 100) / 100;
  return `${rounded}%`;
}

/**
 * Human readback of an applied date range, in the store timezone.
 *
 * The empty states used to say "in the selected range" even when the operator
 * had never picked one (finding E6), and the native date inputs show their
 * bounds in the browser's own format (decision D10), so every analytics page
 * echoes the range it actually queried in the canonical admin format.
 *
 * Returns `null` when no range is applied, which is the "everything so far"
 * case.
 */
export function rangeLabel(range: DateRangeValue, timeZone: string): string | null {
  const from = range.from ? calendarDate(range.from, timeZone) : null;
  const to = range.to ? calendarDate(range.to, timeZone) : null;
  if (from && to) return `${from} – ${to}`;
  if (from) return `from ${from}`;
  if (to) return `up to ${to}`;
  return null;
}

/**
 * The picker emits calendar boundaries (`…T00:00:00Z` / `…T23:59:59Z`), not
 * instants. Re-anchor at midday so no store timezone can shift the readback
 * onto the neighbouring day and show a date the operator never picked.
 */
function calendarDate(iso: string, timeZone: string): string {
  return formatAdminDate(`${iso.slice(0, 10)}T12:00:00.000Z`, timeZone);
}
