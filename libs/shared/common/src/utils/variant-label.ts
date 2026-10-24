import { resolveTranslatable } from '../interceptors/translatable.interceptor';

/**
 * The shape every variant-attribute join in this codebase selects.
 */
export type VariantAttributeValueJoin = {
  attributeValue: { value: unknown };
};

/**
 * Snapshots a variant's attribute values as one display string.
 *
 * `CartItem.variantLabel` and `OrderItem.variantLabel` are plain text columns,
 * not Translatable JSONB, so the global interceptor never resolves them: the
 * label has to be resolved at write time. Four call sites joined
 * `attributeValue.value` straight into a string, and every `AttributeValue`
 * row stores a Translatable object, so each of them wrote "[object Object]"
 * once per attribute (finding AD2). They all call this now, which is what
 * stops the four from drifting apart again (§3.14).
 *
 * `locale` is the request's resolved locale, as `parseLocale` returns it:
 * `'default'` when the caller states no preference. Resolution follows the
 * canonical three-rung chain in {@link resolveTranslatable}, so a value the
 * row does not carry in the requested locale still lands on the store default
 * locale then `default` rather than on an empty string.
 *
 * Returns null rather than an empty string when nothing resolves, because the
 * column is nullable and the readers treat null as "no variant distinction".
 */
export function buildVariantLabel(
  attributeValues: readonly VariantAttributeValueJoin[] | null | undefined,
  locale: string,
): string | null {
  if (!attributeValues?.length) return null;

  const parts = attributeValues
    .map((av) => resolveTranslatable(av?.attributeValue?.value, locale))
    .filter((part) => part.length > 0);

  return parts.length ? parts.join(', ') : null;
}
