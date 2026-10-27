/**
 * Fallback humanizer for machine enum codes that have no curated label map.
 * Turns `SCREAMING_SNAKE`, `snake_case`, `kebab-case`, and `dotted.codes` into
 * `Title Case`.
 *
 * Prefer an explicit `Record<Enum, string>` colocated with a module's existing
 * `xTone()` util whenever a product vocabulary exists (e.g. status badges,
 * audience segments). Use this only for codes whose friendly form is a pure
 * mechanical transform, or as the `default` arm of such a map.
 */
export function humanizeCode(code: string | null | undefined, fallback = '—'): string {
  if (!code) return fallback;
  const words = code
    .toLowerCase()
    .split(/[\s_\-.]+/)
    .filter(Boolean);
  if (words.length === 0) return fallback;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Resolve a value through an explicit label map, falling back to
 * {@link humanizeCode} for codes the map does not cover. Keeps every enum
 * column readable even if the backend introduces a new code before the map is
 * updated.
 */
export function labelFromMap<T extends string>(
  map: Partial<Record<T, string>>,
  code: T | null | undefined,
  fallback = '—',
): string {
  if (code == null) return fallback;
  return map[code] ?? humanizeCode(code, fallback);
}
