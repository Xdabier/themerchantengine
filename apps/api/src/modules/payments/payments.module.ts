import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PAYMENT_PROVIDER_IMPLEMENTATIONS } from './payment-providers';
import { PAYMENT_PROVIDERS } from './payments.constants';
import type { PaymentProvider } from './providers/payment-provider.interface';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentMethodsController],
  providers: [
    PaymentMethodsService,
    ...PAYMENT_PROVIDER_IMPLEMENTATIONS,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (...providers: PaymentProvider[]) => providers,
      inject: [...PAYMENT_PROVIDER_IMPLEMENTATIONS],
    },
    PaymentProviderRegistry,
    PaymentGatewayService,
  ],
  exports: [PaymentMethodsService, PaymentProviderRegistry, PaymentGatewayService],
})
export class PaymentsModule {}
