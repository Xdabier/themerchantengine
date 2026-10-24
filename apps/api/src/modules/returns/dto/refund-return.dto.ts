import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReturnRefundMethod } from '@prisma/client';

export class RefundReturnDto {
  @IsEnum(ReturnRefundMethod)
  refundMethod!: ReturnRefundMethod;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
