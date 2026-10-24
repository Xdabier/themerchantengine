/**
 * The display name for a review or an answer.
 *
 * `GET /v1/products/:slug/reviews` returns `user: { id, firstName, lastName }`
 * and has never returned an `authorName`. The storefront read `authorName ?? ''`
 * at every call site, so the author rendered blank in the review list and the
 * product JSON-LD threw on every page carrying a review, because schema.org
 * requires `Review.author.name` and the builder's own schema enforces a minimum
 * of one character.
 *
 * The API already composes this exact name for its admin surface, so the parts
 * were always on the wire. One place derives it now, rather than four call
 * sites each doing something slightly different with a field nothing sets.
 *
 * Returns an empty string when no name can be derived. The caller decides what
 * that means: the JSON-LD builder omits the review, since an unattributable
 * review is not valid structured data, while the review list still shows the
 * rating and the body.
 */
export type ReviewAuthorSource = {
  authorName?: string | null;
  user?: { firstName?: string | null; lastName?: string | null } | null;
};

export function reviewAuthorName(source: ReviewAuthorSource): string {
  const explicit = source.authorName?.trim();
  if (explicit) return explicit;

  const user = source.user;
  if (!user) return '';

  return [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(' ');
}
