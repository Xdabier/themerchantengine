import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { CurrenciesModule } from '../currencies/currencies.module';
import { GiftCardsController } from './gift-cards.controller';
import { GiftCardsService } from './gift-cards.service';
import { GiftCardReconciliationProcessor } from './processors/gift-card-reconciliation.processor';
import { GIFT_CARD_RECONCILIATION_QUEUE } from './gift-cards.constants';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: GIFT_CARD_RECONCILIATION_QUEUE }),
    // Admin-issued cards are validated against the enabled currency set (§3.1:
    // service injection, no cross-module Prisma reads).
    CurrenciesModule,
  ],
  controllers: [GiftCardsController],
  providers: [GiftCardsService, GiftCardReconciliationProcessor],
  exports: [GiftCardsService],
})
export class GiftCardsModule {}
