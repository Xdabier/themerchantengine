import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutStorefrontController } from './checkout-storefront.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [PrismaModule, PaymentsModule],
  controllers: [CheckoutController, CheckoutStorefrontController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
