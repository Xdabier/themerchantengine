/**
 * The one phone-number rule for customer-entered numbers.
 *
 * The rule used to be `/^\+?[0-9]{6,15}$/` applied straight to the typed
 * string, copied into three DTOs and three storefront forms. It rejected
 * `+218 91 000 0000`, which is how a number is written with the spacing its
 * country uses, including the store's own contact number, while
 * `+218910000000` went through. A customer who types their number the way it is
 * printed on the invoice got "Enter a valid phone number".
 *
 * Separators are presentation, so they are stripped before the number is
 * validated and before it is stored: what lands in the database is the digits
 * and an optional leading `+`, which is the form every downstream consumer
 * (mail, invoice, carrier handoff) actually wants.
 *
 * The storefront mirror is `apps/storefront/src/lib/phone.ts`. It cannot import
 * this file: `@common/*` is a backend lib and the module-boundary rule keeps
 * the storefront out of it. The two are kept in step by
 * `docs/storefront-api-reference.md`, which documents this rule once.
 */

/** Characters a person uses to group digits, and which carry no information. */
const PHONE_SEPARATORS = /[\s().-]/g;

/** The stored form: optional `+`, then 6 to 15 digits, nothing else. */
export const PHONE_RE = /^\+?[0-9]{6,15}$/;

/**
 * Strips grouping characters so `+216 71 000 000` and `+21671000000` are the
 * same number. Non-strings pass through untouched for `@IsString()` to reject
 * with its own message.
 */
export function normalizePhone(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(PHONE_SEPARATORS, '') : value;
}
