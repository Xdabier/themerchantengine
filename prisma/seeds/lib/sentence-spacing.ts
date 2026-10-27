/**
 * Restore the space after a full stop that the Gemini enrichment dropped.
 *
 * Plan H, phase H4. Findings H2 and E9. The ingest scripts wrote enriched
 * English copy into the catalogues verbatim, so joins like `Gulf.At the heart`
 * and `base.Using this mask` reached the seed, the databases, and the live
 * storefront. Roughly 26 of them sit in the committed catalogue JSON, and the
 * same enrichment pipeline produced the older general-goods copy, so the class
 * is wider than the one product the finding cites.
 *
 * One rule, applied in three places, because a fix in only one of them leaves
 * the other two to reintroduce it:
 *   1. the ingest scripts, so a future enrichment is clean at the source;
 *   2. the committed catalogue JSON, so a seed of a NEW row is clean;
 *   3. a database patch, because the seeds use `createMany` with
 *      `skipDuplicates`, so re-seeding never repairs a row that already exists.
 */

/**
 * Two lowercase letters, a full stop, then a capital and a lowercase letter.
 *
 * Plan H decision D7 wrote the tail as `[A-Z][a-z]{2}`, which does not match
 * `Gulf.At`, the finding's own headline example: `At` is a capital and ONE
 * lowercase letter before the space. Two-letter openers are common in this
 * copy (`At`, `It`, `In`, `As`, `We`), so the tail is one lowercase letter.
 *
 * The head is what keeps the rule safe, and it is why nothing else needs
 * special-casing. Requiring TWO lowercase letters before the stop rules out:
 *   - decimals and prices, where the stop follows a digit (`2.5`, `10.50`);
 *   - abbreviations, where the stop follows a single letter or a capital
 *     (`e.g.`, `i.e.`, `U.S.`, `Dr.`);
 *   - domains and emails, where a lowercase letter follows the stop
 *     (`the storefront`).
 * And it only ever inserts a space, so applying it twice changes nothing.
 */
const JOINED_SENTENCE = /([a-z]{2})\.([A-Z][a-z])/g;

/** Repair every joined sentence in a string. Idempotent. */
export function fixSentenceSpacing(text: string): string {
  return text.replace(JOINED_SENTENCE, '$1. $2');
}

/**
 * Repair the `en` and `default` members of a Translatable, and nothing else.
 *
 * The defect is an artifact of the ENGLISH enrichment. French and Arabic copy
 * came from a different path, and this rule was never validated against
 * either, so it must not touch them.
 *
 * Returns the value it was given, by reference, when nothing changed. The
 * patch script decides whether to issue an UPDATE by identity, so a helper
 * that always allocated would make every row look dirty and rewrite the whole
 * catalogue on every run.
 */
export function fixTranslatableSpacing<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const source = value as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...source };

  for (const key of ['default', 'en'] as const) {
    const current = source[key];
    if (typeof current !== 'string') continue;
    const fixed = fixSentenceSpacing(current);
    if (fixed !== current) {
      next[key] = fixed;
      changed = true;
    }
  }

  return changed ? (next as T) : value;
}
