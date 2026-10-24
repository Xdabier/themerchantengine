import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { OptionalTranslatableDto } from './translatable.dto';

export class UpdateCarrierDto {
  @ValidateNested()
  @Type(() => OptionalTranslatableDto)
  @IsOptional()
  name?: OptionalTranslatableDto;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  services?: string[];

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(250)
  @IsString({ each: true })
  @Matches(/^[A-Z]{2}$/, { each: true })
  @IsOptional()
  zones?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;
}
