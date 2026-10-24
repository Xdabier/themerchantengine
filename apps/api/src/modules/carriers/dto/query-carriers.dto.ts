import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CARRIER_PROVIDERS, type CarrierProvider } from './create-carrier.dto';

export class ListCarriersDto {
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

  @IsIn(CARRIER_PROVIDERS)
  @IsOptional()
  provider?: CarrierProvider;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;
}
