import type { ValidationError } from 'class-validator';

export interface ValidationErrorDetail {
  field: string;
  messages: string[];
}

/**
 * Flattens class-validator's error tree into the `{ field, messages }` details
 * the API error envelope carries.
 *
 * The tree part is the point. A `@ValidateNested()` property that fails carries
 * NO `constraints` of its own: the reasons live on its `children`. The factory
 * this replaces read `Object.values(error.constraints ?? {})` at the top level
 * only, so every nested failure answered
 * `400 {"field":"description","messages":[]}` — a refusal that names the field
 * and then says nothing about it.
 *
 * That is not a cosmetic gap. `rich-text.journey.spec.ts` spent a whole session
 * un-diagnosed behind it, and the same empty array is emitted by at least three
 * different causes on a `Translatable` field: a missing `default`, an unknown
 * locale key that `forbidNonWhitelisted` rejects, and a value that is not an
 * object at all. Nothing in the response distinguishes them.
 *
 * Children are reported under a dotted path (`description.default`), so the
 * field names the property that actually failed. A parent that has both its own
 * constraints and failing children reports both.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  prefix = '',
): ValidationErrorDetail[] {
  return errors.flatMap((error) => {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    const messages = Object.values(error.constraints ?? {});
    const children = error.children?.length ? flattenValidationErrors(error.children, field) : [];

    // Drop a parent that is only a container for its children's failures, so
    // the details list never carries an entry with nothing in it.
    if (messages.length === 0 && children.length > 0) return children;
    return [{ field, messages }, ...children];
  });
}
