import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TranslatableLocaleKeysDto } from '../../../common/dto/translatable-locale-keys.dto';

/**
 * Minimal Translatable value object for admin-authored text.
 * Top-level `default` is required, and every per-locale key must be declared: the global `whitelist + forbidNonWhitelisted` pipe rejects any property without class-validator metadata, and the index signature below carries none.
 */
export class PaymentTranslatableDto extends TranslatableLocaleKeysDto {
  @IsString()
  @IsNotEmpty()
  default!: string;
}

export type TranslatableValue = {
  default: string;
  [locale: string]: string | undefined;
};

export class OptionalTranslatableDto extends TranslatableLocaleKeysDto {
  @IsString()
  @IsOptional()
  default?: string;
}
