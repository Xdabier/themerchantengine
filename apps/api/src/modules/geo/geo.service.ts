import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CONTENT_STALE_DAYS,
  CONTENT_STALE_NOTIFICATION_TYPE,
  GEO_FAQ_SUGGESTIONS_COUNT,
  GEO_FAQ_TEMPLATES,
  GEO_LLMS_FULL_BATCH_SIZE,
  GEO_LLMS_FULL_TXT_CACHE_PREFIX,
  GEO_LLMS_TXT_CACHE_PREFIX,
  GEO_LLMS_TXT_JOB,
  GEO_LLMS_TXT_QUEUE,
  GEO_LLMS_TXT_TTL_SECONDS,
  GEO_MIN_DESCRIPTION_LENGTH,
  GEO_POPULAR_PRODUCTS_COUNT,
  geoSupportedLocales,
  GEO_TOP_CATEGORIES_COUNT,
  GEO_REDIS_CLIENT,
  PLACEHOLDER_CONTACT_VALUES,
} from './geo.constants';
import type { AcceptFaqSuggestionsDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { formatAmount } from '@common/money';
import { CurrenciesService } from '../currencies/currencies.service';
import { defaultMailLocale } from '../mail/mail.types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolve(value: unknown, locale: string): string {
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, string>;
  return obj[locale] ?? obj[defaultMailLocale()] ?? obj['default'] ?? '';
}

function mdEscape(s: string): string {
  return s.replace(/[[\]()]/g, '\\$&');
}

/**
 * Strip HTML tags from a Translatable rich-text body to produce plain-text
 * content suitable for the llms-full.txt surface. CMS About + Policy bodies
 * are HTML rich-text edited via the admin RichTextEditor; AI inference
 * layers consume Markdown / plain text, not HTML, so we collapse tags to
 * whitespace and decode the standard entities. Whitespace runs collapse to a
 * single space so paragraphs read naturally without serialising the source
 * HTML's indentation. Empty input → empty output.
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const LLMS_NEUTRAL_DESCRIPTION: Record<string, (storeName: string) => string> = {
  fr: (name) => `${name} : boutique en ligne.`,
  ar: (name) => `${name}: متجر إلكتروني.`,
  en: (name) => `${name}: online store.`,
};

/**
 * The llms.txt blockquote: llmstxt.org calls for "a short summary of the
 * project, with key information necessary for understanding the rest of the
 * file". It is `identity.description` from the runtime config, resolved to
 * the locale; a store that has not written one yet gets a neutral line built
 * from its name rather than another store's positioning.
 */
function llmsDescription(descriptionRaw: unknown, storeName: string, locale: string): string {
  const configured = resolve(descriptionRaw, locale);
  if (configured) return configured;
  const neutral = LLMS_NEUTRAL_DESCRIPTION[locale] ?? LLMS_NEUTRAL_DESCRIPTION[defaultMailLocale()];
  return neutral ? neutral(storeName) : storeName;
}

/**
 * Hardcoded routed policy slugs at apps/storefront/src/app/pages/[locale]/policies/[slug].page.ts.
 * New policy slugs land both as a route AND as a line here in the same /phase commit
 * per agent_docs/storefront/seo-geo.md "## llms.txt shape" Policies policy.
 */
const LLMS_POLICY_SLUGS: ReadonlyArray<{ slug: string; label: Record<string, string> }> = [
  { slug: 'shipping', label: { ar: 'الشحن', fr: 'Livraison', en: 'Shipping' } },
  { slug: 'returns', label: { ar: 'الإرجاع', fr: 'Retours', en: 'Returns' } },
  { slug: 'terms', label: { ar: 'الشروط', fr: 'Conditions', en: 'Terms' } },
  { slug: 'privacy', label: { ar: 'الخصوصية', fr: 'Confidentialité', en: 'Privacy' } },
];

