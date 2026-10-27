import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartAbandonedProcessor } from './processors/cart-abandoned.processor';
import { CART_ABANDONED_QUEUE, CART_ABANDONED_JOB } from './cart.constants';
import { InventoryModule } from '../inventory/inventory.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { ShippingModule } from '../shipping/shipping.module';
import { TaxModule } from '../tax/tax.module';
import { WishlistModule } from '../wishlist/wishlist.module';

@Module({
  imports: [
    // BullMQ queue for abandoned-cart detection (scans every 15 minutes)
    BullModule.registerQueue({ name: CART_ABANDONED_QUEUE }),
    EventEmitterModule.forRoot(),
    InventoryModule,
    PromotionsModule,
    GiftCardsModule,
    ShippingModule,
    TaxModule,
    WishlistModule,
  ],
  controllers: [CartController],
  providers: [CartService, CartAbandonedProcessor],
  exports: [CartService],
})
export class CartModule {
  // Repeatable job is registered in the service via onModuleInit if needed.
  // For simplicity, the job can also be scheduled via a separate bootstrap hook.
  static readonly abandonedJobConfig = {
    name: CART_ABANDONED_JOB,
    // Runs every 15 minutes
    opts: { repeat: { pattern: '*/15 * * * *' } },
  } as const;
}
