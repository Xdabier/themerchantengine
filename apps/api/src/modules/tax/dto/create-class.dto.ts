import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateTaxClassAdminDto {
  @IsString()
  zoneId: string;

  /**
   * Human-readable name. Convention: "Standard" | "Reduced" | "Zero-Rated" | "Exempt".
   * Zero-Rated and Exempt names trigger 0% regardless of the stored rate.
   */
  @IsString()
  name: string;

  /** Decimal fraction — e.g. 0.05 = 5%. For Zero-Rated / Exempt, set to 0. */
  @IsNumber()
  @Min(0)
  @Max(1)
  rate: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
