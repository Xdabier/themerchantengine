import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TranslatableLocaleKeysDto } from '../../../common/dto/translatable-locale-keys.dto';

/**
 * A Translatable whose content is required, for a field that must carry a
 * value: a name, a title, a label.
 */
export class TranslatableDto extends TranslatableLocaleKeysDto {
  @IsString()
  @IsNotEmpty()
  default: string;
}

/**
 * A Translatable whose content may be empty, for an OPTIONAL field: a
 * description, a meta description, an intro.
 *
 * The distinction is not pedantry, it is the only way to clear one of these.
 * With `@IsNotEmpty()` on `default` there was no payload that removed a value:
 * `null` is skipped by `@IsOptional()` so the old value survived, `{}` failed
 * the nested shape, and `{ default: '' }` failed `@IsNotEmpty()`. An operator
 * who typed a category description could never take it back out, and reading a
 * cleared row and writing it back unchanged answered 400.
 *
 * `default` stays declared rather than dropped, so a payload carrying an
 * unknown locale key is still refused by `forbidNonWhitelisted`: the whitelist
 * is decorator-driven, and a TypeScript index signature would not allowlist
 * anything.
 */
export class OptionalContentTranslatableDto extends TranslatableLocaleKeysDto {
  @IsOptional()
  @IsString()
  default?: string;
}
