import { Module } from '@nestjs/common';
import { CurrenciesModule } from '../currencies/currencies.module';
import { ConfigModule } from '@nestjs/config';
import { OrdersService } from './orders.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { OrdersStorefrontController, OrdersAdminController } from './orders.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { GiftCardsModule } from '../gift-cards/gift-cards.module';
import { ShippingModule } from '../shipping/shipping.module';
import { TaxModule } from '../tax/tax.module';
import { CartModule } from '../cart/cart.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../assets/storage/storage.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { PaymentsModule } from '../payments/payments.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { GuestOrderClaimListener } from './guest-order-claim.listener';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';

@Module({
  imports: [
    ConfigModule,
    InventoryModule,
    PromotionsModule,
    GiftCardsModule,
    ShippingModule,
    TaxModule,
    CartModule,
    SettingsModule,
    CurrenciesModule,
    StorageModule,
    // Guest checkout is gated on the operator's `guestCheckoutEnabled` setting,
    // read through the owning module's service (constitution §3.1).
    CheckoutModule,
    // The enabled tender set is owned by the payments module and read through
    // its exported service (constitution §3.1); orders never touch
    // `prisma.paymentMethod`, which is what keeps the secrets-bearing `config`
    // column to a single read path.
    PaymentsModule,
    // Payment webhooks dedup through ProcessedWebhookService.
    WebhooksModule,
  ],
  controllers: [OrdersStorefrontController, OrdersAdminController, PaymentWebhookController],
  providers: [OrdersService, InvoicePdfService, GuestOrderClaimListener, PaymentWebhookService],
  exports: [OrdersService],
})
export class OrdersModule {}
