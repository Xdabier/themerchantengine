import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PRODUCT_SLUG_CHANGED_EVENT } from '../products/products.constants';
import { CATEGORY_SLUG_CHANGED_EVENT } from '../categories/categories.constants';
import { GeoService } from './geo.service';

/**
 * Triggers llms.txt regeneration whenever a product or category slug changes.
 * Errors are caught and logged so they never disrupt the originating transaction.
 */
@Injectable()
export class GeoListener {
  private readonly logger = new Logger(GeoListener.name);

  constructor(private readonly geoService: GeoService) {}

  @OnEvent(PRODUCT_SLUG_CHANGED_EVENT, { async: true })
  async onProductSlugChanged(): Promise<void> {
    await this.triggerRegeneration('product.slug.changed');
  }

  @OnEvent(CATEGORY_SLUG_CHANGED_EVENT, { async: true })
  async onCategorySlugChanged(): Promise<void> {
    await this.triggerRegeneration('category.slug.changed');
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async triggerRegeneration(event: string): Promise<void> {
    try {
      await this.geoService.enqueueLlmsRegeneration();
      this.logger.log(`triggerRegeneration: llms.txt regen enqueued (event=${event})`);
    } catch (err) {
      this.logger.error(
        `triggerRegeneration: failed to enqueue (event=${event})`,
        (err as Error).stack,
      );
    }
  }
}
