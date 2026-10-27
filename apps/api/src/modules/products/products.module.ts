import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ProductsStorefrontController } from './products-storefront.controller';
import { ProductsAdminController } from './products-admin.controller';
import { ProductsService } from './products.service';
import { PRODUCTS_REDIS_CLIENT } from './products.constants';
import { InventoryModule } from '../inventory/inventory.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [ConfigModule, InventoryModule, CategoriesModule],
  controllers: [ProductsStorefrontController, ProductsAdminController],
  providers: [
    ProductsService,
    {
      provide: PRODUCTS_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 56379),
          password: config.get<string>('REDIS_PASSWORD'),
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: true,
        });
      },
    },
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
