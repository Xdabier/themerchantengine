import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SettingsModule } from '../settings/settings.module';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';

// Writes the verdict through the settings service (section 3.1) and reads the
// bound origins from the environment, never from an HTTP-editable row.
@Module({
  imports: [ConfigModule, SettingsModule],
  controllers: [LicenseController],
  providers: [LicenseService],
  exports: [LicenseService],
})
export class LicenseModule {}
