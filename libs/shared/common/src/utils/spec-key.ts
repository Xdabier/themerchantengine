/**
 * Canonical home of the specification-key fold, for everything that can resolve
 * `@common/*`.
 *
 * `prisma/spec-key.ts` carries a hand-maintained copy of the same function,
 * because the prod runtime image copies `prisma/` but not `libs/` (see
 * `apps/api/Dockerfile`) and `prisma/seed.ts` therefore cannot import this file.
 * Keep the two identical; `apps/api/src/spec-key.parity.spec.ts` fails the api
 * suite the moment they disagree.
 *
 * Drift is not cosmetic. `ProductSpec.key` is the uniqueness key behind
 * `@@unique([productId, key])` and the grouping key behind the spec facets, so
 * two folds that disagree split one specification into two that filter
 * separately.
 *
 * Deliberately NOT `toSlug` from the products service. That one normalises with
 * NFD, strips a different character class and applies no length cap, so reusing
 * it here would fragment rows the seed already wrote.
 */

/**
 * Accent-folded, lowercased, hyphen-joined form of a specification label or
 * value. Derived server-side and never accepted from a client, because it is
 * the uniqueness key: a supplied value is both a silent-overwrite vector on the
 * product and a way to poison the cross-product label autocomplete.
 *
 * NFKD splits a precomposed letter into its base plus a combining mark, which
 * `\p{Diacritic}` then strips, so "Matériau" and "Materiau" both fold to
 * `materiau` rather than fragmenting into two specifications. The 120-character
 * cap bounds an indexed column fed by free-text input.
 */
export function specKey(text: string): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
