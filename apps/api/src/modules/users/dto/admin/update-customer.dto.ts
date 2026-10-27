import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCustomerAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
