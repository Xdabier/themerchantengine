import * as z from 'zod';

/**
 * Storefront ALWAYS sends `Accept-Language: <fr|en>` and never
 * `X-Resolve-Locale: false` (constitution §3.11), so every translatable field
 * arrives back as a plain string from the API. The raw `Translatable` JSONB
 * shape only appears in unwrapped feed/sitemap payloads and the few admin-only
 * endpoints — kept here for the SEO surfaces in S13 and as a defensive
 * fallback.
 */
export interface Translatable {
  default: string;
  [locale: string]: string;
}

export const translatableSchema = z
  .object({ default: z.string() })
  .catchall(z.string()) satisfies z.ZodType<Translatable>;

/**
 * Storefront-resolved string field. Accepts a plain string (the normal case)
 * and falls back to the raw Translatable shape when the API surface skips
 * locale resolution (sitemap, llms.txt) so the same schema can be reused.
 */
export const resolvedStringSchema = z.union([z.string(), translatableSchema]);
export type ResolvedString = z.infer<typeof resolvedStringSchema>;

/** Pick the best display string from either shape. */
export function pickTranslation(
  value: ResolvedString | null | undefined,
  preferredLocale: string,
): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[preferredLocale] ?? value.default ?? '';
}
