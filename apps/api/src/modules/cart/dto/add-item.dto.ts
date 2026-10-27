import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class AddItemDto {
  @IsString()
  @IsNotEmpty()
  variantId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
