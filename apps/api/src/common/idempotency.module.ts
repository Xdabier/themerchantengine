import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { IDEMPOTENCY_REDIS_CLIENT } from './idempotency.constants';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKeyPipe } from './decorators/idempotency-key.decorator';

/**
 * Global module that wires the shared `IdempotencyService` + Redis client +
 * pipe across every sensitive-write controller. Marked `@Global()` so each
 * module that needs the service injects it without re-importing.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: IDEMPOTENCY_REDIS_CLIENT,
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
    IdempotencyService,
    IdempotencyKeyPipe,
  ],
  exports: [IdempotencyService, IdempotencyKeyPipe, IDEMPOTENCY_REDIS_CLIENT],
})
export class IdempotencyModule {}
