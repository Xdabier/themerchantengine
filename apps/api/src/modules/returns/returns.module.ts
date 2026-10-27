import { Module } from '@nestjs/common';
import { CurrenciesModule } from '../currencies/currencies.module';
import { ConfigModule } from '@nestjs/config';
import { InventoryModule } from '../inventory/inventory.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { OrdersModule } from '../orders/orders.module';
import { ReturnsStorefrontController, ReturnsAdminController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  // OrdersModule for the order state machine (§3.1). No cycle: OrdersModule
  // does not import ReturnsModule.
  imports: [ConfigModule, InventoryModule, GiftCardsModule, OrdersModule, CurrenciesModule],
  controllers: [ReturnsStorefrontController, ReturnsAdminController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
