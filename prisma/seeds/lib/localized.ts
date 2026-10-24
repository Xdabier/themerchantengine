import { registryLocaleCodes } from '../../../libs/shared/common/src/locale/locale-registry';

/**
 * Translatable JSONB shape per `agent_docs/i18n.md` and the storefront
 * `translatableSchema` (`libs/storefront-types/src/lib/shared/translatable.ts`).
 * Carries `default` (English convention) and one key per registry locale.
 */
export interface Translatable {
  default: string;
  [locale: string]: string;
}

/**
 * Build a Translatable from a locale map. Every registry locale must be present
 * and non-empty (constitution §3.2 forbids English fallback at write time), and
 * a key outside the registry is a typo.
 */
export function localized(values: Record<string, string>): Translatable {
  const codes = registryLocaleCodes();
  for (const key of Object.keys(values)) {
    if (!codes.includes(key as (typeof codes)[number])) {
      throw new Error(`Translatable has unknown locale "${key}"`);
    }
  }
  const out: Translatable = { default: '' };
  for (const code of codes) {
    const value = values[code];
    if (!value || !value.trim()) {
      throw new Error(`Translatable.${code} must be non-empty`);
    }
    out[code] = value;
  }
  out.default = values['en'] ?? out[codes[0]];
  return out;
}
