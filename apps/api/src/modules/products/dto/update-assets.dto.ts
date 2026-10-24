import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AssetAssignmentDto {
  @IsString()
  assetId: string;

  @IsInt()
  @Min(0)
  sortOrder: number;

  @IsBoolean()
  isPrimary: boolean;
}

export class UpdateProductAssetsAdminDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AssetAssignmentDto)
  assets: AssetAssignmentDto[];
}
