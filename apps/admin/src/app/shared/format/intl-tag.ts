import { getLocaleDefinition } from '@common/locale';

/** Deliberate display pin, not a fallback step: admin numbers and dates read the same everywhere. */
export const ADMIN_FORMAT_LOCALE = 'en';

/** Registry Intl tag with western digits, so an Arabic locale still prints 0-9. */
export function adminIntlTag(locale: string = ADMIN_FORMAT_LOCALE): string {
  const definition = getLocaleDefinition(locale) ?? getLocaleDefinition(ADMIN_FORMAT_LOCALE);
  return `${definition?.intlTag}-u-nu-latn`;
}
