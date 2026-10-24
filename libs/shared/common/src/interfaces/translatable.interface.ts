/**
 * JSONB Translatable type for multilingual content
 * All translatable text fields use this structure: { default: ..., fr: ..., en: ... }
 */
export interface Translatable {
  default: string;
  fr?: string;
  en?: string;
  [key: string]: string | undefined;
}
