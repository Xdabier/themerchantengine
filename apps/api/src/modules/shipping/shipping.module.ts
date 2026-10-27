import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { SHIPPING_REDIS_CLIENT } from './shipping.constants';

@Module({
  imports: [ConfigModule],
  controllers: [ShippingController],
  providers: [
    ShippingService,
    {
      provide: SHIPPING_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 56379),
          password: config.get<string>('REDIS_PASSWORD'),
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: true,
        }),
    },
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
