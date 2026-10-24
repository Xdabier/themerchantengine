import { ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { CURRENCIES } from '../currencies.constants';

const CODES = CURRENCIES.map((c) => c.code);

export class UpdateEnabledCurrenciesDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(CODES, { each: true })
  enabled!: string[];

  @IsString()
  @IsIn(CODES)
  @IsOptional()
  defaultCode?: string;
}
