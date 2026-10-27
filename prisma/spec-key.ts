/**
 * Hand-maintained copy of `libs/shared/common/src/utils/spec-key.ts`.
 *
 * Why a copy and not an import: the prod runtime image copies `prisma/` but not
 * `libs/` (see `apps/api/Dockerfile`), so `ts-node prisma/seed.ts` inside the
 * container cannot resolve `@common/*`. The seed keeps the same
 * self-containment promise as `prisma/permission-catalogue.ts`.
 *
 * Keep both files identical. `apps/api/src/spec-key.parity.spec.ts` asserts the
 * two folds agree on a shared corpus and turns `npx nx test api` red the moment
 * they drift.
 *
 * Drift here is not cosmetic. `ProductSpec.key` is the uniqueness key behind
 * `@@unique([productId, key])` and the grouping key behind the spec facets, so
 * two folds that disagree split one specification into two that filter
 * separately: the seed would write `materiau` where the API writes `mat-riau`,
 * and the same label on two products would stop matching.
 */

/**
 * Accent-folded, lowercased, hyphen-joined form of a specification label or
 * value. Derived server-side and never accepted from a client.
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
