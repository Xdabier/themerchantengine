import { IsBoolean, IsOptional } from 'class-validator';

export class SetDefaultAddressDto {
  @IsOptional()
  @IsBoolean()
  isDefaultShipping?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultBilling?: boolean;
}
