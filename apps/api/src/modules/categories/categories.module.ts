import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CATEGORIES_REDIS_CLIENT } from './categories.constants';

@Module({
  imports: [ConfigModule],
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    {
      provide: CATEGORIES_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 56379),
          password: config.get<string>('REDIS_PASSWORD'),
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: true,
        });
      },
    },
  ],
  exports: [CategoriesService],
})
export class CategoriesModule {}
