import { IsOptional, IsString } from 'class-validator';
import { TranslatableLocaleKeysDto } from '../../../common/dto/translatable-locale-keys.dto';

/**
 * Translatable subject/body input. `fr` and `en` are explicitly decorated (not
 * just covered by the index signature) so the global `whitelist` +
 * `forbidNonWhitelisted` ValidationPipe (main.ts §3.5) accepts them — an
 * undecorated property is non-whitelisted and would 400. Mirrors the working
 * `products/dto/translatable.dto.ts` pattern. The catalogue locales are
 * declared by the shared base; the index signature keeps the type open for
 * callers while validation is pinned to the enabled set at runtime.
 */
export class TranslatableBodyDto extends TranslatableLocaleKeysDto {
  @IsString()
  default!: string;
}

export class OptionalTranslatableBodyDto extends TranslatableLocaleKeysDto {
  @IsString()
  @IsOptional()
  default?: string;
}
