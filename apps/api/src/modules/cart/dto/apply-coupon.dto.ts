import { IsString, Matches, MaxLength } from 'class-validator';

export class ApplyCouponDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/i, { message: 'code must contain only letters, digits, - or _' })
  code: string;
}
