import { Module } from '@nestjs/common';
import { ReviewsStorefrontController, ReviewsAdminController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [ReviewsStorefrontController, ReviewsAdminController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
