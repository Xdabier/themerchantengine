import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { MoneyFormatterService } from './money-formatter.service';

// One-way dependency on settings (§3.1): currencies reads and writes
// `localization.currencyConfig` through SettingsService. Settings never imports
// currencies back — it reads the catalogue from `@common/constants` instead.
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [CurrenciesController],
  providers: [CurrenciesService, MoneyFormatterService],
  exports: [CurrenciesService, MoneyFormatterService],
})
export class CurrenciesModule {}
