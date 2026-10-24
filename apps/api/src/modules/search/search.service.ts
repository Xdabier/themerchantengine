// raw-sql-approved: PostgreSQL full-text search (tsvector + pg_trgm) via
// Prisma.sql tagged-template parameterisation across 9 call sites (8 original
// FTS sites + resolveCategoryMatches / resolveBrandMatches added for query-time
// brand + category-subtree + reference coverage, additive under DR-19 revival
// path §2, minus the dedicated StockLevel lookup removed at D8.33c) — see merchants-engine technical spec §9.2 search-FTS exemption and
// specs/decision-records/19-raw-sql-search-fts.md. Setup contract:
// prisma/search_fts_setup.sql must have been applied first (npm run db:fts;
// re-applied after every prisma db push). Reviewed by db-safety-auditor on
// 2026-05-15; the approved SQL changed at phase D2 on 2026-08-21 (text-search
// configuration `arabic` to `french`, JSONB path `name->>'ar'` to `name->>${storeDefaultLocale()}`,
// unaccent added to the French ILIKE branches, and a fourth ts_rank_cd term)
// and was re-reviewed by schema-migration-reviewer on that date. At D8.33c the
// dedicated stock-lookup site was removed: reading another module's table is a
// §3.1 modular-isolation question, which DR-19's §3.5 raw-SQL grant never
// covered. Availability now comes from InventoryService. The FTS ranking query
// still LEFT JOINs StockLevel for its optional in-stock HAVING filter; that one
// is inside the query DR-19 does approve, and removing it would move the filter
// after LIMIT instead of before it, changing ranking and pagination.
// raw-sql-approved: every value reaching $queryRaw/$executeRaw is a Prisma.sql
// bound parameter (the text-search configs are bound regconfig casts taken from
// the locale registry, phase LG6) and storeDefaultLocale() is clamped to the
// enabled locale set by both the locale snapshot and settings validation; the
// per-locale trigram indexes plus the per-locale tsvector segments generated
// into prisma/search_fts_setup.sql, and
// the deletedAt filters added to resolveCategoryMatches, resolveBrandMatches and
// suggest, are proven live by the "Store default locale copy" e2e block in
// apps/api/test/search.e2e-spec.ts, re-run green under gulf-rtl and demo against
// the real dockerized Postgres (db-safety-auditor, 2026-09-03).
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { tryPickVariantUrl } from '@common/asset-variants';
import { storeLocales } from '@common/locale';
import { searchTextConfigs } from './search-text-configs';

/** The JSONB key the full-text and trigram paths read: the store default locale (DR-31). */
function storeDefaultLocale(): string {
  return storeLocales.current().defaultLocale;
}
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { type StockStatus } from '../inventory/inventory.constants';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import type { SearchProductsDto } from './dto/search-products.dto';
import type { SuggestDto } from './dto/suggest.dto';
import type { LogClickDto } from './dto/log-click.dto';
import type { CreateSynonymDto } from './dto/create-synonym.dto';
import type { CreateMerchandisingRuleDto } from './dto/create-merchandising-rule.dto';
import type { SearchAnalyticsQueryDto } from './dto/analytics-query.dto';
import type { ListAdminDto } from './dto/list-admin.dto';
import { FTS_CANDIDATE_LIMIT, MAX_SUGGESTIONS, TRGM_THRESHOLD } from './search.constants';

/**
 * One product-level availability from its variants graded individually.
 *
 * A search hit carries no variant array, so the roll-up happens server-side.
 * It deliberately does NOT sum stock across variants and grade the total: a
 * customer buys one variant, so two variants of three and four units each are
 * not seven units of anything, and summing would report IN_STOCK where every
 * variant is individually low. Grading per variant and taking the best state
 * is also what the storefront derives for the catalogue grid, so the same
 * product cannot read differently on two grids.
 */
