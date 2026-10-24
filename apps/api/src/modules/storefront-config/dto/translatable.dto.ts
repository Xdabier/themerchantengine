import { IsNotEmpty, IsString } from 'class-validator';
import { TranslatableLocaleKeysDto } from '../../../common/dto/translatable-locale-keys.dto';

export class TranslatableDto extends TranslatableLocaleKeysDto {
  @IsString()
  @IsNotEmpty()
  default: string;
}
