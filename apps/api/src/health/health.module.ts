import { Module } from '@nestjs/common';
import { HealthController, HealthIdentityController } from './health.controller';

@Module({
  controllers: [HealthController, HealthIdentityController],
})
export class HealthModule {}