function rollUpAvailability(states: StockStatus[]): StockStatus {
  if (states.includes('IN_STOCK')) return 'IN_STOCK';
  if (states.includes('LOW_STOCK')) return 'LOW_STOCK';
  return 'OUT_OF_STOCK';
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface FtsRow {
  id: string;
  rank: number;
  trgm_sim: number;
}

export interface ProductSearchResult {
  id: string;
  name: unknown;
  slug: string;
  brand: string | null;
  tags: string[];
  isFeatured: boolean;
  createdAt: Date;
  minPrice: number | null;
  avgRating: number;
  reviewCount: number;
  inStock: boolean;
  /**
   * Three-state availability the search grid renders. `inStock` stays a plain
   * boolean because the facet filter and other consumers read it.
   */
  availability: StockStatus;
  thumbnail: string | null;
  /** AV4: primary asset with `assetVariants` for `<picture>` consumers. */
  primaryAsset: {
    id: string;
    assetId: string;
    url: string;
    altText: unknown;
    isPrimary: boolean;
    assetVariants: Array<{ url: string; width: number; format: string }>;
  } | null;
  categories: Array<{ id: string; name: unknown }>;
}

export interface SearchFacets {
  categories: Array<{ id: string; name: unknown; count: number }>;
  brands: Array<{ name: string; count: number }>;
  priceRange: { min: number; max: number } | null;
  ratings: Array<{ rating: number; count: number }>;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  // ── PUBLIC: SEARCH ──────────────────────────────────────────────────────────

  async search(
    dto: SearchProductsDto,
    locale: string,
    userId?: string,
    sessionId?: string,
  ): Promise<PaginatedResult<{ product: ProductSearchResult; eventId?: string; score?: number }>> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const q = dto.q?.trim() ?? '';

    const expandedQ = await this.expandWithSynonyms(q);

    // Resolve brand + category(+subtree) matches at query time. The tsvector
    // indexes only name/shortDescription/tags/description — brand names live in
    // the Brand table and category names in Category (joined via
    // ProductCategory), so a keyword like "S-Labo" or a category name is
    // matched here and fed as extra OR clauses into the FTS query. See
    // specs/features/storefront-search-restore/plan.md §2.2.
    const [categoryIds, brandIds] = await Promise.all([
      this.resolveCategoryMatches(q),
      this.resolveBrandMatches(q),
    ]);

    // Step 1: FTS query — returns sorted IDs + ranks
    const ftsRows = await this.runFtsQuery(expandedQ, q, dto, categoryIds, brandIds);

    // Apply merchandising BOOST / BURY on the ranked list
    const rankedRows = await this.applyScoring(ftsRows, q);

    // Apply PIN rules: fix specific products to position
    const pinnedRows = await this.applyPins(rankedRows, q);

    const totalIds = pinnedRows.map((r) => r.id);
    const total = totalIds.length;
    const pageIds = totalIds.slice(offset, offset + pageSize);

    // Step 2: Fetch full product data for this page
    const products = await this.fetchProductData(pageIds, pinnedRows);

    // Step 3: Log search event synchronously (was previously fire-and-forget)
    // so the event ID can be embedded in each hit for per-product click
    // tracking. The await is intentional: the storefront's S7 click-tracking
    // contract requires a stable event id on every hit
    // (storefront-api-reference.md §Search). Do not revert to the
    // fire-and-forget pattern without a downstream tracking redesign.
    let searchEventId: string | undefined;
    try {
      const event = await this.logSearchEvent(q, total, locale, userId, sessionId);
      searchEventId = event.id;
    } catch (err: unknown) {
      this.logger.warn('Failed to log search event', err);
    }

    // Step 4: Shape hits per the SearchHit contract —
    // { product: ProductSearchResult, eventId?, score? }.
    const rankMap = new Map(rankedRows.map((r) => [r.id, r.rank]));
    const hits = products.map((p) => ({
      product: p,
      eventId: searchEventId,
      score: rankMap.get(p.id) ?? 0,
    }));

    return { data: hits, meta: { page, pageSize, total } };
  }

  // ── PUBLIC: SUGGEST ────────────────────────────────────────────────────────

  async suggest(
    dto: SuggestDto,
    locale: string,
  ): Promise<Array<{ type: string; label: string; slug: string }>> {
    const q = dto.q.trim();
    if (!q) return [];

    // The requested locale when the store enables it, else the store default:
    // the JSONB key the trigram fallback probes must be one the store writes.
    const lang = storeLocales.isSupported(locale) ? locale : storeLocales.current().defaultLocale;

    // Product name suggestions via trigram similarity.
    // GREATEST(...) across the locale name AND the 'default' name so that a
    // query in the other language (e.g. typing "laptop" on the /fr/ page)
    // still returns results. Grounded in plan.md §S7: suggest must "render
    // top 5-8 suggestions" for any relevant query regardless of locale.
    const productRows = await this.prisma.$queryRaw<
      Array<{ id: string; name: Record<string, string>; slug: string; sim: number }>
    >(
      Prisma.sql`
        SELECT p.id, p.name, p.slug,
          GREATEST(
            similarity(COALESCE(p.name->>${lang}, ''), ${q}),
            similarity(COALESCE(p.name->>'default', ''), ${q})
          ) AS sim
        FROM "Product" p
        WHERE p.status = 'ACTIVE'
          AND p."deletedAt" IS NULL
          AND GREATEST(
            similarity(COALESCE(p.name->>${lang}, ''), ${q}),
            similarity(COALESCE(p.name->>'default', ''), ${q})
          ) > ${TRGM_THRESHOLD}
        ORDER BY sim DESC
        LIMIT ${MAX_SUGGESTIONS}
      `,
    );

    // Category name suggestions via trigram similarity (same cross-locale logic).
    const categoryRows = await this.prisma.$queryRaw<
      Array<{ id: string; name: Record<string, string>; slug: string; sim: number }>
    >(
      Prisma.sql`
        SELECT c.id, c.name, c.slug,
          GREATEST(
            similarity(COALESCE(c.name->>${lang}, ''), ${q}),
            similarity(COALESCE(c.name->>'default', ''), ${q})
          ) AS sim
        FROM "Category" c
        WHERE c."isVisible" = true
          AND c."deletedAt" IS NULL
          AND GREATEST(
            similarity(COALESCE(c.name->>${lang}, ''), ${q}),
            similarity(COALESCE(c.name->>'default', ''), ${q})
          ) > ${TRGM_THRESHOLD}
        ORDER BY sim DESC
        LIMIT 4
      `,
    );

    const suggestions = [
      ...productRows.map((r) => ({
        type: 'product' as const,
        // Display the locale name if it matches; fall back to `default`.
        label: (r.name?.[lang] ?? r.name?.default ?? '') as string,
        slug: r.slug,
      })),
      ...categoryRows.map((r) => ({
        type: 'category' as const,
        label: (r.name?.[lang] ?? r.name?.default ?? '') as string,
        slug: r.slug,
      })),
    ]
      .sort((a, b) => {
        const simA =
          productRows.find((r) => r.slug === a.slug)?.sim ??
          categoryRows.find((r) => r.slug === a.slug)?.sim ??
          0;
        const simB =
          productRows.find((r) => r.slug === b.slug)?.sim ??
          categoryRows.find((r) => r.slug === b.slug)?.sim ??
          0;
        return simB - simA;
      })
      .slice(0, MAX_SUGGESTIONS);

    return suggestions;
  }

  // ── PUBLIC: FILTERS ────────────────────────────────────────────────────────

  async getFilters(
    q: string,
  ): Promise<Array<{ facet: string; values: Array<{ value: string; count: number }> }>> {
    const trimmed = q.trim();
    const expandedQ = await this.expandWithSynonyms(trimmed);
    const [categoryIds, brandIds] = await Promise.all([
      this.resolveCategoryMatches(trimmed),
      this.resolveBrandMatches(trimmed),
    ]);
    const ftsRows = await this.runFtsQuery(expandedQ, trimmed, {}, categoryIds, brandIds);
    const allIds = ftsRows.map((r) => r.id);
    const facets = await this.computeFacets(allIds);

    // Reshape SearchFacets into the FilterBucket[] contract expected by
    // storefront-types filtersResponseSchema (storefront-api-reference.md §Search).
    const buckets: Array<{ facet: string; values: Array<{ value: string; count: number }> }> = [];

    if (facets.brands.length > 0) {
      buckets.push({
        facet: 'brand',
        values: facets.brands.map((b) => ({ value: b.name, count: b.count })),
      });
    }

    if (facets.categories.length > 0) {
      buckets.push({
        facet: 'category',
        values: facets.categories.map((c) => ({
          value: typeof c.name === 'string' ? c.name : String(c.id),
          count: c.count,
        })),
      });
    }

    return buckets;
  }

  // ── PUBLIC: ANALYTICS EVENTS ───────────────────────────────────────────────

  async logClick(searchEventId: string, dto: LogClickDto): Promise<void> {
    const event = await this.prisma.searchEvent.findUnique({ where: { id: searchEventId } });
    if (!event) throw new NotFoundException('Search event not found');

    await this.prisma.searchEvent.update({
      where: { id: searchEventId },
      data: {
        clickedProductId: dto.clickedProductId,
        clickPosition: dto.clickPosition,
      },
    });
  }

  async logConversion(searchEventId: string): Promise<void> {
    const event = await this.prisma.searchEvent.findUnique({ where: { id: searchEventId } });
    if (!event) throw new NotFoundException('Search event not found');

    await this.prisma.searchEvent.update({
      where: { id: searchEventId },
      data: { convertedToOrder: true },
    });
  }

  // ── ADMIN: SYNONYMS ────────────────────────────────────────────────────────

  async createSynonym(dto: CreateSynonymDto) {
    const terms = dto.terms.map((t) => t.toLowerCase().trim());
    return this.prisma.searchSynonym.create({ data: { terms } });
  }

  async listSynonyms(dto: ListAdminDto): Promise<PaginatedResult<unknown>> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.searchSynonym.findMany({
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.searchSynonym.count(),
    ]);
    return { data: items, meta: { page, pageSize, total } };
  }

  async deleteSynonym(id: string): Promise<void> {
    const existing = await this.prisma.searchSynonym.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Synonym not found');
    await this.prisma.searchSynonym.delete({ where: { id } });
  }

  // ── ADMIN: MERCHANDISING RULES ─────────────────────────────────────────────

  async createMerchandisingRule(dto: CreateMerchandisingRuleDto) {
    if (dto.type === 'PIN' && dto.position === undefined) {
      throw new BadRequestException('PIN rules require a position');
    }
    if ((dto.type === 'BOOST' || dto.type === 'BURY' || dto.type === 'PIN') && !dto.productId) {
      throw new BadRequestException(`${dto.type} rules require a productId`);
    }
    return this.prisma.merchandisingRule.create({
      data: {
        type: dto.type,
        query: dto.query ?? null,
        productId: dto.productId ?? null,
        position: dto.position ?? null,
        priority: dto.priority ?? 0,
        config: dto.config ?? Prisma.JsonNull,
      },
    });
  }

  async listMerchandisingRules(dto: ListAdminDto): Promise<PaginatedResult<unknown>> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.merchandisingRule.findMany({
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.prisma.merchandisingRule.count(),
    ]);

    // MerchandisingRule has no Prisma relation to Product (only a loose
    // productId), so the admin "Product" column could only ever show the raw
    // id. Resolve the targeted products in one batched query and attach the
    // readable name so the frontend can render it (soft-deleted products simply
    // resolve to null → the frontend falls back to the id).
    const productIds = [
      ...new Set(items.map((r) => r.productId).filter((id): id is string => Boolean(id))),
    ];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const data = items.map((rule) => ({
      ...rule,
      product: rule.productId ? (productById.get(rule.productId) ?? null) : null,
    }));

    return { data, meta: { page, pageSize, total } };
  }

  async deleteMerchandisingRule(id: string): Promise<void> {
    const existing = await this.prisma.merchandisingRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Merchandising rule not found');
    await this.prisma.merchandisingRule.delete({ where: { id } });
  }

  // ── ADMIN: ANALYTICS ───────────────────────────────────────────────────────

  async getAnalytics(dto: SearchAnalyticsQueryDto) {
    const period = dto.period ?? 30;
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);

    // Top queries (by frequency)
    const topQueriesRaw = await this.prisma.$queryRaw<
      Array<{ query: string; count: bigint; avg_results: number }>
    >(
      Prisma.sql`
        SELECT query, COUNT(*) AS count, AVG("resultCount") AS avg_results
        FROM "SearchEvent"
        WHERE "createdAt" >= ${since}
          AND query != ''
        GROUP BY query
        ORDER BY count DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `,
    );

    // Zero-result queries
    const zeroResultsRaw = await this.prisma.$queryRaw<Array<{ query: string; count: bigint }>>(
      Prisma.sql`
        SELECT query, COUNT(*) AS count
        FROM "SearchEvent"
        WHERE "createdAt" >= ${since}
          AND "resultCount" = 0
          AND query != ''
        GROUP BY query
        ORDER BY count DESC
        LIMIT ${pageSize}
      `,
    );

    // Conversion rate
    const [totalSearches, convertedSearches] = await Promise.all([
      this.prisma.searchEvent.count({ where: { createdAt: { gte: since } } }),
      this.prisma.searchEvent.count({
        where: { createdAt: { gte: since }, convertedToOrder: true },
      }),
    ]);

    const conversionRate = totalSearches > 0 ? convertedSearches / totalSearches : 0;

    // Return the analytics object directly — the global ApiResponseInterceptor
    // adds the single { data } envelope.
    return {
      topQueries: topQueriesRaw.map((r) => ({
        query: r.query,
        count: Number(r.count),
        avgResults: Math.round(Number(r.avg_results)),
      })),
      zeroResultQueries: zeroResultsRaw.map((r) => ({
        query: r.query,
        count: Number(r.count),
      })),
      conversionRate: Math.round(conversionRate * 10000) / 100, // as percentage
      totalSearches,
      period,
    };
  }

  // ── ADMIN: REINDEX ─────────────────────────────────────────────────────────

  async reindex(): Promise<{ message: string; reindexed: number }> {
    // Trigger re-computation of all searchVector columns via a dummy UPDATE
    const result = await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "Product"
        SET "updatedAt" = NOW()
        WHERE "deletedAt" IS NULL
      `,
    );
    this.logger.log(`Reindex triggered — ${result} products queued for tsvector rebuild`);
    return { message: 'Reindex triggered', reindexed: result };
  }

  /** Reindex a single product — called automatically on product mutations (M-9). */
  async reindexProduct(productId: string): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "Product" SET "updatedAt" = NOW() WHERE id = ${productId} AND "deletedAt" IS NULL`,
    );
  }

  // ── PUBLIC: RECOMMENDATIONS (stub) ────────────────────────────────────────

  getRecommendations(productIds: string[]): { data: unknown[] } {
    void productIds; // stub — future: collaborative filtering
    // Future: collaborative filtering / embeddings-based similarity
    return { data: [] };
  }

  // ── PRIVATE HELPERS ────────────────────────────────────────────────────────

  private async expandWithSynonyms(q: string): Promise<string> {
    if (!q) return q;

    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const synonyms = await this.prisma.searchSynonym.findMany({
      where: { isActive: true },
    });

    const expanded = new Set<string>(terms);

    for (const term of terms) {
      for (const synonym of synonyms) {
        if (synonym.terms.some((t) => t.toLowerCase() === term)) {
          synonym.terms.forEach((t) => expanded.add(t.toLowerCase()));
        }
      }
    }

    return Array.from(expanded).join(' ');
  }

  /**
   * Resolve a free-text query to the set of Category ids whose name matches,
   * PLUS all their descendants (subtree match). A product assigned to a child
   * category therefore matches a search for the parent's name — e.g. searching
   * "Honey" returns products filed only under "Sidr Honey".
   *
   * Walks `parentId` via a recursive CTE rather than the materialized
   * `Category.path` column, which is unreliable in this dataset (only a
   * fraction of subcategories carry a path containing their parent). See
   * specs/features/storefront-search-restore/plan.md §1.3.
   */
  private async resolveCategoryMatches(q: string): Promise<string[]> {
    const term = q.trim();
    if (!term) return [];
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        WITH RECURSIVE matched AS (
          SELECT id FROM "Category"
          WHERE "deletedAt" IS NULL
            AND (
              unaccent(COALESCE(name->>'default', '')) ILIKE '%' || unaccent(${term}) || '%'
              OR unaccent(COALESCE(name->>${storeDefaultLocale()}, '')) ILIKE '%' || unaccent(${term}) || '%'
              OR similarity(COALESCE(name->>'default', ''), ${term}) > ${TRGM_THRESHOLD}
              OR similarity(COALESCE(name->>${storeDefaultLocale()}, ''), ${term}) > ${TRGM_THRESHOLD}
            )
          UNION
          SELECT c.id FROM "Category" c
          JOIN matched m ON c."parentId" = m.id AND c."deletedAt" IS NULL
        )
        SELECT id FROM matched
      `,
    );
    return rows.map((r) => r.id);
  }

  /**
   * Resolve a free-text query to the set of Brand ids whose (authoritative,
   * Translatable) name matches. Feeds the brand OR-clause in runFtsQuery so a
   * brand keyword finds products even when the brand word is absent from the
   * product name/description/tags.
   */
  private async resolveBrandMatches(q: string): Promise<string[]> {
    const term = q.trim();
    if (!term) return [];
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id FROM "Brand"
        WHERE "deletedAt" IS NULL
          AND (
            unaccent(COALESCE(name->>'default', '')) ILIKE '%' || unaccent(${term}) || '%'
            OR unaccent(COALESCE(name->>${storeDefaultLocale()}, '')) ILIKE '%' || unaccent(${term}) || '%'
            OR similarity(COALESCE(name->>'default', ''), ${term}) > ${TRGM_THRESHOLD}
            OR similarity(COALESCE(name->>${storeDefaultLocale()}, ''), ${term}) > ${TRGM_THRESHOLD}
          )
      `,
    );
    return rows.map((r) => r.id);
  }

  private async runFtsQuery(
    expandedQ: string,
    rawQ: string,
    dto: Partial<SearchProductsDto>,
    categoryIds: string[] = [],
    brandIds: string[] = [],
  ): Promise<FtsRow[]> {
    const q = expandedQ.trim();
    const code = rawQ.trim();
    const isEmpty = q.length === 0;

    const categoryFilter = dto.categoryId
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "ProductCategory" pc
          WHERE pc."productId" = p.id AND pc."categoryId" = ${dto.categoryId}
        )`
      : Prisma.sql``;

    // Brand FILTER (exact, from the filter rail) — matches BOTH the deprecated
    // free-text Product.brand AND the authoritative Brand.name FK, so it stays
    // consistent with the facets (which now emit Brand.name) and survives the
    // S25 drop of Product.brand.
    const brandFilter = dto.brand
      ? Prisma.sql`AND (
          LOWER(COALESCE(p.brand, '')) = LOWER(${dto.brand})
          OR EXISTS (
            SELECT 1 FROM "Brand" b
            WHERE b.id = p."brandId" AND LOWER(COALESCE(b.name->>'default', '')) = LOWER(${dto.brand})
          )
        )`
      : Prisma.sql``;

    // ── Query-time coverage fragments (brand / category-subtree / reference) ──
    // unaccent() is applied to the english/simple query terms to mirror how the
    // tsvector + brand/category text were built (the trigger unaccents them);
    // the french segment is unaccented the same way, so the query is too.
    const brandMatch =
      isEmpty || code.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`(
            ${brandIds.length > 0 ? Prisma.sql`p."brandId" = ANY(${brandIds})` : Prisma.sql`FALSE`}
            OR unaccent(COALESCE(p.brand, '')) ILIKE '%' || unaccent(${code}) || '%'
          )`;

    const categoryMatch =
      isEmpty || categoryIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`EXISTS (
            SELECT 1 FROM "ProductCategory" pc
            WHERE pc."productId" = p.id AND pc."categoryId" = ANY(${categoryIds})
          )`;

    // Reference / code search: variant SKU + product MPN/GTIN. Exact or prefix,
    // case-insensitive, on the RAW query (never synonym-expanded) to avoid
    // fuzzy false positives between adjacent codes.
    const referenceMatch =
      code.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`(
            EXISTS (
              SELECT 1 FROM "ProductVariant" v
              WHERE v."productId" = p.id
                AND (LOWER(v.sku) = LOWER(${code}) OR LOWER(v.sku) LIKE LOWER(${code}) || '%')
            )
            OR LOWER(COALESCE(p.mpn, '')) = LOWER(${code})
            OR LOWER(COALESCE(p.mpn, '')) LIKE LOWER(${code}) || '%'
            OR LOWER(COALESCE(p.gtin, '')) = LOWER(${code})
            OR LOWER(COALESCE(p.gtin, '')) LIKE LOWER(${code}) || '%'
          )`;

    // One tsquery per registry config. The config is a bound parameter cast to
    // regconfig; `unaccent` follows the trigger, which skips it for rtl text.
    const tsQueries = searchTextConfigs().map(({ config, unaccent }) =>
      unaccent
        ? Prisma.sql`plainto_tsquery(${config}::regconfig, unaccent(${q}))`
        : Prisma.sql`plainto_tsquery(${config}::regconfig, ${q})`,
    );
    const tsMatch = Prisma.join(
      tsQueries.map((query) => Prisma.sql`p."searchVector" @@ ${query}`),
      ' OR ',
    );
    const tsRank = Prisma.join(
      tsQueries.map((query) => Prisma.sql`COALESCE(ts_rank_cd(p."searchVector", ${query}), 0)`),
      ' + ',
    );

    const matchCondition = isEmpty
      ? Prisma.sql`TRUE`
      : Prisma.sql`
          (
            ${tsMatch}
            OR similarity(COALESCE(p.name->>'default', ''), ${q}) > ${TRGM_THRESHOLD}
            OR similarity(COALESCE(p.name->>${storeDefaultLocale()}, ''), ${q}) > ${TRGM_THRESHOLD}
            OR ${brandMatch}
            OR ${categoryMatch}
            OR ${referenceMatch}
          )
        `;

    const rankExpr = isEmpty
      ? Prisma.sql`0`
      : Prisma.sql`
          ${tsRank} +
          GREATEST(
            similarity(COALESCE(p.name->>'default', ''), ${q}),
            similarity(COALESCE(p.name->>${storeDefaultLocale()}, ''), ${q})
          ) * 0.3
          + CASE WHEN ${referenceMatch} THEN 0.6 ELSE 0 END
          + CASE WHEN ${brandMatch} THEN 0.4 ELSE 0 END
          + CASE WHEN ${categoryMatch} THEN 0.3 ELSE 0 END
        `;

    const priceHaving =
      dto.priceMin !== undefined || dto.priceMax !== undefined
        ? Prisma.sql`
            AND (${dto.priceMin !== undefined ? Prisma.sql`MIN(pv.price) >= ${dto.priceMin}` : Prisma.sql`TRUE`})
            AND (${dto.priceMax !== undefined ? Prisma.sql`MIN(pv.price) <= ${dto.priceMax}` : Prisma.sql`TRUE`})
          `
        : Prisma.sql``;

    const ratingHaving = dto.rating
      ? Prisma.sql`AND COALESCE(AVG(rv.rating), 0) >= ${dto.rating}`
      : Prisma.sql``;

    const stockHaving = dto.inStock
      ? Prisma.sql`AND SUM(COALESCE(sl."onHand", 0) - COALESCE(sl.reserved, 0)) > 0`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<FtsRow[]>(
      Prisma.sql`
        SELECT
          p.id,
          (${rankExpr}) AS rank,
          GREATEST(
            similarity(COALESCE(p.name->>'default', ''), ${isEmpty ? '' : q}),
            similarity(COALESCE(p.name->>${storeDefaultLocale()}, ''), ${isEmpty ? '' : q})
          ) AS trgm_sim
        FROM "Product" p
        LEFT JOIN "ProductVariant" pv
          ON pv."productId" = p.id AND pv."isActive" = true
        LEFT JOIN "Review" rv
          ON rv."productId" = p.id AND rv.status = 'PUBLISHED'
        LEFT JOIN "StockLevel" sl
          ON sl."variantId" = pv.id
        WHERE p.status = 'ACTIVE'
          AND p."deletedAt" IS NULL
          AND ${matchCondition}
          ${categoryFilter}
          ${brandFilter}
        GROUP BY p.id
        HAVING TRUE
          ${priceHaving}
          ${ratingHaving}
          ${stockHaving}
        ORDER BY rank DESC, trgm_sim DESC
        LIMIT ${FTS_CANDIDATE_LIMIT}
      `,
    );

    return rows;
  }

  private async applyScoring(rows: FtsRow[], q: string): Promise<FtsRow[]> {
    if (!q || rows.length === 0) return rows;

    const activeRules = await this.prisma.merchandisingRule.findMany({
      where: {
        isActive: true,
        type: { in: ['BOOST', 'BURY'] },
        OR: [{ query: null }, { query: { equals: q, mode: 'insensitive' } }],
      },
      orderBy: { priority: 'desc' },
    });

    if (activeRules.length === 0) return rows;

    const boostMap = new Map<string, number>();
    for (const rule of activeRules) {
      if (!rule.productId) continue;
      const delta = rule.type === 'BOOST' ? 0.5 : -0.5;
      boostMap.set(rule.productId, (boostMap.get(rule.productId) ?? 0) + delta);
    }

    const adjusted = rows.map((r) => ({
      ...r,
      rank: r.rank + (boostMap.get(r.id) ?? 0),
    }));

    return adjusted.sort((a, b) => b.rank - a.rank || b.trgm_sim - a.trgm_sim);
  }

  private async applyPins(rows: FtsRow[], q: string): Promise<FtsRow[]> {
    if (rows.length === 0) return rows;

    const pinRules = await this.prisma.merchandisingRule.findMany({
      where: {
        isActive: true,
        type: 'PIN',
        OR: [{ query: null }, { query: { equals: q, mode: 'insensitive' } }],
      },
      orderBy: { position: 'asc' },
    });

    if (pinRules.length === 0) return rows;

    const result = [...rows];
    for (const rule of pinRules) {
      if (!rule.productId || rule.position === null) continue;
      const currentIdx = result.findIndex((r) => r.id === rule.productId);
      if (currentIdx === -1) continue;
      const [item] = result.splice(currentIdx, 1);
      const targetIdx = Math.min(rule.position, result.length);
      result.splice(targetIdx, 0, item);
    }
    return result;
  }

  private async fetchProductData(
    ids: string[],
    rankedRows: FtsRow[],
  ): Promise<ProductSearchResult[]> {
    if (ids.length === 0) return [];

    // Use Prisma.validator to ensure TypeScript infers the full include payload
    const include = Prisma.validator<Prisma.ProductInclude>()({
      brandRelation: { select: { name: true } },
      variants: {
        where: { isActive: true },
        orderBy: { price: 'asc' as const },
        take: 1,
        select: { id: true, price: true },
      },
      assets: {
        where: { isPrimary: true },
        take: 1,
        select: {
          assetId: true,
          isPrimary: true,
          asset: { select: { id: true, status: true, variants: true, alt: true } },
        },
      },
      categories: {
        include: { category: { select: { id: true, name: true } } },
      },
      reviews: {
        where: { status: ReviewStatus.PUBLISHED },
        select: { rating: true },
      },
    });

    type ProductRow = Prisma.ProductGetPayload<{ include: typeof include }>;

    const products: ProductRow[] = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include,
    });

    // Determine inStock: any variant with net positive stock
    const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));

    // Availability comes from InventoryService, the same seam the two product
    // endpoints were routed through at D6 (D8.33c). It replaced a raw
    // `LEFT JOIN "StockLevel"` here, which was a cross-module read this module
    // never had a grant for: DR-19 exempts search from the raw-SQL rule in
    // §3.5, not from modular isolation in §3.1.
    //
    // It also silently disagreed with the product page. The raw query summed
    // `onHand - reserved` across locations, so a location whose reservation
    // briefly exceeded its own stock produced a negative term that ate another
    // location's stock; the seam clamps per location first. Same product, two
    // answers, depending on which screen you were looking at.
    const availability = await this.inventory.availabilityForVariants(variantIds);

    const rankMap = new Map(rankedRows.map((r) => [r.id, r.rank]));

    const mapped: ProductSearchResult[] = products.map((p) => {
      const avgRating =
        p.reviews.length > 0
          ? p.reviews.reduce((acc: number, r) => acc + r.rating, 0) / p.reviews.length
          : 0;

      const totalAvailable = p.variants.reduce(
        (acc: number, v) => acc + (availability.get(v.id)?.stock ?? 0),
        0,
      );

      const rawAsset = p.assets[0];
      const assetForVariant = rawAsset?.asset as
        | {
            id: string;
            status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
            variants: unknown;
            alt?: unknown;
          }
        | undefined;
      const cardVariant = assetForVariant ? tryPickVariantUrl(assetForVariant, 'card') : null;
      const thumbnailVariant = assetForVariant
        ? tryPickVariantUrl(assetForVariant, 'thumbnail')
        : null;
      const primaryAsset =
        rawAsset && assetForVariant
          ? {
              id: assetForVariant.id,
              assetId: rawAsset.assetId,
              url: cardVariant?.url ?? '',
              altText: assetForVariant.alt ?? null,
              isPrimary: rawAsset.isPrimary,
              assetVariants: cardVariant?.srcset ?? [],
            }
          : null;
      // Prefer the authoritative Brand.name (default locale) over the
      // deprecated free-text Product.brand; falls back to it for products whose
      // brandId is still null. Survives the S25 drop of Product.brand.
      const brandName =
        (p.brandRelation?.name as { default?: string } | null | undefined)?.default ?? p.brand;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: brandName,
        tags: p.tags,
        isFeatured: p.isFeatured,
        createdAt: p.createdAt,
        minPrice: p.variants[0]?.price != null ? Number(p.variants[0].price) : null,
        avgRating: Math.round(avgRating * 10) / 10,
        reviewCount: p.reviews.length,
        inStock: totalAvailable > 0,
        availability: rollUpAvailability(
          // `availabilityForVariants` fills an entry for every id it was
          // given, so the fallback is unreachable; it is here so a variant
          // that somehow escaped the batch reads as out of stock rather than
          // as undefined, which `rollUpAvailability` would misgrade.
          p.variants.map((v) => availability.get(v.id)?.availability ?? 'OUT_OF_STOCK'),
        ),
        thumbnail: thumbnailVariant?.url ?? null,
        primaryAsset,
        categories: p.categories.map((pc) => ({
          id: pc.category.id,
          name: pc.category.name,
        })),
      };
    });

    // Re-sort mapped results to match the rank order from FTS
    mapped.sort((a, b) => (rankMap.get(b.id) ?? 0) - (rankMap.get(a.id) ?? 0));

    return mapped;
  }

  private async computeFacets(productIds: string[]): Promise<SearchFacets> {
    if (productIds.length === 0) {
      return { categories: [], brands: [], priceRange: null, ratings: [] };
    }

    const [categoryRows, brandRows, priceRow, ratingRows] = await Promise.all([
      // Categories
      this.prisma.productCategory.findMany({
        where: { productId: { in: productIds } },
        include: { category: { select: { id: true, name: true } } },
      }),
      // Brands — prefer authoritative Brand.name, fall back to the deprecated
      // free-text Product.brand. Keeps facet values consistent with the brand
      // filter (which matches both) and with the search hit output.
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { brand: true, brandRelation: { select: { name: true } } },
      }),
      // Price range
      this.prisma.productVariant.aggregate({
        where: { productId: { in: productIds }, isActive: true },
        _min: { price: true },
        _max: { price: true },
      }),
      // Rating distribution
      this.prisma.review.findMany({
        where: { productId: { in: productIds }, status: ReviewStatus.PUBLISHED },
        select: { rating: true },
      }),
    ]);

    // Aggregate categories
    const catCount = new Map<string, { name: unknown; count: number }>();
    for (const pc of categoryRows) {
      const existing = catCount.get(pc.categoryId);
      if (existing) {
        existing.count++;
      } else {
        catCount.set(pc.categoryId, { name: pc.category.name, count: 1 });
      }
    }
    const categories = Array.from(catCount.entries())
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => b.count - a.count);

    // Aggregate brands (authoritative Brand.name default, fallback Product.brand)
    const brandCount = new Map<string, number>();
    for (const p of brandRows) {
      const name =
        (p.brandRelation?.name as { default?: string } | null | undefined)?.default ?? p.brand;
      if (name) brandCount.set(name, (brandCount.get(name) ?? 0) + 1);
    }
    const brands = Array.from(brandCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Price range
    const priceRange =
      priceRow._min.price && priceRow._max.price
        ? {
            min: Number(priceRow._min.price),
            max: Number(priceRow._max.price),
          }
        : null;

    // Rating distribution (1–5)
    const ratingDist = new Map<number, number>();
    for (const r of ratingRows) {
      ratingDist.set(r.rating, (ratingDist.get(r.rating) ?? 0) + 1);
    }
    const ratings = [5, 4, 3, 2, 1]
      .filter((r) => ratingDist.has(r))
      .map((r) => ({ rating: r, count: ratingDist.get(r)! }));

    return { categories, brands, priceRange, ratings };
  }

  private async logSearchEvent(
    query: string,
    resultCount: number,
    locale: string,
    userId?: string,
    sessionId?: string,
  ): Promise<{ id: string }> {
    return this.prisma.searchEvent.create({
      data: {
        query,
        resultCount,
        locale,
        userId: userId ?? null,
        sessionId: sessionId ?? null,
      },
      select: { id: true },
    });
  }

  // ── ADMIN: ZERO-RESULTS ────────────────────────────────────────────────────

  async getZeroResults(
    period: number = 30,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<unknown> {
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);

    const grouped = await this.prisma.searchEvent.groupBy({
      by: ['query'],
      where: {
        createdAt: { gte: since },
        resultCount: 0,
        query: { not: '' },
      },
      _count: { query: true },
      orderBy: { _count: { query: 'desc' } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const total = await this.prisma.searchEvent.groupBy({
      by: ['query'],
      where: {
        createdAt: { gte: since },
        resultCount: 0,
        query: { not: '' },
      },
    });

    return {
      data: grouped.map((r) => ({ query: r.query, count: r._count.query })),
      meta: { page, pageSize, total: total.length, period },
    };
  }
}
