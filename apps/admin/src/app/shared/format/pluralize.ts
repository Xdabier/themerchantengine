/**
 * Count + noun in real English (plan E, finding E8).
 *
 * The admin shipped "1 variant(s)" in six places. `(s)` is a note to the reader
 * that the software did not bother, and it reads worse the more often it shows
 * up on a screen.
 *
 * Regular nouns just take an `s`; pass `plural` for anything irregular.
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralUnit(count, singular, plural)}`;
}

/** The noun alone, without the count — for sentences that phrase the number differently. */
export function pluralUnit(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
