import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PAYMENT_PROVIDER_IDS, type PaymentProviderId } from './create-payment-method.dto';

export class ListPaymentMethodsDto {
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

  @IsIn(PAYMENT_PROVIDER_IDS)
  @IsOptional()
  provider?: PaymentProviderId;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;
}
