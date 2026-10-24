import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TranslatableLocaleKeysDto } from '../../../common/dto/translatable-locale-keys.dto';

export class CarrierTranslatableDto extends TranslatableLocaleKeysDto {
  @IsString()
  @IsNotEmpty()
  default!: string;
}

export class OptionalTranslatableDto extends TranslatableLocaleKeysDto {
  @IsString()
  @IsOptional()
  default?: string;
}
