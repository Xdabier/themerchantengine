import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OrderStatus, PaymentStatus } from '@prisma/client';

export class ListOrdersStorefrontDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class ListOrdersAdminDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @Matches(/^(asc|desc)$/i)
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}

/**
 * The body of `POST /v1/orders/track` (finding K10).
 *
 * Both halves of the challenge arrive from an untrusted caller on a `@Public()`
 * route, so both are constrained. The order-number pattern is the format the
 * store issues, `ORD-YYYY-NNNNNN`, kept as a character class rather than an
 * exact shape so a legacy or re-formatted number still resolves; anything
 * outside uppercase, digits and dashes is refused before it reaches Prisma.
 */
export class TrackOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'orderNumber must contain only uppercase letters, digits and dashes',
  })
  orderNumber!: string;

  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;
}
