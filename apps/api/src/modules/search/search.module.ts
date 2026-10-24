import { Module } from '@nestjs/common';
import { SearchStorefrontController, SearchAdminController } from './search.controller';
import { SearchService } from './search.service';
import { SearchListener } from './search.listener';
import { GlobalSearchController } from './global-search.controller';
import { GlobalSearchService } from './global-search.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [SearchStorefrontController, SearchAdminController, GlobalSearchController],
  providers: [SearchService, SearchListener, GlobalSearchService],
  exports: [SearchService, GlobalSearchService],
})
export class SearchModule {}
