import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TEMPLATE_CHANNELS, type TemplateChannel } from './template.dto';

export class ListTemplatesDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }) => Number(value))
  page?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Transform(({ value }) => Number(value))
  pageSize?: number;

  @IsIn(TEMPLATE_CHANNELS)
  @IsOptional()
  channel?: TemplateChannel;

  @IsString()
  @IsOptional()
  event?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isEnabled?: boolean;
}
