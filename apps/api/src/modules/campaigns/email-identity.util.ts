/**
 * Email identity canonicalization for newsletter subscribers (2026-06-25).
 *
 * Bots harvested one inbox into many `Subscriber` rows using Gmail's dot/`+tag`
 * tricks (`a.b.c@gmail.com`, `abc+x@gmail.com` … all deliver to `abc@gmail.com`).
 * Each distinct stored string created a distinct row AND a distinct mail
 * `dedupeKey` (`newsletter-confirm:<id>`), so the dedupe never fired and every
 * variant got its own confirmation email.
 *
 * Canonicalizing the STORED address collapses the variants: the existing unique
 * index on `Subscriber.email` then yields one row per real inbox, and the
 * dedupeKey becomes stable so repeat confirm sends are suppressed.
 *
 * Scope is deliberately Gmail-only. Dots are RFC-5321-significant in the general
 * case and `+`-subaddressing is provider-specific, so canonicalizing every
 * domain would be incorrect. Gmail / Googlemail provably resolve to one inbox,
 * and Gmail delivers to the undotted/untagged form, so we may safely store it.
 *
 * NOT applied to account (`User.email`): Better Auth looks up the exact address
 * at sign-in, so rewriting it would break login for dotted addresses — and
 * sign-up is already captcha-gated.
 */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Lowercase + trim every address; for Gmail/Googlemail additionally strip dots
 * in the local part, drop any `+tag`, and fold the domain to `gmail.com`.
 * Returns the input lowercased/trimmed for every other domain (no dot/tag
 * stripping). Assumes the caller already validated the address shape.
 */
export function canonicalizeEmailForIdentity(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed; // not a parseable address; caller validated already

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return trimmed;

  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);
  local = local.replace(/\./g, '');

  // Defensive: a degenerate local part (e.g. `+tag@gmail.com`) would be invalid
  // upstream; keep the trimmed original rather than emit `@gmail.com`.
  if (local.length === 0) return trimmed;

  return `${local}@gmail.com`;
}
