import { ArrayMinSize, IsArray, IsOptional } from 'class-validator';
import { IsRegistryLocale } from '../../../common/dto/translatable-locale-keys.dto';

/**
 * Update supported locales, default locale and the right-to-left set.
 *
 * Every value must be a locale in the language registry; the service holds the
 * default to being inside the supported set and the right-to-left set to being
 * a subset of it.
 */
export class UpdateLocalesDto {
  /** Supported locale codes, drawn from the registry. */
  @IsArray()
  @ArrayMinSize(1)
  @IsRegistryLocale({ each: true })
  supportedLocales: string[];

  /** Default locale when Accept-Language is not provided or unsupported. */
  @IsRegistryLocale()
  defaultLocale: string;

  /** Locales rendered right-to-left. Left out, the stored set is kept. */
  @IsOptional()
  @IsArray()
  @IsRegistryLocale({ each: true })
  rtlLocales?: string[];
}
