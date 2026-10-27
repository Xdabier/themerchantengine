import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class EstimateShippingDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, {
    message: 'Country must be a valid ISO 3166-1 alpha-2 code (e.g. US, GB)',
  })
  country: string;

  @IsOptional()
  @IsString()
  @Length(3, 10)
  postalCode?: string;
}
