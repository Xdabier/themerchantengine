import type { AuditLogEntry } from '@admin-services';
import { auditActionTitle } from '../../shared/format/audit-labels';
import { humanizeCode } from '../../shared/format/enum-label';

/**
 * Friendly label for an audit action code (e.g. "product.update" → "Product
 * Updated"). Delegates to the shared audit vocabulary so this table and the
 * dashboard activity feed describe the same event with the same words.
 */
export function actionLabel(action: string | null | undefined): string {
  return auditActionTitle(action);
}

/**
 * Diff two JSON blobs and return a flat list of `{ key, before, after }`
 * rows — used by the expand panel. Deep changes surface as dot-paths so
 * operators can scan what moved without drilling through the raw JSON.
 */
export interface DiffRow {
  key: string;
  before: unknown;
  after: unknown;
}

export function diffEntry(entry: Pick<AuditLogEntry, 'before' | 'after' | 'changes'>): DiffRow[] {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: DiffRow[] = [];
  for (const key of [...keys].sort()) {
    const b = before[key];
    const a = after[key];
    if (!deepEqual(b, a)) {
      out.push({ key, before: b, after: a });
    }
  }
  // If the backend only sent `changes` (create/delete events often do)
  // and we have no before/after to diff, fall through to that.
  if (out.length === 0 && entry.changes && typeof entry.changes === 'object') {
    const changes = entry.changes as Record<string, unknown>;
    for (const key of Object.keys(changes).sort()) {
      out.push({ key, before: undefined, after: changes[key] });
    }
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 120 ? value.slice(0, 117) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  } catch {
    return String(value);
  }
}

/**
 * Friendly label for the audited resource type (`gift_card` → "Gift Card").
 * The raw id stays beside it, truncated, so an entry is still traceable.
 */
export function resourceLabel(entityType: string | null | undefined): string {
  return humanizeCode(entityType);
}

/** Compact actor label: user id fragment, or "System" when nullish. */
export function actorLabel(userId: string | null | undefined): string {
  if (!userId) return 'System';
  return userId.length > 10 ? userId.slice(0, 10) + '…' : userId;
}

/**
 * Human-readable actor for the Actor column: the joined user's full name, then
 * email, falling back to a truncated id then "system". The `user` object is
 * already on the wire (the audit-log response includes it), so this never needs
 * a second request.
 */
export function actorName(entry: Pick<AuditLogEntry, 'user' | 'userId'>): string {
  const u = entry.user;
  if (u) {
    const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    if (full) return full;
    if (u.email) return u.email;
  }
  return actorLabel(entry.userId);
}
