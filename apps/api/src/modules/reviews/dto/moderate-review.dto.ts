import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerateReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
