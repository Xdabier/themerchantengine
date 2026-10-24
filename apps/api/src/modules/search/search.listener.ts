import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PRODUCT_MUTATED_EVENT } from '../products/products.constants';
import { SearchService } from './search.service';

interface ProductMutatedPayload {
  productId: string;
}

/**
 * Listens to product mutation events and triggers a per-product tsvector
 * reindex so search results stay fresh without requiring a manual admin reindex.
 * Errors are caught and logged — never disrupt the originating request (M-9).
 */
@Injectable()
export class SearchListener {
  private readonly logger = new Logger(SearchListener.name);

  constructor(private readonly searchService: SearchService) {}

  @OnEvent(PRODUCT_MUTATED_EVENT, { async: true })
  async onProductMutated(data: ProductMutatedPayload): Promise<void> {
    try {
      await this.searchService.reindexProduct(data.productId);
      this.logger.debug(`onProductMutated: reindexed product ${data.productId}`);
    } catch (err) {
      this.logger.error(
        `onProductMutated: failed to reindex product ${data.productId}`,
        (err as Error).stack,
      );
    }
  }
}
