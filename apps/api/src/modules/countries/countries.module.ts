import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CountriesController } from './countries.controller';
import { CountriesService } from './countries.service';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [CountriesController],
  providers: [CountriesService],
  exports: [CountriesService],
})
export class CountriesModule {}
