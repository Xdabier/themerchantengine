import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class LogClickDto {
  @IsString()
  clickedProductId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  clickPosition: number;
}
