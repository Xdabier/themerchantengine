import { ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { COUNTRIES } from '../countries.constants';

const CODES = COUNTRIES.map((c) => c.code);

export class UpdateEnabledCountriesDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(CODES, { each: true })
  enabled!: string[];

  @IsString()
  @IsIn(CODES)
  @IsOptional()
  defaultCode?: string;
}
