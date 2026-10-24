import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ProductsModule } from '../products/products.module';
import { CategoriesModule } from '../categories/categories.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { ReturnsModule } from '../returns/returns.module';
import { StorefrontConfigModule } from '../storefront-config/storefront-config.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { StorageModule } from './storage/storage.module';
import { ImageProcessingProcessor } from './processors/image-processing.processor';
import { VideoProcessingProcessor } from './processors/video-processing.processor';
import { IMAGE_PROCESSING_QUEUE, VIDEO_PROCESSING_QUEUE } from './assets.constants';

@Module({
  imports: [
    ConfigModule,
    StorageModule,
    BullModule.registerQueue({ name: IMAGE_PROCESSING_QUEUE }, { name: VIDEO_PROCESSING_QUEUE }),
    ProductsModule,
    CategoriesModule,
    ReviewsModule,
    ReturnsModule,
    forwardRef(() => StorefrontConfigModule),
  ],
  controllers: [AssetsController],
  providers: [AssetsService, ImageProcessingProcessor, VideoProcessingProcessor],
  exports: [AssetsService],
})
export class AssetsModule {}
