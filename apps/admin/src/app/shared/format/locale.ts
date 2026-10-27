import { getLocaleDefinition } from '@common/locale';

/**
 * The single source of human-readable locale names for the admin.
 *
 * Lives in `shared/format` rather than beside the settings screen because four
 * surfaces render a locale name: the settings locale catalogue, the operator's
 * own language picker on `/me`, and the preview tab strips on the notification
 * and campaign editors. The name is the registry's own-language name.
 *
 * Unknown codes render upper-cased rather than blank.
 */
export function localeLabel(code: string): string {
  return getLocaleDefinition(code)?.nativeName ?? code.toUpperCase();
}
