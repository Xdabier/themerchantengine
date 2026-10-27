/**
 * The phone-number rule the address and profile forms enforce.
 *
 * It used to be `/^\+?[0-9]{6,15}$/` applied to the typed string, copied into
 * three components. That rejects `+218 21 000 000`, which is how a local
 * number is written everywhere in this repo, including the store's own seeded
 * contact number, while `+21671000000` was accepted. The form refused the
 * format the site itself prints.
 *
 * So grouping characters are allowed anywhere and the digit count is what is
 * enforced: an optional `+`, then 6 to 15 digits, with spaces, dots, hyphens
 * and parentheses free to sit between them. The API accepts the same set and
 * strips the separators before storing, so the form and the endpoint agree on
 * exactly which strings are numbers.
 *
 * Authority: `docs/storefront-api-reference.md`, mirrored server-side in
 * `libs/shared/common/src/utils/phone.ts`. This file cannot import that one:
 * `@common/*` is a backend lib and the module-boundary rule keeps the
 * storefront out of it.
 */
export const PHONE_RE = /^\+?(?:[\s().-]*[0-9]){6,15}[\s().-]*$/;
