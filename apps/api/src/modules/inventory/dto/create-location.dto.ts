import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateInventoryLocationAdminDto {
  @IsString()
  @MaxLength(100)
  name: string;

  /** Uppercase alphanumeric code, used as a stable identifier (e.g. "WH-MAIN", "STORE-01"). */
  @IsString()
  @Matches(/^[A-Z0-9_-]{1,20}$/, {
    message: 'code must be 1–20 uppercase alphanumeric characters, underscores, or hyphens',
  })
  code: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
