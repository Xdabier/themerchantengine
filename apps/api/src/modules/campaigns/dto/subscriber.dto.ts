import { IsEnabledLocaleValue } from '../../../common/dto/translatable-locale-keys.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { SubscriberLocale } from '../campaigns.constants';

/** Public newsletter signup (storefront). `source` is set server-side. */
export class SubscribeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsEnabledLocaleValue()
  locale?: SubscriberLocale;
}

export class ListSubscribersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  pageSize?: number;

  @IsIn(['confirmed', 'pending', 'unsubscribed'])
  @IsOptional()
  status?: 'confirmed' | 'pending' | 'unsubscribed';

  @IsString()
  @MaxLength(50)
  @IsOptional()
  source?: string;

  @IsString()
  @MaxLength(254)
  @IsOptional()
  search?: string;
}

export class UpdateSubscriberDto {
  @IsBoolean()
  unsubscribed!: boolean;
}
