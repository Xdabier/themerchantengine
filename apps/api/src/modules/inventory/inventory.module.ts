import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
