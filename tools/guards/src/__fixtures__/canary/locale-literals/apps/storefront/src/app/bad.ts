export const LOCALES = ['fr', 'en'];
export type PairLocale = 'fr' | 'en';
export function pick(locale?: string): string {
  return locale || 'fr';
}
export function pickAgain(locale?: string): string {
  return locale ?? 'en';
}
