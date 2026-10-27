import { IsBoolean, IsISO8601, IsOptional } from 'class-validator';

export class ToggleVisibilityAdminDto {
  @IsBoolean()
  isVisible: boolean;

  @IsOptional()
  @IsISO8601()
  visibleFrom?: string;

  @IsOptional()
  @IsISO8601()
  visibleUntil?: string;
}
