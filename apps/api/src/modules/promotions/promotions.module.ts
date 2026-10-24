import { Module } from '@nestjs/common';
import { CurrenciesModule } from '../currencies/currencies.module';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [CurrenciesModule],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
