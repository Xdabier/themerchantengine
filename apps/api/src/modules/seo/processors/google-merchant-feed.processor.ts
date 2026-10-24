import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { tryPickVariantUrl } from '@common/asset-variants';
import { formatAmount } from '@common/money';
// Three-rung Translatable chain (§02). A local two-rung copy here would emit
// `default` for a product still missing its `fr` translation, while a French
// customer looking at the same product sees the `en` text the interceptor
// falls through to. Google would be reading a different catalogue.
import { resolveTranslatable } from '@common/interceptors';
import { PrismaService } from '../../../prisma/prisma.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import {
  GOOGLE_MERCHANT_FEED_QUEUE,
  GOOGLE_MERCHANT_FEED_JOB,
  GOOGLE_MERCHANT_FEED_CRON,
  GOOGLE_MERCHANT_FEED_CACHE_KEY,
  GOOGLE_MERCHANT_FEED_TTL_SECONDS,
  SEO_REDIS_CLIENT,
  defaultLocale,
} from '../seo.constants';
import { entityPath, resolvePublicBaseUrl } from '../site-url';
import { SEO_SETTINGS_SERVICE } from '../seo.constants';
import type { SeoSettingsReader } from '../seo.service';

/** Feed items link to the default-locale URL. Google wants one canonical
 * landing page per item, not the locale fan-out the sitemap advertises. */
const feedLocale = (): string => defaultLocale();

/** The channel description, in the feed locale: the store name plus the word for its catalogue.
 * A locale with no copy ships the bare store name. */
const CHANNEL_DESCRIPTION: Record<string, (storeName: string) => string> = {
  fr: (name) => `Catalogue ${name}`,
  en: (name) => `${name} catalogue`,
  ar: (name) => `كتالوج ${name}`,
};

/** CDATA cannot contain its own terminator, so a description carrying `]]>`
 * would close the section early and corrupt every item after it. */
