import { z } from 'zod';

/**
 * Per spec §02, every user-facing text field is stored as a JSONB object with
 * a required `default` string and arbitrary locale-keyed strings.
 *
 * Backend behavior:
 * - Storefront reads resolve to the user's Accept-Language locale.
 * - Admin reads with `X-Resolve-Locale: false` return the raw object.
 *
 * Locales come from the store settings (the locale registry). Do NOT hardcode
 * them here; always drive UI locale tabs from the settings service so new
 * locales flow through automatically.
 */
export interface Translatable {
  default: string;
  [locale: string]: string;
}

export const translatableSchema = z
  .object({ default: z.string() })
  .catchall(z.string()) satisfies z.ZodType<Translatable>;

/** Optional variant, some backend fields may accept `null`. */
export const translatableNullableSchema = translatableSchema.nullable();

/**
 * Translatable with an OPTIONAL `default` key. Some entities persist only
 * locale keys (the NE3 notification-template bodies are seeded as body-only
 * blocks keyed by the store's locales, and the mail renderer resolves the
 * requested locale then the store default then the second locale, never
 * `default`). Parsing those rows with the strict `translatableSchema` would
 * throw and surface "Could not load" on the admin screen (the schema-drift bug
 * class). Use this variant for response/request fields whose backend shape may
 * omit `default`.
 */
export const optionalDefaultTranslatableSchema = z
  .object({ default: z.string().optional() })
  .catchall(z.string());
export type OptionalDefaultTranslatable = z.infer<typeof optionalDefaultTranslatableSchema>;

/**
 * When admin asks the backend to resolve a locale (storefront semantics), the
 * response is a plain string rather than a Translatable. This helper covers the
 * union.
 */
export const resolvedStringSchema = z.union([z.string(), translatableSchema]);
export type ResolvedString = z.infer<typeof resolvedStringSchema>;

/** Build an empty Translatable for form initialization. */
export function emptyTranslatable(defaultValue = ''): Translatable {
  return { default: defaultValue };
}

/**
 * Pick the best display string for a Translatable given a preferred locale.
 *
 * This is the single canonical reducer for admin display surfaces. Admin reads
 * send `X-Resolve-Locale: false` (constitution §3.2), so name fields arrive as
 * the raw `{ default, fr, en }` object. Binding one directly into a template
 * renders "[object Object]". Always reduce through this (or the `| translatable`
 * pipe that wraps it) before display.
 *
 * Resolution order: preferred locale → store default locale (when the caller
 * passes it) → `default` → first populated locale → `fallback`. `default` may
 * differ from every locale value, so the store default rung matters. Idempotent
 * on already-resolved strings, so it is safe to call even where the backend
 * resolved the value server-side.
 */
export function pickTranslation(
  value: Translatable | string | null | undefined,
  preferredLocale: string,
  fallback: string,
  defaultLocale: string,
): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  const map = value as Record<string, unknown>;
  const at = (key: string): string | undefined => {
    const v = map[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  return (
    at(preferredLocale) ??
    at(defaultLocale) ??
    at('default') ??
    Object.values(map).find((v): v is string => typeof v === 'string' && v.length > 0) ??
    fallback
  );
}
