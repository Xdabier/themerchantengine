import { registryLocaleCodes } from '@common/locale/locale-registry';

type Tree = { [key: string]: unknown };

function isTree(value: unknown): value is Tree {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The source with every missing or empty leaf taken from the fallback.
 * Neither argument is mutated.
 */
export function mergeWithFallback<T>(source: unknown, fallback: T): T {
  if (isTree(fallback)) {
    const from = isTree(source) ? source : {};
    const out: Tree = {};
    for (const key of Object.keys(fallback)) out[key] = mergeWithFallback(from[key], fallback[key]);
    for (const key of Object.keys(from)) if (!(key in out)) out[key] = from[key];
    return out as T;
  }
  if (source === undefined || source === null || source === '') return fallback;
  return source as T;
}

/**
 * One catalogue per registry locale. A locale that lacks a key serves the
 * default locale's string for it, so a new language ships before it is fully
 * translated (DR-33).
 */
export function buildCatalogues<T>(
  sources: Readonly<Record<string, unknown>>,
  defaultLocale: string,
): Record<string, T> {
  const base = sources[defaultLocale] as T;
  const built: Record<string, T> = {};
  for (const code of registryLocaleCodes()) {
    built[code] = mergeWithFallback(sources[code], base);
  }
  return built;
}
