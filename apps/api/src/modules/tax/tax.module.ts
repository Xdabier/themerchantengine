import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';
import { TAX_REDIS_CLIENT } from './tax.constants';

@Module({
  imports: [ConfigModule],
  controllers: [TaxController],
  providers: [
    TaxService,
    {
      provide: TAX_REDIS_CLIENT,
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
  exports: [TaxService],
})
export class TaxModule {}
