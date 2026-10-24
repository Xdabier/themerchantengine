import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CustomerSegmentationProcessor } from './processors/customer-segmentation.processor';
import { CUSTOMER_SEGMENTATION_QUEUE } from './users.constants';

@Module({
  imports: [ConfigModule, BullModule.registerQueue({ name: CUSTOMER_SEGMENTATION_QUEUE })],
  controllers: [UsersController],
  providers: [UsersService, CustomerSegmentationProcessor],
  exports: [UsersService],
})
export class UsersModule {}
