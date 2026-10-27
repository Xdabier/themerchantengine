import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PHONE_RE, normalizePhone } from '@common/utils';

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsString()
  @MaxLength(100)
  fullName: string;

  @IsString()
  // Grouping characters are stripped first, so `+216 71 000 000` and
  // `+21671000000` are the same number and only one form is stored.
  @Transform(({ value }) => normalizePhone(value))
  @Matches(PHONE_RE, { message: 'Invalid phone number format' })
  phone: string;

  @IsString()
  @MaxLength(255)
  addressLine1: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsString()
  @MaxLength(100)
  city: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'Country must be a valid ISO 3166-1 alpha-2 code (e.g. US, GB)',
  })
  country: string;

  @IsOptional()
  @IsBoolean()
  isDefaultShipping?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultBilling?: boolean;
}