function policyLabel(label: Record<string, string>, locale: string, slug: string): string {
  return label[locale] ?? label[defaultMailLocale()] ?? slug;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GEO_REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(GEO_LLMS_TXT_QUEUE) private readonly llmsQueue: Queue,
    // Injected lazily via forwardRef-safe token if needed; resolved at construction
    @Inject('GEO_NOTIFICATIONS_SERVICE')
    private readonly notifications: NotificationsService,
    @Inject('GEO_SETTINGS_SERVICE')
    private readonly settings: SettingsService,
    private readonly currencies: CurrenciesService,
  ) {}

  // ── llms.txt ─────────────────────────────────────────────────────────────────

  /**
   * Returns the llms.txt content for the given locale.
   * Served from Redis cache; regenerated if stale.
   */
  async getLlmsTxt(locale: string, siteUrl: string): Promise<string> {
    const cacheKey = `${GEO_LLMS_TXT_CACHE_PREFIX}${locale}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const content = await this.buildLlmsTxt(locale, siteUrl);
    await this.redis.setex(cacheKey, GEO_LLMS_TXT_TTL_SECONDS, content);
    return content;
  }

  /** Enqueue a llms.txt regeneration for all locales. */
  async enqueueLlmsRegeneration(): Promise<void> {
    await this.llmsQueue.add(GEO_LLMS_TXT_JOB, {}, { jobId: 'llms-txt-generate' });
  }

  /**
   * Regenerates llms.txt for all supported locales and stores in Redis.
   * Called by LlmsTxtProcessor (cron + event-triggered).
   */
  async regenerateLlmsTxt(siteUrl: string): Promise<void> {
    await Promise.all(
      geoSupportedLocales().map(async (locale) => {
        const content = await this.buildLlmsTxt(locale, siteUrl);
        const cacheKey = `${GEO_LLMS_TXT_CACHE_PREFIX}${locale}`;
        await this.redis.setex(cacheKey, GEO_LLMS_TXT_TTL_SECONDS, content);
      }),
    );
    this.logger.log('regenerateLlmsTxt: updated all locales');
  }

  private async buildLlmsTxt(locale: string, siteUrl: string): Promise<string> {
    // agent_docs/storefront/seo-geo.md "## llms.txt shape" — H1 / blockquote /
    // About / Categories / Featured Products / Policies / Contact / Optional.
    // Section split (Categories vs Featured Products) lands in the 2026-05-06
    // restructure — the prior single ## Catalog block lumped both classes,
    // hurting AI parsability. Generic boilerplate ("This file is machine-
    // readable …") is forbidden. The blockquote carries the positioning line
    // from the client brand floor.
    const [categories, products, aboutPage, storeNameRaw, contactEmail, descriptionRaw] =
      await Promise.all([
        this.prisma.category.findMany({
          where: { deletedAt: null, isVisible: true },
          select: { name: true, description: true, slug: true },
          orderBy: { sortOrder: 'asc' },
          take: GEO_TOP_CATEGORIES_COUNT,
        }),
        this.prisma.product.findMany({
          where: { status: ProductStatus.ACTIVE, deletedAt: null },
          select: { name: true, shortDescription: true, slug: true },
          orderBy: { publishedAt: 'desc' },
          take: GEO_POPULAR_PRODUCTS_COUNT,
        }),
        this.prisma.cmsPage.findFirst({
          where: { slug: 'about', isPublished: true, deletedAt: null },
          select: { slug: true, title: true },
        }),
        this.settings.get<Record<string, string>>('storeName'),
        this.settings.get<string>('contactEmail'),
        this.settings.get<unknown>('description'),
      ]);

    const storeName = resolve(storeNameRaw, locale) || 'Store';
    const description = llmsDescription(descriptionRaw, storeName, locale);

    const lines: string[] = [`# ${storeName}`, '', `> ${description}`, ''];

    // ## About — links the about page (CMS-driven if published, fallback to the
    // routed /<locale>/about page that the storefront ships as code).
    const aboutTitle = aboutPage ? resolve(aboutPage.title, locale) || 'About' : 'About';
    lines.push(`## About`, '', `- [${mdEscape(aboutTitle)}](${siteUrl}/${locale}/about)`, '');

    // ## Categories — visible categories sorted by sortOrder, capped by the
    // GEO_TOP_CATEGORIES_COUNT constant. URL paths use the locale-prefixed
    // Analog routes.
    lines.push(`## Categories`, '');
    for (const cat of categories) {
      const name = resolve(cat.name, locale);
      const desc = resolve(cat.description, locale);
      const url = `${siteUrl}/${locale}/catalog/${cat.slug}`;
      lines.push(`- [${mdEscape(name)}](${url})${desc ? `: ${desc.slice(0, 120)}` : ''}`);
    }
    lines.push('');

    // ## Featured Products — most-recently-published active products, capped
    // by GEO_POPULAR_PRODUCTS_COUNT. The full catalogue lives at /llms-full.txt
    // (linked from ## Optional) for crawlers that want comprehensive coverage.
    lines.push(`## Featured Products`, '');
    for (const p of products) {
      const name = resolve(p.name, locale);
      const desc = resolve(p.shortDescription, locale);
      const url = `${siteUrl}/${locale}/catalog/product/${p.slug}`;
      lines.push(`- [${mdEscape(name)}](${url})${desc ? `: ${desc.slice(0, 120)}` : ''}`);
    }
    lines.push('');

    // ## Policies — hardcoded routed slugs at
    // apps/storefront/src/app/pages/[locale]/policies/[slug].page.ts.
    lines.push(`## Policies`, '');
    for (const policy of LLMS_POLICY_SLUGS) {
      const label = policyLabel(policy.label, locale, policy.slug);
      lines.push(`- [${mdEscape(label)}](${siteUrl}/${locale}/policies/${policy.slug})`);
    }
    lines.push('');

    // ## Contact — RFC-2368 mailto: line. Skipped entirely when the operator
    // has not seeded a real address (placeholder values are caught by
    // PLACEHOLDER_CONTACT_VALUES so the cron-cached file never emits a
    // non-routable mailto: that AI inference would surface to end-users).
    if (contactEmail && !PLACEHOLDER_CONTACT_VALUES.has(contactEmail)) {
      lines.push(`## Contact`, '', `- <mailto:${contactEmail}>`, '');
    }

    // ## Optional — secondary references per the llmstxt.org spec. AI crawlers
    // can skip this section without losing primary content; deeper consumers
    // follow the pointers for the full catalogue and URL inventory.
    lines.push(
      `## Optional`,
      '',
      `- [Full catalogue](${siteUrl}/llms-full.txt): every active product with descriptions, brands, and prices`,
      `- [Sitemap](${siteUrl}/sitemap_index.xml): complete URL inventory`,
    );

    return lines.join('\n');
  }

  // ── llms-full.txt ────────────────────────────────────────────────────────────

  /**
   * Returns the comprehensive llms-full.txt for the given locale. Served from
   * Redis cache; regenerated if stale. The full file shape (every active
   * product, every visible category, full policy bodies) is documented in
   * `agent_docs/storefront/seo-geo.md` "## llms-full.txt shape".
   */
  async getLlmsFullTxt(locale: string, siteUrl: string): Promise<string> {
    const cacheKey = `${GEO_LLMS_FULL_TXT_CACHE_PREFIX}${locale}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const content = await this.buildLlmsFullTxt(locale, siteUrl);
    await this.redis.setex(cacheKey, GEO_LLMS_TXT_TTL_SECONDS, content);
    return content;
  }

  /** Regenerates llms-full.txt for all supported locales and stores in Redis. */
  async regenerateLlmsFullTxt(siteUrl: string): Promise<void> {
    await Promise.all(
      geoSupportedLocales().map(async (locale) => {
        const content = await this.buildLlmsFullTxt(locale, siteUrl);
        const cacheKey = `${GEO_LLMS_FULL_TXT_CACHE_PREFIX}${locale}`;
        await this.redis.setex(cacheKey, GEO_LLMS_TXT_TTL_SECONDS, content);
      }),
    );
    this.logger.log('regenerateLlmsFullTxt: updated all locales');
  }

  private async buildLlmsFullTxt(locale: string, siteUrl: string): Promise<string> {
    // Resolved once for the whole walk rather than per product: this file dumps
    // the entire catalogue, so a per-row settings read would be thousands of
    // lookups for one value that cannot change mid-file.
    const storeCurrency = (await this.currencies.getStore()).code;
    // Comprehensive single-file dump optimised for AI inference layers that
    // ingest the entire catalogue in one request. Sections in stable order:
    // H1, blockquote, About, Categories, Products, Policies, Contact.
    // No per-section caps — the file size is bounded only by the live
    // catalogue. Product walk is batched per GEO_LLMS_FULL_BATCH_SIZE so
    // memory pressure stays linear.
    const [categories, aboutPage, policyPages, storeNameRaw, contactEmail, descriptionRaw] =
      await Promise.all([
        this.prisma.category.findMany({
          where: { deletedAt: null, isVisible: true },
          select: { name: true, description: true, slug: true },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.cmsPage.findFirst({
          where: { slug: 'about', isPublished: true, deletedAt: null },
          select: { title: true, content: true },
        }),
        this.prisma.cmsPage.findMany({
          where: {
            slug: { in: LLMS_POLICY_SLUGS.map((p) => `policies/${p.slug}`) },
            isPublished: true,
            deletedAt: null,
          },
          select: { slug: true, title: true, content: true },
        }),
        this.settings.get<Record<string, string>>('storeName'),
        this.settings.get<string>('contactEmail'),
        this.settings.get<unknown>('description'),
      ]);

    const storeName = resolve(storeNameRaw, locale) || 'Store';
    const description = llmsDescription(descriptionRaw, storeName, locale);

    const lines: string[] = [`# ${storeName}`, '', `> ${description}`, ''];

    // ## About — full body of the published About CMS page, locale-resolved.
    // Falls back to a section-skip when no published About row exists.
    if (aboutPage) {
      const aboutTitle = resolve(aboutPage.title, locale) || 'About';
      const aboutBody = htmlToPlainText(resolve(aboutPage.content, locale));
      lines.push(`## About`, '', `### ${mdEscape(aboutTitle)}`, '', aboutBody, '');
    }

    // ## Categories — every visible category with its description.
    lines.push(`## Categories`, '');
    for (const cat of categories) {
      const name = resolve(cat.name, locale);
      const desc = resolve(cat.description, locale);
      const url = `${siteUrl}/${locale}/catalog/${cat.slug}`;
      lines.push(`### ${mdEscape(name)}`);
      lines.push(`- URL: ${url}`);
      if (desc) lines.push('', desc);
      lines.push('');
    }

    // ## Products — paginated walk over every active product. Each entry
    // carries the canonical URL, brand attribution (FK-resolved with the
    // legacy free-text fallback per DR-09), default-variant SKU + price, and
    // the short description. Long descriptions stay out of this surface to
    // keep the file under crawler-friendly ~5 MB ceilings on 5K-product
    // catalogues; the per-product detail page carries the full description.
    lines.push(`## Products`, '');
    let cursor = 0;
    while (true) {
      const batch = await this.prisma.product.findMany({
        where: { status: ProductStatus.ACTIVE, deletedAt: null },
        select: {
          name: true,
          shortDescription: true,
          slug: true,
          brand: true,
          brandRelation: { select: { name: true } },
          gtin: true,
          mpn: true,
          variants: {
            where: { deletedAt: null },
            select: { sku: true, price: true, isDefault: true },
            orderBy: { isDefault: 'desc' },
            take: 1,
          },
        },
        orderBy: { id: 'asc' },
        skip: cursor,
        take: GEO_LLMS_FULL_BATCH_SIZE,
      });
      if (batch.length === 0) break;

      for (const p of batch) {
        const name = resolve(p.name, locale);
        const desc = resolve(p.shortDescription, locale);
        const url = `${siteUrl}/${locale}/catalog/product/${p.slug}`;
        const brand = p.brandRelation
          ? resolve(p.brandRelation.name, locale)
          : (p.brand ?? '').trim();
        const variant = p.variants[0];

        lines.push(`### ${mdEscape(name)}`);
        lines.push(`- URL: ${url}`);
        if (brand) lines.push(`- Brand: ${brand}`);
        if (variant?.sku) lines.push(`- SKU: ${variant.sku}`);
        if (variant?.price !== undefined && variant?.price !== null) {
          // The store currency, not a literal, and at its own precision.
          // This feeds llms.txt, so every product in the AI-facing catalogue
          // was advertised in the previous client currency at whatever
          // Number() happened to stringify. D4.11g flushes this keyspace
          // precisely because it is money-bearing; the literal was missed.
          lines.push(`- Price: ${formatAmount(variant.price, storeCurrency)} ${storeCurrency}`);
        }
        if (p.gtin) lines.push(`- GTIN: ${p.gtin}`);
        if (p.mpn) lines.push(`- MPN: ${p.mpn}`);
        if (desc) lines.push('', desc);
        lines.push('');
      }

      cursor += batch.length;
      if (batch.length < GEO_LLMS_FULL_BATCH_SIZE) break;
    }

    // ## Policies — full body of each routed policy page, when published.
    // The hardcoded slug list at LLMS_POLICY_SLUGS guarantees order; CMS rows
    // not yet seeded are gracefully skipped.
    lines.push(`## Policies`, '');
    const policyBySlug = new Map(policyPages.map((p) => [p.slug, p]));
    for (const policy of LLMS_POLICY_SLUGS) {
      const fullSlug = `policies/${policy.slug}`;
      const cms = policyBySlug.get(fullSlug);
      const label = policyLabel(policy.label, locale, policy.slug);
      const url = `${siteUrl}/${locale}/policies/${policy.slug}`;
      lines.push(`### ${mdEscape(label)}`);
      lines.push(`- URL: ${url}`);
      if (cms) {
        const body = htmlToPlainText(resolve(cms.content, locale));
        if (body) lines.push('', body);
      }
      lines.push('');
    }

    // ## Contact — same suppression rule as the short llms.txt: omit the
    // section entirely when the operator has not seeded a real email.
    if (contactEmail && !PLACEHOLDER_CONTACT_VALUES.has(contactEmail)) {
      lines.push(`## Contact`, '', `- Email: ${contactEmail}`);
    }

    return lines.join('\n');
  }

  // ── Content Freshness ─────────────────────────────────────────────────────────

  /**
   * Checks for stale content (not updated in CONTENT_STALE_DAYS days).
   * Creates an admin notification if stale items are found.
   * Called by ContentFreshnessProcessor daily.
   */
  async checkContentFreshness(): Promise<{
    staleProducts: number;
    staleCategories: number;
    stalePages: number;
  }> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - CONTENT_STALE_DAYS);

    const [staleProducts, staleCategories, stalePages] = await Promise.all([
      this.prisma.product.count({
        where: {
          status: ProductStatus.ACTIVE,
          deletedAt: null,
          updatedAt: { lt: threshold },
        },
      }),
      this.prisma.category.count({
        where: { deletedAt: null, isVisible: true, updatedAt: { lt: threshold } },
      }),
      this.prisma.cmsPage.count({
        where: { isPublished: true, deletedAt: null, updatedAt: { lt: threshold } },
      }),
    ]);

    const total = staleProducts + staleCategories + stalePages;
    if (total > 0) {
      await this.notifications.createForAllAdmins(
        CONTENT_STALE_NOTIFICATION_TYPE,
        {
          default: 'Contenu à rafraîchir',
          fr: 'Contenu à rafraîchir',
          en: 'Content Freshness Alert',
        },
        {
          default: `${staleProducts} produits, ${staleCategories} catégories et ${stalePages} pages n’ont pas été mis à jour depuis ${CONTENT_STALE_DAYS} jours ou plus.`,
          fr: `${staleProducts} produits, ${staleCategories} catégories et ${stalePages} pages n’ont pas été mis à jour depuis ${CONTENT_STALE_DAYS} jours ou plus.`,
          en: `${staleProducts} products, ${staleCategories} categories and ${stalePages} pages have not been updated in ${CONTENT_STALE_DAYS}+ days.`,
        },
        { staleProducts, staleCategories, stalePages },
      );
      this.logger.log(
        `checkContentFreshness: flagged ${total} stale items (products=${staleProducts}, categories=${staleCategories}, pages=${stalePages})`,
      );
    } else {
      this.logger.log('checkContentFreshness: all content is fresh');
    }

    return { staleProducts, staleCategories, stalePages };
  }

  // ── AI Readiness Score ────────────────────────────────────────────────────────

  /**
   * Computes the AI-readiness score across all active products.
   *
   * Three signals per product:
   *   1. Answer-first description — description has ≥ 100 chars in the default locale
   *   2. FAQ entries — product has at least 1 FAQ
   *   3. Complete schema markup — both metaTitle and metaDescription are set
   *
   * Returns percentages for each signal plus an overall score (average of the three).
   */
  async getAiReadinessScore(): Promise<{
    score: number;
    signals: {
      answerFirstDescription: number;
      faqEntries: number;
      completeSchemaMarkup: number;
    };
    productsAnalyzed: number;
  }> {
    const jsonNullFilter = { equals: Prisma.JsonNull };

    const [totalProducts, withLongDescription, withFaqs, withSchemaMarkup] = await Promise.all([
      this.prisma.product.count({ where: { status: ProductStatus.ACTIVE, deletedAt: null } }),

      // Answer-first proxy: description is set and non-null (we count as passing if description
      // has ≥ GEO_MIN_DESCRIPTION_LENGTH chars — checked via length at JS level after fetching)
      // Since we can't do string-length filtering in Prisma, fetch descriptions and filter in JS
      this.prisma.product
        .findMany({
          where: { status: ProductStatus.ACTIVE, deletedAt: null },
          select: { description: true },
        })
        .then(
          (rows) =>
            rows.filter(
              (r) => resolve(r.description, 'default').length >= GEO_MIN_DESCRIPTION_LENGTH,
            ).length,
        ),

      this.prisma.product.count({
        where: {
          status: ProductStatus.ACTIVE,
          deletedAt: null,
          faqs: { some: {} },
        },
      }),

      this.prisma.product.count({
        where: {
          status: ProductStatus.ACTIVE,
          deletedAt: null,
          NOT: [{ metaTitle: jsonNullFilter }, { metaDescription: jsonNullFilter }],
        },
      }),
    ]);

    // Signals are fractions 0–1 (matching the admin Zod schema: z.number().min(0).max(1))
    const fraction = (n: number) =>
      totalProducts === 0 ? 0 : Math.round((n / totalProducts) * 1000) / 1000;

    const afd = fraction(withLongDescription);
    const faq = fraction(withFaqs);
    const schema = fraction(withSchemaMarkup);
    // Overall score 0–100 (rounded to nearest integer)
    const score = Math.round(((afd + faq + schema) / 3) * 100);

    return {
      score,
      signals: {
        answerFirstDescription: afd,
        faqEntries: faq,
        completeSchemaMarkup: schema,
      },
      productsAnalyzed: totalProducts,
    };
  }

  // ── FAQ Auto-generation ───────────────────────────────────────────────────────

  /**
   * Returns up to GEO_FAQ_SUGGESTIONS_COUNT generic FAQ suggestions for a product.
   * Only suggests if the product currently has no FAQs.
   * These are not saved — the admin POSTs to /accept to persist them.
   */
  async getFaqSuggestions(
    productId: string,
  ): Promise<Array<{ question: Record<string, string>; answer: Record<string, string> }>> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, faqs: { select: { id: true }, take: 1 } },
    });
    if (!product) throw new NotFoundException('Product not found');

    if (product.faqs.length > 0) {
      // Product already has FAQs — no suggestions needed
      return [];
    }

    return GEO_FAQ_TEMPLATES.slice(0, GEO_FAQ_SUGGESTIONS_COUNT).map((t) => ({
      question: { ...t.question },
      answer: { ...t.answer },
    }));
  }

  /**
   * Saves accepted (and optionally edited) FAQ suggestions as real ProductFaq records.
   * Skips if the product already has FAQs to prevent duplicates.
   */
  async acceptFaqSuggestions(
    productId: string,
    dto: AcceptFaqSuggestionsDto,
  ): Promise<
    Array<{
      id: string;
      productId: string;
      question: Record<string, string>;
      answer: Record<string, string>;
      sortOrder: number;
      createdAt: Date;
    }>
  > {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const createdFaqs = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.productFaq.count({ where: { productId } });
      if (existing > 0) {
        // Idempotent: return existing FAQs instead of creating duplicates
        return tx.productFaq.findMany({ where: { productId } });
      }

      const records = await Promise.all(
        dto.faqs.map((faq, idx) =>
          tx.productFaq.create({
            data: {
              productId,
              question: faq.question as object,
              answer: faq.answer as object,
              sortOrder: faq.sortOrder ?? idx,
            },
          }),
        ),
      );
      return records;
    });

    this.logger.log(
      `acceptFaqSuggestions: processed ${createdFaqs.length} FAQs for product ${productId}`,
    );
    return createdFaqs.map((faq) => ({
      id: faq.id,
      productId: faq.productId,
      question: faq.question as Record<string, string>,
      answer: faq.answer as Record<string, string>,
      sortOrder: faq.sortOrder,
      createdAt: faq.createdAt,
    }));
  }
}
