import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Recurrence guard for the admin entity-rendering fix
 * (specs/features/admin-entity-rendering/plan.md).
 *
 * Statically scans every feature page/component for the precise signatures of
 * the two bug classes that were fixed, so they cannot silently return:
 *  - the literal `[object Object]` baked into a template, and
 *  - a raw foreign-key id interpolated as visible text where a name belongs
 *    (e.g. `{{ o.userId ?? 'Guest' }}`).
 *
 * It is deliberately narrow — it only flags *bare-field* interpolations like
 * `{{ x.userId }}`, never a reduction such as `{{ customerLabel(o.user) }}` or
 * an attribute binding such as `[title]="o.userId"`, so it stays low-noise.
 */

const FEATURES_DIR = join(__dirname, '..', 'features');

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (
      (entry.endsWith('.page.ts') ||
        entry.endsWith('.component.ts') ||
        entry.endsWith('.dialog.ts')) &&
      !entry.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

const files = collect(FEATURES_DIR);

// `{{ <path>.<fkField> }}` with an optional `?? fallback`, but NOT a function
// call (no `(` before the field) — that is the bare-id-leak signature.
const RAW_FK_FIELDS = ['userId', 'customerId', 'productTypeId'];
const rawFkPattern = new RegExp(
  `\\{\\{\\s*[\\w.]+\\.(?:${RAW_FK_FIELDS.join('|')})\\s*(?:\\?\\?[^}]*)?\\}\\}`,
);

/**
 * Same bare-field shape for audit vocabulary: `{{ row.action }}` /
 * `{{ x.entityType }}` are machine codes (`webhook.delete`, `gift_card`) that
 * belong in `shared/format/audit-labels.ts` before they reach an operator
 * (admin-qa-remediation plan B, finding B5). A `{{ action }}` loop variable in
 * the permission pickers is a different thing, so the pattern requires a
 * dot-path.
 */
const rawAuditPattern = /\{\{\s*[\w.]+\.(?:action|entityType)\s*(?:\?\?[^}]*)?\}\}/;

/**
 * The audit-log tables still print the raw resource column; that is finding G3,
 * owned by `plan-g-rbac-permissions.md`. Delete this entry when plan G lands.
 */
const RAW_AUDIT_ALLOWLIST = ['audit-logs'];

describe('admin entity-rendering recurrence guard', () => {
  it('has feature files to scan', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no template bakes in the literal "[object Object]"', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('[object Object]'));
    expect(offenders.map((f) => relative(FEATURES_DIR, f))).toEqual([]);
  });

  it('no template interpolates a raw foreign-key id where a name belongs', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const match = rawFkPattern.exec(src);
      if (match) offenders.push(`${relative(FEATURES_DIR, f)} → ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('no template interpolates a raw audit action key or entity type', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(FEATURES_DIR, f).replace(/\\/g, '/');
      if (RAW_AUDIT_ALLOWLIST.some((dir) => rel.startsWith(`${dir}/`))) continue;
      const match = rawAuditPattern.exec(readFileSync(f, 'utf8'));
      if (match) offenders.push(`${rel} → ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('no gift-card template binds the phantom `tx.kind` field', () => {
    const offenders = files.filter((f) => /\{\{\s*tx\.kind\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(FEATURES_DIR, f))).toEqual([]);
  });
});
