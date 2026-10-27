import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RestockDecision } from '@prisma/client';

export class ReceiveReturnItemDto {
  @IsString()
  @IsNotEmpty()
  returnItemId!: string;

  @IsEnum(RestockDecision)
  restockDecision!: RestockDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReceiveReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveReturnItemDto)
  items!: ReceiveReturnItemDto[];
}
