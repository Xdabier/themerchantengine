import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { StoreLocaleRegistry } from './store-locale.registry';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, StoreLocaleRegistry],
  exports: [SettingsService, StoreLocaleRegistry],
})
export class SettingsModule {}
