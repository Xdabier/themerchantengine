import { humanizeCode } from './enum-label';

/**
 * Single home for the audit and permission label vocabulary shared by the
 * admin surfaces (plans B and G of `specs/features/admin-qa-remediation/`).
 *
 * The dashboard activity feed, the audit-log tables and the roles screen all
 * read their nouns and verbs from this file, so the same backend code renders
 * with the same words everywhere. Add new labels to the maps below; never
 * re-build this vocabulary inside a feature folder.
 *
 * Source of truth for the keys: `ENTITY_TYPE_MAP` and `METHOD_ACTION_MAP` in
 * `apps/api/src/modules/audit-log/audit-log.constants.ts`. A few services also
 * write past-tense actions by hand (`review.updated`), so both forms map to the
 * same label.
 */

/** Backend `entityType` value → operator-facing noun (lower case, article-ready). */
const ENTITY_LABELS: Record<string, string> = {
  product: 'product',
  order: 'order',
  user: 'user',
  category: 'category',
  promotion: 'promotion',
  gift_card: 'gift card',
  return: 'return',
  review: 'review',
  inventory: 'inventory item',
  shipping: 'shipping zone',
  tax: 'tax rate',
  asset: 'asset',
  notification: 'notification',
  storefront_config: 'storefront section',
  webhook: 'webhook',
  setting: 'setting',
  cms: 'CMS page',
  seo: 'SEO setting',
  analytics: 'analytics record',
  payment: 'payment',
  geo: 'geo setting',
  cart: 'cart',
  search: 'search record',
};

/** Backend action verb (imperative or past tense) → past-tense operator verb. */
const VERB_LABELS: Record<string, string> = {
  create: 'created',
  created: 'created',
  update: 'updated',
  updated: 'updated',
  delete: 'deleted',
  deleted: 'deleted',
  mutate: 'changed',
  changed: 'changed',
};

export interface ActivitySentenceInput {
  actor: string | null | undefined;
  action: string | null | undefined;
  entityType: string | null | undefined;
}

/** Readable noun for an audit `entityType` (e.g. `gift_card` → "gift card"). */
export function auditEntityLabel(entityType: string | null | undefined): string {
  if (!entityType) return 'record';
  return ENTITY_LABELS[entityType] ?? humanizeCode(entityType, 'record').toLowerCase();
}

/** Past-tense verb for an audit action suffix (e.g. `delete` → "deleted"). */
export function auditVerbLabel(verb: string | null | undefined): string {
  if (!verb) return 'changed';
  return VERB_LABELS[verb.toLowerCase()] ?? humanizeCode(verb, 'changed').toLowerCase();
}

/**
 * Sentence form for the dashboard activity feed:
 * `Super Admin deleted a webhook`. Actions that are not `entity.verb` pairs
 * keep the dotted layout with a humanized action.
 */
export function activitySentence({ actor, action, entityType }: ActivitySentenceInput): string {
  const who = actor?.trim() || 'System';
  const parsed = parseAuditAction(action);
  if (!parsed) return `${who} · ${humanizeCode(action)}`;
  const entity = auditEntityLabel(parsed.entityType || entityType);
  return `${who} ${auditVerbLabel(parsed.verb)} ${indefiniteArticle(entity)} ${entity}`;
}

/**
 * Column form for the audit-log tables: `Webhook Deleted`. Same vocabulary as
 * {@link activitySentence}, so the list and the feed cannot drift apart.
 */
export function auditActionTitle(action: string | null | undefined): string {
  const parsed = parseAuditAction(action);
  if (!parsed) return humanizeCode(action);
  const entity = parsed.entityType ? auditEntityLabel(parsed.entityType) : '';
  return titleCasePhrase([entity, auditVerbLabel(parsed.verb)].filter(Boolean).join(' '));
}

function parseAuditAction(
  action: string | null | undefined,
): { entityType: string; verb: string } | null {
  if (!action) return null;
  const cut = action.lastIndexOf('.');
  if (cut < 0) return null;
  const verb = action.slice(cut + 1);
  if (!verb) return null;
  return { entityType: action.slice(0, cut), verb };
}

function indefiniteArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a';
}

/** Title-cases a phrase, leaving words that already carry capitals (CMS, SEO) alone. */
function titleCasePhrase(phrase: string): string {
  return phrase
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(' ');
}
