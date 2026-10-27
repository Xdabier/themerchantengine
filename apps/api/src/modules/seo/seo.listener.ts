import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PRODUCT_SLUG_CHANGED_EVENT } from '../products/products.constants';
import { CATEGORY_SLUG_CHANGED_EVENT } from '../categories/categories.constants';
import { SeoService } from './seo.service';

interface SlugChangedPayload {
  oldSlug: string;
  newSlug: string;
}

/**
 * Listens to product and category slug-change events and:
 *   1. Creates a 301 auto-redirect from the old path to the new path.
 *   2. Enqueues a sitemap regeneration job so sitemaps stay fresh.
 *
 * Errors are caught and logged so they never disrupt the originating transaction.
 */
@Injectable()
export class SeoListener {
  private readonly logger = new Logger(SeoListener.name);

  constructor(private readonly seoService: SeoService) {}

  @OnEvent(PRODUCT_SLUG_CHANGED_EVENT, { async: true })
  async onProductSlugChanged(data: SlugChangedPayload): Promise<void> {
    await this.handleSlugChange('products', data);
  }

  @OnEvent(CATEGORY_SLUG_CHANGED_EVENT, { async: true })
  async onCategorySlugChanged(data: SlugChangedPayload): Promise<void> {
    await this.handleSlugChange('categories', data);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async handleSlugChange(prefix: string, data: SlugChangedPayload): Promise<void> {
    try {
      const fromPath = `/${prefix}/${data.oldSlug}`;
      const toPath = `/${prefix}/${data.newSlug}`;
      await this.seoService.upsertAutoRedirect(fromPath, toPath);
      await this.seoService.enqueueSitemapRegeneration();
      this.logger.log(`handleSlugChange: redirect created ${fromPath} → ${toPath}`);
    } catch (err) {
      this.logger.error(
        `handleSlugChange: failed for ${prefix} old=${data.oldSlug}`,
        (err as Error).stack,
      );
    }
  }
}
