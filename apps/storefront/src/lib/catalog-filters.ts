/**
 * Shared decoders for catalogue filter state.
 *
 * The specification filter travels as one comma-joined `specs` query param
 * carrying `key:value` tokens, rather than one param per specification. That is
 * forced by the API client's serialiser, which types its query as
 * `Record<string, string | number | boolean | null | undefined>` and appends one
 * entry per key: an array would stringify to `a,b` by accident, so the joined
 * form makes the accident the contract. A single param also lets
 * `queryParamsHandling: 'merge'` clear the whole selection with `null` without
 * disturbing brand, price or sort.
 *
 * These live here rather than on a page because three pages consume them
 * (catalog index, catalog by category, search) and the price-band decoder is
 * already copy-pasted byte for byte into all three.
 */

/** `["certification:ce-iso", "certification:ce"]` -> `{ certification: [...] }`. */
export function groupSpecTokens(tokens: readonly string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const token of tokens) {
    const sep = token.indexOf(':');
    if (sep <= 0 || sep === token.length - 1) continue;
    const key = token.slice(0, sep);
    const value = token.slice(sep + 1);
    const current = grouped[key] ?? [];
    if (!current.includes(value)) grouped[key] = [...current, value];
    else grouped[key] = current;
  }
  return grouped;
}

/** The inverse, for building a query param out of rail state. */
export function flattenSpecSelection(selection: Record<string, string[]>): string[] {
  return Object.entries(selection).flatMap(([key, values]) =>
    values.map((value) => `${key}:${value}`),
  );
}

/** Parse the `specs` query param straight into rail state. */
export function readSpecParam(raw: string | null | undefined): Record<string, string[]> {
  return groupSpecTokens((raw ?? '').split(',').filter(Boolean));
}