function cdata(text: string): string {
  return '<![CDATA[' + text.split(']]>').join(']]]]><![CDATA[>') + ']]>';
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * BullMQ processor that regenerates the Google Merchant feed every 6 hours (spec §08).
 *
 * Generates an RSS/Atom feed of active products with price, availability,
 * and image data. Cached in Redis at GOOGLE_MERCHANT_FEED_CACHE_KEY.
 */
@Processor(GOOGLE_MERCHANT_FEED_QUEUE)
export class GoogleMerchantFeedProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(GoogleMerchantFeedProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(GOOGLE_MERCHANT_FEED_QUEUE) private readonly queue: Queue,
    @Inject(SEO_REDIS_CLIENT) private readonly redis: Redis,
    private readonly currencies: CurrenciesService,
    private readonly config: ConfigService,
    @Inject(SEO_SETTINGS_SERVICE) private readonly settings: SeoSettingsReader,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      GOOGLE_MERCHANT_FEED_JOB,
      {},
      {
        repeat: { pattern: GOOGLE_MERCHANT_FEED_CRON },
        jobId: 'google-merchant-feed-cron',
      },
    );
    this.logger.log('onModuleInit: google-merchant-feed cron registered (every 6 hours)');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async process(_job: Job): Promise<void> {
    this.logger.log('process: generating Google Merchant feed');

    try {
      const products = await this.prisma.product.findMany({
        where: { status: 'ACTIVE', deletedAt: null },
        // `include` (not `select`) so the product scalars come back whole;
        // `description` feeds the required <g:description> attribute.
        include: {
          variants: {
            where: { deletedAt: null },
            select: {
              id: true,
              sku: true,
              price: true,
              stockLevels: { select: { onHand: true, reserved: true } },
            },
            take: 1,
            orderBy: { price: 'asc' },
          },
          assets: {
            where: { isPrimary: true },
            select: {
              asset: { select: { id: true, status: true, variants: true } },
            },
            take: 1,
          },
        },
        take: 10000,
      });

      const { code: feedCurrency } = await this.currencies.getStore();
      const feed = await this.buildFeed(
        products as Array<Record<string, unknown>>,
        feedCurrency,
        resolvePublicBaseUrl(this.config),
      );
      await this.redis.set(
        GOOGLE_MERCHANT_FEED_CACHE_KEY,
        feed,
        'EX',
        GOOGLE_MERCHANT_FEED_TTL_SECONDS,
      );

      this.logger.log(`process: done — ${products.length} products in feed`);
    } catch (err) {
      this.logger.error('process: google merchant feed generation failed', (err as Error).stack);
      throw err;
    }
  }

  /**
   * Google Shopping RSS 2.0.
   *
   * Three defects were shipping here, and each disapproves every item in the
   * feed rather than degrading it:
   *
   * 1. `<g:link>` was `https://store.example.com/products/<slug>`: a
   *    placeholder host, on a path shape this storefront does not serve. It
   *    derives from the same `resolvePublicBaseUrl` + `entityPath` pair the
   *    sitemap, canonical, and IndexNow use, so the feed cannot drift from
   *    the URLs the crawlers already hold.
   * 2. `<g:id>` was emitted twice per item.
   * 3. `<g:description>` was absent, and it is a required attribute.
   *
   * The channel-level `<link>` and `<description>` were missing too, which
   * fails the feed as a whole rather than item by item.
   */
  private async buildFeed(
    products: Array<Record<string, unknown>>,
    feedCurrency: string,
    siteUrl: string,
  ): Promise<string> {
    const items = products
      .map((p) => {
        const variants = p.variants as Array<Record<string, unknown>>;
        const assets = p.assets as Array<Record<string, unknown>>;
        const variant = variants[0];
        // Per AV1 — Google Merchant feed image_link uses the 'card'-intent
        // variant URL (small 400 px webp). Google accepts that crop-aspect.
        const assetObj = assets[0]?.asset as
          | { id: string; status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'; variants: unknown }
          | undefined;
        const imageUrl = tryPickVariantUrl(assetObj, 'card')?.url ?? '';
        const price = formatAmount(variant ? Number(variant.price) : 0, feedCurrency);
        const stockLevels = variant ? (variant.stockLevels as Array<Record<string, number>>) : [];
        // Clamped per location, matching InventoryService.availabilityForVariants.
        // The unclamped form lets one location whose reservation exceeds its own
        // stock contribute a negative term and eat another location's stock,
        // which is the divergence D8.33c closed on the search path. Dormant
        // today because nothing writes a non-zero `reserved`, and it stays
        // dormant only until something does.
        const available = stockLevels.reduce(
          (sum, sl) => sum + Math.max(0, (sl.onHand ?? 0) - (sl.reserved ?? 0)),
          0,
        );
        const inStock = available > 0;
        const name = resolveTranslatable(p.name, feedLocale());
        const description = resolveTranslatable(p.description, feedLocale()) || name;
        const slug = p.slug as string;
        const link = siteUrl + entityPath('product', slug, feedLocale());

        return `  <item>
    <g:id>${p.id}</g:id>
    <g:title>${cdata(name)}</g:title>
    <g:description>${cdata(description)}</g:description>
    <g:link>${xmlEscape(link)}</g:link>
    <g:image_link>${xmlEscape(imageUrl)}</g:image_link>
    <g:price>${price} ${feedCurrency}</g:price>
    <g:availability>${inStock ? 'in stock' : 'out of stock'}</g:availability>
    <g:condition>new</g:condition>
  </item>`;
      })
      .join('\n');

    const storeName =
      resolveTranslatable(await this.settings.get<unknown>('storeName'), feedLocale()) || 'Store';
    const describe = CHANNEL_DESCRIPTION[feedLocale()] ?? ((name: string) => name);

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${xmlEscape(storeName)}</title>
    <link>${xmlEscape(siteUrl)}</link>
    <description>${xmlEscape(describe(storeName))}</description>
${items}
  </channel>
</rss>`;
  }
}
