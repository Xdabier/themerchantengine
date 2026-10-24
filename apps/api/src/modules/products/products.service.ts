import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ProductNotFoundException } from './product-not-found.exception';
import { ProductSlugTakenException } from './product-slug-taken.exception';
import { ProductSkuTakenException } from './product-sku-taken.exception';
import { ProductVariantNotFoundException } from './product-variant-not-found.exception';
import { ProductFaqNotFoundException } from './product-faq-not-found.exception';
import { ProductTypeNotFoundException } from './product-type-not-found.exception';
import { ProductTypeCodeTakenException } from './product-type-code-taken.exception';
import { ProductAttributeNotFoundException } from './product-attribute-not-found.exception';
import { ProductAttributeValueNotFoundException } from './product-attribute-value-not-found.exception';
import { ProductAttributeValueCodeTakenException } from './product-attribute-value-code-taken.exception';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, ProductStatus } from '@prisma/client';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService, type VariantAvailability } from '../inventory/inventory.service';
import { CategoriesService } from '../categories/categories.service';
import { ProductCategoryNotFoundException } from './product-category-not-found.exception';
import { ProductSpecDuplicateKeyException } from './product-spec-duplicate-key.exception';
import { ProductSpecEmptyKeyException } from './product-spec-empty-key.exception';
import { specKey } from '@common/utils';
import type { ListSpecLabelsAdminDto, ReplaceProductSpecsAdminDto } from './dto/replace-specs.dto';
import { stockStatusFor, type StockStatus } from '../inventory/inventory.constants';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import { resolveTranslatable } from '@common/interceptors';
import { storeLocales } from '@common/locale';
import { sanitizeTranslatableHtml } from '@common/utils';
import { tryPickVariantUrl } from '@common/asset-variants';
import {
  gradeFromScore,
  PRODUCT_DETAIL_CACHE_PREFIX,
  PUBLIC_VARIANT_SELECT,
  PRODUCT_DETAIL_TTL_SECONDS,
  PRODUCT_QUALITY_CACHE_PREFIX,
  PRODUCT_QUALITY_TTL_SECONDS,
  PRODUCT_MUTATED_EVENT,
  type ProductMutatedEventPayload,
  PRODUCT_SLUG_CHANGED_EVENT,
  PRODUCTS_REDIS_CLIENT,
  QUALITY_WEIGHTS,
  QualityGrade,
  STOREFRONT_COMPUTED_SORT_FIELDS,
  VALID_PRODUCT_SORT_FIELDS,
  VALID_STOREFRONT_SORT_FIELDS,
} from './products.constants';
import type { CreateProductTypeAdminDto } from './dto/create-product-type.dto';
import type { UpdateProductTypeAdminDto } from './dto/update-product-type.dto';
import type { CreateAttributeAdminDto } from './dto/create-attribute.dto';
import type { UpdateAttributeAdminDto } from './dto/update-attribute.dto';
import type { CreateAttributeValueAdminDto } from './dto/create-attribute-value.dto';
import type { UpdateAttributeValueAdminDto } from './dto/update-attribute-value.dto';
import type { CreateProductAdminDto } from './dto/create-product.dto';
import type { UpdateProductAdminDto } from './dto/update-product.dto';
import type { CreateProductVariantAdminDto } from './dto/create-variant.dto';
import type { UpdateProductVariantAdminDto } from './dto/update-variant.dto';
import type { UpdateProductAssetsAdminDto } from './dto/update-assets.dto';
import type { CreateProductFaqAdminDto } from './dto/create-faq.dto';
import type { UpdateProductFaqAdminDto } from './dto/update-faq.dto';
import type { BulkUpdatePricesAdminDto } from './dto/bulk-prices.dto';
import type { BulkUpdateStatusAdminDto } from './dto/bulk-status.dto';
import type { ListProductsAdminDto, ListProductsStorefrontDto } from './dto/query-products.dto';

/**
 * Translatable keys the admin product search reads. `default` is the fallback
 * the i18n interceptor writes, so a product created before a locale existed is
 * still findable.
 */
function translatableSearchLocales(): string[] {
  return [...storeLocales.current().supportedLocales, 'default'];
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type QualityScore = {
  score: number;
  grade: QualityGrade;
  breakdown: Record<keyof typeof QUALITY_WEIGHTS, boolean>;
};

type ProductWithRelations = {
  id: string;
  name: unknown;
  slug: string;
  description: unknown;
  shortDescription: unknown;
  metaTitle: unknown;
  metaDescription: unknown;
  assets: { sortOrder: number; isPrimary: boolean }[];
  categories: { categoryId: string }[];
  variants: {
    sku: string;
    price: unknown;
    isActive: boolean;
    weight: unknown;
    deletedAt: Date | null;
  }[];
  faqs: { id: string }[];
};

// ── Variant availability ───────────────────────────────────────────────────────

/**
 * What a variant carries on the public wire: the three-state grade only.
 * The exact count stays server-side. These endpoints are unauthenticated, and a
 * caller paging the catalogue could otherwise read off the whole store's
 * inventory position (restock cadence, sell-through, low runners). Brand floor
 * §9 renders the grade and its colour, never the number, and §8.2 forbids
 * "only N left" urgency framing on this client, so nothing sanctioned needs it.
 */
type PublicAvailability = { availability: StockStatus };

/** Grade for a variant the inventory module reported nothing for. */
const NO_STOCK: PublicAvailability = { availability: 'OUT_OF_STOCK' };

/**
 * Attaches the grade `InventoryService.availabilityForVariants` produced onto
 * each variant, keeping only what may cross the wire. Both storefront reads go
 * through it, and both grade through the same rule against the same store
 * threshold, so a product card and that product's page can never show a
 * different state for the same variant. The detail path deliberately grades
 * after its cache, so a cached page cannot serve a stale stock state.
 */
function attachAvailability<T extends { id: string }>(
  variants: T[],
  grades: Map<string, VariantAvailability>,
): (Omit<T, 'stock'> & PublicAvailability)[] {
  return variants.map((variant) => {
    const graded: Record<string, unknown> = { ...variant };
    // Deleted rather than merely not added: a cache entry written before the
    // count was dropped would otherwise spread it straight back onto the wire.
    delete graded['stock'];
    graded['availability'] = grades.get(variant.id)?.availability ?? NO_STOCK.availability;
    return graded as Omit<T, 'stock'> & PublicAvailability;
  });
}

// ── Slug helpers ───────────────────────────────────────────────────────────────

/** Converts any text to a URL-safe lowercase slug */
export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^\w\s-]/g, '') // remove special chars
    .replace(/\s+/g, '-') // spaces → hyphens
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-|-$/g, ''); // trim leading/trailing hyphens
}

// ── Quality score ──────────────────────────────────────────────────────────────

type Translatable = Record<string, string | undefined> | null | undefined;

/** The locale keys a fully-translated product must carry: `default` plus every locale the store enables. */
function qualityLocales(): string[] {
  return ['default', ...storeLocales.current().supportedLocales];
}

function hasAllLocales(field: Translatable): boolean {
  if (!field) return false;
  const t = field as Record<string, string>;
  return qualityLocales().every((l) => Boolean(t[l]));
}

function descriptionMinLength(field: Translatable, min: number): boolean {
  if (!field) return false;
  const t = field as Record<string, string>;
  return qualityLocales().every((l) => t[l] && t[l].length >= min);
}

function startsWithAnswer(field: Translatable): boolean {
  if (!field) return false;
  const t = field as Record<string, string>;
  const text = (
    t['default'] ||
    storeLocales
      .current()
      .supportedLocales.map((l) => t[l])
      .find(Boolean) ||
    ''
  ).trimStart();
  // Reject descriptions that lead with a question word/phrase. Both locales are
  // covered: `default` now carries French, so an English-only pattern would
  // score every French description as answer-first for free. The negative
  // lookahead keeps `however` / `quelconque` from matching `how` / `quel`.
  const questionPattern =
    /^(what|why|how|when|where|who|is|are|do|does|did|can|could|should|would|quel|quelle|quels|quelles|quoi|pourquoi|comment|quand|où|qui|est-ce|peut-on|faut-il|combien)(?![a-z])/i;
  return !questionPattern.test(text);
}

export function computeQualityScore(product: ProductWithRelations): QualityScore {
  const activeVariants = product.variants.filter((v) => !v.deletedAt && v.isActive);

  const breakdown: Record<keyof typeof QUALITY_WEIGHTS, boolean> = {
    hasNameAllLocales: hasAllLocales(product.name as Translatable),
    hasDescriptionAllLocales: descriptionMinLength(product.description as Translatable, 50),
    hasShortDescriptionAllLocales: hasAllLocales(product.shortDescription as Translatable),
    hasThreePlusImages: product.assets.length >= 3,
    hasPrimaryCategory: product.categories.length > 0,
    hasVariantWithPrice:
      activeVariants.length > 0 && activeVariants.some((v) => Number(v.price) > 0),
    allVariantsHaveSku: activeVariants.length > 0 && activeVariants.every((v) => Boolean(v.sku)),
    hasMetaTitleAllLocales: hasAllLocales(product.metaTitle as Translatable),
    hasMetaDescriptionAllLocales: hasAllLocales(product.metaDescription as Translatable),
    hasWeight: activeVariants.some((v) => v.weight != null && Number(v.weight) > 0),
    hasFaq: product.faqs.length > 0,
    descriptionAnswerFirst: startsWithAnswer(product.description as Translatable),
  };

  const score = (Object.keys(QUALITY_WEIGHTS) as (keyof typeof QUALITY_WEIGHTS)[]).reduce(
    (acc, key) => acc + (breakdown[key] ? QUALITY_WEIGHTS[key] : 0),
    0,
  );

  return { score, grade: gradeFromScore(score), breakdown };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Viability bar for a specification facet, applied to live data.
 *
 * A facet needs to cover enough of the catalogue to be worth a control, and it
 * needs at least two values that each hold more than one product. Without the
 * second half, every option selects exactly one product and the control sorts
 * rather than filters.
 */
const MIN_FACET_COVERAGE = Number(process.env['STOREFRONT_MIN_FACET_COVERAGE'] ?? 6);
const MIN_FACET_VALUE_COUNT = 2;
const MIN_FACET_VALUES = 2;
/**
 * A facet value is a label, not a sentence.
 *
 * Some specification rows carry prose rather than a value: "Caracteristique"
 * holds things like "Faible bruit, qualite superieure". Those pass the coverage
 * and cardinality bars honestly and still make a useless control, because a
 * checkbox reading a full clause tells the buyer nothing and wraps to three
 * lines. Length is the mechanical way to tell a value from a sentence, so this
 * stays automatic rather than becoming a curated exclusion list.
 */
const MAX_FACET_VALUE_LENGTH = 32;
/**
 * How unique a facet's values may be before it stops being a filter.
 *
 * distinct values divided by covered products. A good facet concentrates:
 * "certification" is 3 values over 52 products, ratio 0.06, so each option
 * selects a real group. A bad one is nearly one value per product: "type" is 25
 * values over 33 products, ratio 0.76, so it sorts rather than filters and the
 * rail carries 25 checkboxes that each match one item.
 *
 * This is the mechanical expression of "a filter has to actually filter", and
 * it is what keeps the automatic rule from producing an unusable rail.
 */
const MAX_FACET_VALUE_SPREAD = Number(process.env['STOREFRONT_MAX_FACET_SPREAD'] ?? 0.35);

const PRODUCT_SPEC_FACETS_CACHE_KEY = 'products:spec-facets';
const PRODUCT_SPEC_FACETS_CACHE_TTL = 300;

/** Brand facets, cached per category scope: products:brand-facets:<categoryId|all>. */
const PRODUCT_BRAND_FACETS_CACHE_PREFIX = 'products:brand-facets:';
const PRODUCT_BRAND_FACETS_CACHE_TTL = 300;

/** Cap on how many filter tokens one request may carry. */
const MAX_FILTER_TOKENS = 32;

/** Split a comma-separated filter param into clean, capped tokens. */
function splitFilterList(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_FILTER_TOKENS);
}

/** "alimentation:electrique" -> group "alimentation". */
function groupByFacet(tokens: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const token of tokens) {
    const sep = token.indexOf(':');
    const facet = sep > 0 ? token.slice(0, sep) : token;
    groups.set(facet, [...(groups.get(facet) ?? []), token]);
  }
  return groups;
}

/** "pression-d-air:0-30-a-0-35-mpa" -> key "pression-d-air", value "0-30-a-0-35-mpa". */
function groupBySpecKey(tokens: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const token of tokens) {
    const sep = token.indexOf(':');
    if (sep <= 0 || sep === token.length - 1) continue;
    const key = token.slice(0, sep);
    const value = token.slice(sep + 1);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

/**
 * Push clauses onto `where.AND` without clobbering whatever is already there.
 *
 * Both the tag filter and the spec filter contribute AND clauses, so assigning
 * `where.AND` directly would make whichever ran second silently drop the first.
 */
function appendAnd(where: Record<string, unknown>, clauses: object[]): void {
  const existing = Array.isArray(where['AND']) ? (where['AND'] as object[]) : [];
  where['AND'] = [...existing, ...clauses];
}

/**
 * A BCP-47 tag `Intl.Collator` will accept, or undefined for the runtime
 * default. `resolveRequestLocale` can hand back `default` (no preference
 * stated) or an internal sentinel for an unsupported tag, and neither is a
 * language tag: passing either to the collator constructor throws RangeError.
 */
function collatorLocale(locale: string): string | undefined {
  return /^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : undefined;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  private readonly pageSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly inventory: InventoryService,
    private readonly categories: CategoriesService,
    @Inject(PRODUCTS_REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.pageSize = this.config.get<number>('DEFAULT_PAGE_SIZE', 20);
  }

  // ── Storefront ──────────────────────────────────────────────────────────────

  /**
   * `locale` is the resolved request locale, not a display concern: the
   * "Name: A to Z" sort has to order on the string the customer reads, so the
   * fr catalogue orders on the fr name. Defaults to `default`, which is the
   * key every Translatable is required to carry.
   */
  async listProducts(
    query: ListProductsStorefrontDto,
    locale = 'default',
  ): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? this.pageSize, 100);
    const skip = (page - 1) * pageSize;

    const sortBy = VALID_STOREFRONT_SORT_FIELDS.includes(
      query.sortBy as (typeof VALID_STOREFRONT_SORT_FIELDS)[number],
    )
      ? query.sortBy
      : 'sortOrder';
    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';

    const where: Record<string, unknown> = { status: ProductStatus.ACTIVE };

    if (query.categoryId) {
      where['categories'] = { some: { categoryId: query.categoryId } };
    }
    if (query.ids) {
      const ids = query.ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 100);
      if (ids.length) where['id'] = { in: ids };
    }
    if (query.brand) where['brand'] = query.brand;
    if (query.isFeatured !== undefined) where['isFeatured'] = query.isFeatured;
    if (query.tags) {
      // Comma-separated, grouped by facet prefix: values within one facet OR,
      // facets AND. `has` took a single scalar, so `tags=a,b` matched a literal
      // tag "a,b" that no product carries and the grid silently came back empty.
      // It also made `docs/storefront-api-reference.md` untrue.
      //
      // OR-within is not a preference. Selecting `alimentation:electrique` and
      // `alimentation:air-comprime` under AND-within returns nothing, because no
      // handpiece is both, so the customer's own second click would empty the page.
      const groups = groupByFacet(splitFilterList(query.tags));
      if (groups.size > 0) {
        appendAnd(
          where,
          [...groups.values()].map((values) => ({ tags: { hasSome: values } })),
        );
      }
    }
    if (query.specs) {
      // Specification filters, keyed off the normalised ProductSpec columns
      // rather than display text, so a filter means the same thing in fr and en.
      // Same OR-within, AND-across shape as tags.
      const groups = groupBySpecKey(splitFilterList(query.specs));
      if (groups.size > 0) {
        appendAnd(
          where,
          [...groups].map(([key, values]) => ({
            specs: { some: { key, valueKey: { in: values } } },
          })),
        );
      }
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where['variants'] = {
        some: {
          isActive: true,
          deletedAt: null,
          price: {
            ...(query.minPrice !== undefined && { gte: query.minPrice }),
            ...(query.maxPrice !== undefined && { lte: query.maxPrice }),
          },
        },
      };
    }

    // `price` and `name` are not `Product` columns, so their order is computed
    // over the whole filtered set before the page is cut. `pageIds` is null for
    // the column sorts, which keep ordering and skip/take in SQL.
    const ordered = STOREFRONT_COMPUTED_SORT_FIELDS.includes(
      sortBy as (typeof STOREFRONT_COMPUTED_SORT_FIELDS)[number],
    )
      ? await this.orderedIdsForComputedSort(where, sortBy as 'price' | 'name', sortOrder, locale)
      : null;
    const pageIds = ordered
      ? { ids: ordered.ids.slice(skip, skip + pageSize), total: ordered.total }
      : null;

    const [total, products] = await Promise.all([
      pageIds ? Promise.resolve(pageIds.total) : this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where: pageIds ? { ...where, id: { in: pageIds.ids } } : where,
        select: {
          id: true,
          name: true,
          slug: true,
          shortDescription: true,
          status: true,
          brand: true,
          tags: true,
          isFeatured: true,
          sortOrder: true,
          publishedAt: true,
          assets: {
            where: { isPrimary: true },
            select: {
              assetId: true,
              sortOrder: true,
              isPrimary: true,
              asset: {
                select: {
                  id: true,
                  url: true,
                  type: true,
                  alt: true,
                  status: true,
                  variants: true,
                },
              },
            },
            take: 1,
          },
          variants: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true,
              sku: true,
              price: true,
              compareAtPrice: true,
              isDefault: true,
            },
            // The card renders `variants[0]`, and `isDefault` alone leaves that
            // to the physical row order when no variant is flagged. The price
            // sort in `orderedIdsForComputedSort` reads the same variant.
            orderBy: [{ isDefault: 'desc' }, { price: 'asc' }, { id: 'asc' }],
          },
        },
        // A computed sort already knows the page and its order; re-applying
        // skip/take here would cut a second page out of the first one.
        ...(pageIds ? {} : { orderBy: { [sortBy as string]: sortOrder }, skip, take: pageSize }),
      }),
    ]);

    if (pageIds) {
      const rank = new Map(pageIds.ids.map((id, i) => [id, i]));
      products.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }

    // One call for the whole page: card availability must not depend on which
    // row it sits in, and stock rows belong to the inventory module (§3.1).
    const grades = await this.inventory.availabilityForVariants(
      products.flatMap((p) => p.variants.map((v) => v.id)),
    );

    // Surface a flat `primaryAsset` field on each product so the storefront's
    // ProductSummary schema can render images directly. Per asset-variant-serving
    // (AV1) `url` is now the canonical 'card'-intent variant URL and
    // `assetVariants` carries the responsive set for `<picture>` consumers.
    const data = products.map((p) => {
      const first = (
        p as unknown as {
          assets: Array<{
            assetId: string;
            sortOrder: number;
            isPrimary: boolean;
            asset: {
              id: string;
              url: string;
              type: string;
              alt: unknown;
              status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
              variants: unknown;
            } | null;
          }>;
        }
      ).assets[0];
      const variant = first?.asset ? tryPickVariantUrl(first.asset, 'card') : null;
      const primaryAsset = first?.asset
        ? {
            id: first.asset.id,
            assetId: first.assetId,
            url: variant?.url ?? '',
            type: first.asset.type,
            altText: first.asset.alt,
            isPrimary: first.isPrimary,
            sortOrder: first.sortOrder,
            assetVariants: variant?.srcset ?? [],
          }
        : null;
      return { ...p, variants: attachAvailability(p.variants, grades), primaryAsset };
    });

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /**
   * The filtered catalogue in `price` or `name` order, plus its size.
   *
   * Neither field can be a Prisma `orderBy` on `Product`: `price` lives on the
   * `ProductVariant` to-many, and `name` is Translatable JSONB whose jsonb
   * ordering compares the whole object and therefore sorts every locale by its
   * `en` string. See `STOREFRONT_COMPUTED_SORT_FIELDS`.
   *
   * So the order is computed here, over the ids the same `where` selects. The
   * scan is deliberately not capped: a cap would return a page from a truncated
   * ordering and look right, which is the failure mode this defect already had.
   * It reads two narrow columns per ACTIVE product and no relations beyond one
   * variant row, and the page hydration below is still one page wide.
   *
   * `price` is the price the card shows, not the cheapest variant: the tile
   * renders `variants[0]` under the same `isDefault desc` ordering, so a
   * catalogue sorted by price reads in the order of the numbers on screen. The
   * `price` then `id` tiebreaks make that variant deterministic, which it was
   * not before.
   *
   * A product with no active variant has no price to sort on. It sorts last in
   * BOTH directions rather than to the top of `desc`, because "highest price
   * first" leading with priceless rows is the same lie as an unsorted grid.
   */
  private async orderedIdsForComputedSort(
    where: Record<string, unknown>,
    sortBy: 'price' | 'name',
    sortOrder: 'asc' | 'desc',
    locale: string,
  ): Promise<{ ids: string[]; total: number }> {
    const rows = await this.prisma.product.findMany({
      where: where as Prisma.ProductWhereInput,
      select: {
        id: true,
        name: true,
        variants: {
          where: { isActive: true, deletedAt: null },
          select: { price: true },
          orderBy: [{ isDefault: 'desc' }, { price: 'asc' }, { id: 'asc' }],
          take: 1,
        },
      },
    });

    const keyed = rows.map((r) => ({
      id: r.id,
      price: r.variants[0] ? Number(r.variants[0].price) : null,
      name: resolveTranslatable(r.name, locale),
    }));

    const collator = new Intl.Collator(collatorLocale(locale), {
      sensitivity: 'base',
      numeric: true,
    });
    const dir = sortOrder === 'desc' ? -1 : 1;

    keyed.sort((a, b) => {
      if (sortBy === 'price') {
        if (a.price === null || b.price === null) {
          if (a.price === b.price) return a.id.localeCompare(b.id);
          return a.price === null ? 1 : -1;
        }
        const cmp = a.price - b.price;
        return cmp !== 0 ? cmp * dir : a.id.localeCompare(b.id);
      }
      const cmp = collator.compare(a.name, b.name);
      return cmp !== 0 ? cmp * dir : a.id.localeCompare(b.id);
    });

    return { ids: keyed.map((k) => k.id), total: keyed.length };
  }

  /**
   * Grades every variant of a product detail payload through the inventory
   * module. Both the cache-hit and the cache-miss path call it, because the
   * grade is deliberately never cached: nothing invalidates the detail key when
   * stock moves, so a cached grade would keep serving a sold-out product as
   * IN_STOCK (or a restocked one as OUT_OF_STOCK) for the whole TTL.
   */
  private async gradeDetailVariants<T extends { variants?: { id: string }[] }>(
    product: T,
  ): Promise<Omit<T, 'variants'> & { variants: unknown[] }> {
    const variants = product.variants ?? [];
    const grades = await this.inventory.availabilityForVariants(variants.map((v) => v.id));
    return { ...product, variants: attachAvailability(variants, grades) };
  }

  /**
   * Filterable specification facets, derived from the live ProductSpec rows.
   *
   * The operator's rule is that every specification becomes a filter without
   * anyone curating a list. So the source here is the spec rows themselves, not
   * a hand-maintained facet table: type a new specification on enough products
   * and it appears in the rail by itself.
   *
   * The one mechanical guard is viability, because a filter that cannot filter
   * is worse than no filter. `numero de modele` sits on 63 products with 63
   * distinct values, so every option would select exactly one product and the
   * rail would carry a 63-option list that narrows nothing. A facet ships only
   * when it covers `MIN_FACET_COVERAGE` products AND at least two of its values
   * each hold two or more, which is the same bar the seed pipeline applies.
   *
   * Counts and options reflect the whole ACTIVE catalogue rather than the loaded
   * page, so a facet does not appear or vanish as the customer pages.
   */
  async listSpecFacets(): Promise<unknown> {
    const cacheKey = `${PRODUCT_SPEC_FACETS_CACHE_KEY}`;
    const cached = await this.tryGetCache(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.productSpec.findMany({
      where: { product: { status: ProductStatus.ACTIVE, deletedAt: null } },
      select: { key: true, valueKey: true, label: true, value: true, productId: true },
    });

    interface Bucket {
      label: unknown;
      values: Map<string, { value: unknown; products: Set<string> }>;
      products: Set<string>;
    }
    const byKey = new Map<string, Bucket>();

    for (const row of rows) {
      let bucket = byKey.get(row.key);
      if (!bucket) {
        bucket = { label: row.label, values: new Map(), products: new Set() };
        byKey.set(row.key, bucket);
      }
      bucket.products.add(row.productId);
      let entry = bucket.values.get(row.valueKey);
      if (!entry) {
        entry = { value: row.value, products: new Set() };
        bucket.values.set(row.valueKey, entry);
      }
      entry.products.add(row.productId);
    }

    const facets = [...byKey]
      .map(([key, bucket]) => ({
        key,
        label: bucket.label,
        coverage: bucket.products.size,
        values: [...bucket.values]
          .filter(([valueKey]) => valueKey.length <= MAX_FACET_VALUE_LENGTH)
          .map(([valueKey, entry]) => ({
            valueKey,
            value: entry.value,
            count: entry.products.size,
          }))
          .sort((a, b) => b.count - a.count || a.valueKey.localeCompare(b.valueKey)),
      }))
      .filter(
        (facet) =>
          facet.coverage >= MIN_FACET_COVERAGE &&
          facet.values.filter((v) => v.count >= MIN_FACET_VALUE_COUNT).length >= MIN_FACET_VALUES &&
          facet.values.length / facet.coverage <= MAX_FACET_VALUE_SPREAD,
      )
      .sort((a, b) => b.coverage - a.coverage || a.key.localeCompare(b.key));

    await this.trySetCache(cacheKey, facets, PRODUCT_SPEC_FACETS_CACHE_TTL);
    return facets;
  }

  /**
   * Brand facets for the catalogue rail, over the whole ACTIVE catalogue.
   *
   * The rail used to derive its brand list from the products on screen, which
   * is a page-1 sample of the already-filtered result: pick a brand and the
   * sample holds one brand, so the facet collapsed to the selection and the
   * shopper could not switch without clearing (finding C11).
   *
   * Grouped on the legacy `Product.brand` string because that is the column
   * `listProducts` filters on (`where.brand = query.brand`). Moving both to the
   * `Brand` FK is a separate track.
   */
  async listBrandFacets(categoryId?: string): Promise<unknown> {
    const cacheKey = `${PRODUCT_BRAND_FACETS_CACHE_PREFIX}${categoryId ?? 'all'}`;
    const cached = await this.tryGetCache(cacheKey);
    if (cached) return cached;

    const where: Record<string, unknown> = {
      status: ProductStatus.ACTIVE,
      deletedAt: null,
    };
    if (categoryId) where['categories'] = { some: { categoryId } };

    const rows = await this.prisma.product.findMany({ where, select: { brand: true } });

    const counts = new Map<string, number>();
    for (const row of rows) {
      const brand = row.brand?.trim();
      if (!brand) continue;
      counts.set(brand, (counts.get(brand) ?? 0) + 1);
    }

    const facets = [...counts]
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));

    await this.trySetCache(cacheKey, facets, PRODUCT_BRAND_FACETS_CACHE_TTL);
    return facets;
  }

  async getProductBySlug(slug: string): Promise<unknown> {
    const cacheKey = `${PRODUCT_DETAIL_CACHE_PREFIX}${slug}`;
    const cached = await this.tryGetCache(cacheKey);
    if (cached) return this.gradeDetailVariants(cached as { variants?: { id: string }[] });

    const product = await this.prisma.product.findFirst({
      where: { slug, status: ProductStatus.ACTIVE },
      include: {
        // Explicit select, never a bare `include`: this route is @Public(), so
        // every ProductVariant column an include would add goes to anonymous
        // callers. `costPrice` is the merchant's purchase cost and `licenseKey`
        // is the paid deliverable on a digital variant (plan J, sweep S1). The
        // list endpoint below has always selected explicitly; the detail path
        // is the one that drifted.
        variants: {
          where: { isActive: true, deletedAt: null },
          select: PUBLIC_VARIANT_SELECT,
          orderBy: [{ isDefault: 'desc' }, { price: 'asc' }, { id: 'asc' }],
        },
        assets: {
          orderBy: { sortOrder: 'asc' },
          include: {
            asset: {
              select: {
                id: true,
                url: true,
                type: true,
                alt: true,
                status: true,
                variants: true,
              },
            },
          },
        },
        faqs: { orderBy: { sortOrder: 'asc' } },
        // Free-form specification rows, rendered as the product spec table.
        // Included here rather than fetched separately so they ride the
        // existing detail cache instead of adding a second round trip.
        specs: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, label: true, value: true, key: true, sortOrder: true },
        },
        // Filter junction rows whose category is hidden (isVisible=false) so
        // breadcrumb / related-product links never point at a category that
        // 404s from the public /v1/categories/:slug surface. The
        // soft-delete middleware already excludes deletedAt rows for
        // Category.
        categories: {
          where: { category: { isVisible: true } },
          include: { category: { select: { id: true, name: true, slug: true } } },
        },
        productType: { select: { id: true, name: true, code: true } },
      },
    });

    if (!product) throw new ProductNotFoundException();

    type AssetJoin = {
      assetId: string;
      sortOrder: number;
      isPrimary: boolean;
      asset: {
        id: string;
        url: string;
        type: string;
        alt: unknown;
        status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
        variants: unknown;
      } | null;
    };
    // Per AV1 — `url` resolves to the 'detail' variant (large 1200 px) for
    // product gallery primary; `assetVariants` carries the responsive set.
    const assetsForResponse = (product.assets as unknown as AssetJoin[]).map((a) => {
      const variant = a.asset ? tryPickVariantUrl(a.asset, 'detail') : null;
      return {
        id: a.asset?.id,
        assetId: a.assetId,
        url: variant?.url ?? '',
        type: a.asset?.type,
        altText: a.asset?.alt,
        isPrimary: a.isPrimary,
        sortOrder: a.sortOrder,
        assetVariants: variant?.srcset ?? [],
      };
    });
    const primary = assetsForResponse.find((a) => a.isPrimary) ?? assetsForResponse[0] ?? null;
    // Cached without `stock` / `availability` on purpose: see gradeDetailVariants.
    const serialized = {
      ...product,
      assets: assetsForResponse,
      primaryAsset: primary,
      variants: product.variants.map((v) => ({ ...v, price: Number(v.price) })),
    };
    await this.trySetCache(cacheKey, serialized, PRODUCT_DETAIL_TTL_SECONDS);
    return this.gradeDetailVariants(serialized);
  }

  // ── Admin: Products ─────────────────────────────────────────────────────────

  async adminListProducts(query: ListProductsAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? this.pageSize, 100);
    const skip = (page - 1) * pageSize;

    const sortBy = VALID_PRODUCT_SORT_FIELDS.includes(
      query.sortBy as (typeof VALID_PRODUCT_SORT_FIELDS)[number],
    )
      ? query.sortBy
      : 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.categoryId) where['categories'] = { some: { categoryId: query.categoryId } };
    if (query.productTypeId) where['productTypeId'] = query.productTypeId;
    if (query.brand) where['brand'] = query.brand;
    if (query.isFeatured !== undefined) where['isFeatured'] = query.isFeatured;
    const search = query.search?.trim();
    if (search) {
      // Slug (derived from the EN name) is the cheap proxy, same call the
      // global search makes in search/global-search.service.ts.
      //
      // Operators type the name they see, spaces and all, so the slug side of
      // the OR matches on the slugified term too. Without it "Sidr Honey"
      // never matches slug "sidr-honey" and the box looks broken.
      //
      // The `name` JSONB clauses cover what no slug can: an accented French
      // term (a slug drops accents, so "poignée" only ever matches on the JSONB
      // side) and an EN name edited after the slug was minted. Prisma JSON path
      // filters keep this composable with the filters above and off raw SQL
      // (§3.5).
      const insensitive = Prisma.QueryMode.insensitive;
      const slugTerm = toSlug(search);
      const searchOr: Prisma.ProductWhereInput[] = [
        { slug: { contains: search, mode: insensitive } },
      ];
      if (slugTerm && slugTerm !== search.toLowerCase()) {
        searchOr.push({ slug: { contains: slugTerm, mode: insensitive } });
      }
      searchOr.push(
        { variants: { some: { sku: { contains: search, mode: insensitive }, deletedAt: null } } },
        { brand: { contains: search, mode: insensitive } },
        ...translatableSearchLocales().map(
          (locale): Prisma.ProductWhereInput => ({
            name: { path: [locale], string_contains: search, mode: insensitive },
          }),
        ),
      );
      where['OR'] = searchOr;
    }

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: {
          variants: {
            where: { deletedAt: null },
            select: {
              id: true,
              sku: true,
              price: true,
              isActive: true,
              isDefault: true,
              weight: true,
            },
          },
          assets: { select: { assetId: true, isPrimary: true, sortOrder: true } },
          categories: { select: { categoryId: true } },
          faqs: { select: { id: true } },
        },
        orderBy: { [sortBy as string]: sortOrder },
        skip,
        take: pageSize,
      }),
    ]);

    // Attach cached quality scores
    const withScores = await Promise.all(
      products.map(async (p) => {
        const qualityScore = await this.getCachedQualityScore(p as unknown as ProductWithRelations);
        return { ...p, qualityScore };
      }),
    );

    return {
      data: withScores,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async adminGetProduct(id: string): Promise<unknown> {
    // Admin detail must surface archived products so operators can audit or
    // restore them. The soft-delete middleware only skips when `deletedAt`
    // is already present as a top-level `where` key, so we try the live
    // row first and fall back to an explicit archived lookup.
    const include = {
      variants: {
        where: { deletedAt: null },
        include: { attributeValues: { include: { attributeValue: true } } },
        orderBy: [{ isDefault: 'desc' as const }, { sku: 'asc' as const }],
      },
      assets: {
        orderBy: { sortOrder: 'asc' as const },
        include: {
          asset: {
            select: {
              id: true,
              // AV1 nit #1 carry-forward — `url` is now the canonical large-
              // webp variant URL on READY rows but admin previews now resolve
              // through the `variants` payload via the AV3 shim. Kept for
              // backwards compatibility with legacy tile fallback paths.
              url: true,
              type: true,
              alt: true,
              status: true,
              // AV3 — admin product-detail Media tab + media-strip thumbs
              // resolve via the canonical variant URL shim. Without this
              // field the resolver falls back to null and admin renders a
              // status-label placeholder block instead of a thumbnail.
              variants: true,
              mimeType: true,
              fileSize: true,
              width: true,
              height: true,
            },
          },
        },
      },
      faqs: { orderBy: { sortOrder: 'asc' as const } },
      // The storefront has rendered specs since they landed
      // (`getProductBySlug`'s include); the admin was the only surface that
      // could not see them.
      specs: { orderBy: { sortOrder: 'asc' as const } },
      categories: { include: { category: { select: { id: true, name: true, slug: true } } } },
      productType: {
        include: {
          attributes: {
            include: { attributeValues: true },
            orderBy: { sortOrder: 'asc' as const },
          },
        },
      },
    };
    const product =
      (await this.prisma.product.findUnique({ where: { id }, include })) ??
      (await this.prisma.product.findFirst({
        where: { id, deletedAt: { not: null } },
        include,
      }));

    if (!product) throw new ProductNotFoundException();

    const qualityScore = await this.getCachedQualityScore(
      product as unknown as ProductWithRelations,
    );
    return { ...product, qualityScore };
  }

  async createProduct(dto: CreateProductAdminDto): Promise<unknown> {
    const slug = dto.slug ?? (await this.generateUniqueSlug(dto.name.default));

    const existing = await this.prisma.product.findUnique({ where: { slug } });
    if (existing) throw new ProductSlugTakenException(slug);

    await this.assertCategoriesExist(dto.categoryIds ?? []);

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: dto.name as object,
          slug,
          description: dto.description
            ? (sanitizeTranslatableHtml(
                dto.description as unknown as Record<string, string>,
              ) as object)
            : undefined,
          shortDescription: dto.shortDescription
            ? (sanitizeTranslatableHtml(
                dto.shortDescription as unknown as Record<string, string>,
              ) as object)
            : undefined,
          status: dto.status ?? ProductStatus.DRAFT,
          productTypeId: dto.productTypeId ?? null,
          brand: dto.brand ?? null,
          tags: dto.tags ?? [],
          isFeatured: dto.isFeatured ?? false,
          isDigital: dto.isDigital ?? false,
          sortOrder: dto.sortOrder ?? 0,
          metaTitle: dto.metaTitle as object | undefined,
          metaDescription: dto.metaDescription as object | undefined,
        },
      });

      // Category assignments
      if (dto.categoryIds?.length) {
        await tx.productCategory.createMany({
          data: dto.categoryIds.map((categoryId) => ({
            productId: created.id,
            categoryId,
          })),
        });
      }

      // Asset assignments
      if (dto.assetIds?.length) {
        await tx.productAsset.createMany({
          data: dto.assetIds.map((assetId, index) => ({
            productId: created.id,
            assetId,
            sortOrder: index,
            isPrimary: index === 0,
          })),
        });
      }

      // Variant creation
      if (dto.variants?.length) {
        for (const v of dto.variants) {
          const variant = await tx.productVariant.create({
            data: {
              productId: created.id,
              sku: v.sku,
              price: v.price,
              compareAtPrice: v.compareAtPrice ?? null,
              costPrice: v.costPrice ?? null,
              weight: v.weight ?? null,
              length: v.length ?? null,
              width: v.width ?? null,
              height: v.height ?? null,
              barcode: v.barcode ?? null,
              isDefault: v.isDefault ?? false,
              isActive: v.isActive ?? true,
              maxDownloads: v.maxDownloads ?? null,
              downloadExpiryDays: v.downloadExpiryDays ?? null,
              licenseKey: v.licenseKey ?? null,
            },
          });

          if (v.attributeValueIds?.length) {
            await tx.variantAttributeValue.createMany({
              data: v.attributeValueIds.map((attributeValueId) => ({
                variantId: variant.id,
                attributeValueId,
              })),
            });
          }
        }
      }

      return created;
    });

    this.events.emit(PRODUCT_MUTATED_EVENT, {
      productId: product.id,
      slug: product.slug,
      // A product is publicly indexable only when ACTIVE + not soft-deleted (mirrors
      // the storefront read filter at products.service.ts:184/:311 and the sitemap
      // inclusion filter). New products default to DRAFT, so this is normally false;
      // a create-as-ACTIVE pings IndexNow immediately.
      shouldSubmitIndexNow: product.status === ProductStatus.ACTIVE,
    } satisfies ProductMutatedEventPayload);
    return this.adminGetProduct(product.id);
  }

  async updateProduct(id: string, dto: UpdateProductAdminDto): Promise<unknown> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new ProductNotFoundException();

    const slugChanged = dto.slug !== undefined && dto.slug !== existing.slug;
    if (slugChanged && dto.slug !== undefined) {
      const conflict = await this.prisma.product.findFirst({
        where: { slug: dto.slug, id: { not: id } },
      });
      if (conflict) throw new ProductSlugTakenException(dto.slug);
    }

    await this.assertCategoriesExist(dto.categoryIds ?? []);

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name as object }),
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.description !== undefined && {
            description: sanitizeTranslatableHtml(
              dto.description as unknown as Record<string, string>,
            ) as object,
          }),
          ...(dto.shortDescription !== undefined && {
            shortDescription: sanitizeTranslatableHtml(
              dto.shortDescription as unknown as Record<string, string>,
            ) as object,
          }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.productTypeId !== undefined && { productTypeId: dto.productTypeId }),
          ...(dto.brand !== undefined && { brand: dto.brand }),
          ...(dto.tags !== undefined && { tags: dto.tags }),
          ...(dto.isFeatured !== undefined && { isFeatured: dto.isFeatured }),
          ...(dto.isDigital !== undefined && { isDigital: dto.isDigital }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle as object }),
          ...(dto.metaDescription !== undefined && {
            metaDescription: dto.metaDescription as object,
          }),
        },
      });

      // Replace category assignments when provided
      if (dto.categoryIds !== undefined) {
        await tx.productCategory.deleteMany({ where: { productId: id } });
        if (dto.categoryIds.length > 0) {
          await tx.productCategory.createMany({
            data: dto.categoryIds.map((categoryId) => ({ productId: id, categoryId })),
          });
        }
      }
    });

    await this.invalidateProductCache(id);

    if (slugChanged) {
      this.events.emit(PRODUCT_SLUG_CHANGED_EVENT, {
        productId: id,
        oldSlug: existing.slug,
        newSlug: dto.slug,
      });
    }

    // Submit to IndexNow when this update touched the product's public visibility
    // (publish DRAFT→ACTIVE, unpublish ACTIVE→DRAFT) or edited a live (ACTIVE) product
    // — but NOT when the slug changed, because PRODUCT_SLUG_CHANGED_EVENT already submits
    // the old + new URL. `existing.deletedAt` is null here (updateProduct reads through
    // the soft-delete middleware), so visibility hinges on status alone.
    const nextStatus = dto.status ?? existing.status;
    const touchedPublicVisibility =
      existing.status === ProductStatus.ACTIVE || nextStatus === ProductStatus.ACTIVE;
    this.events.emit(PRODUCT_MUTATED_EVENT, {
      productId: id,
      slug: dto.slug ?? existing.slug,
      shouldSubmitIndexNow: touchedPublicVisibility && !slugChanged,
    } satisfies ProductMutatedEventPayload);
    return this.adminGetProduct(id);
  }

  /** Soft-delete: set status=ARCHIVED + deletedAt */
  async deleteProduct(id: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new ProductNotFoundException();

    if (existing.status === ProductStatus.ARCHIVED) {
      throw new ConflictException({
        error: { code: 'PRODUCT_ALREADY_ARCHIVED', message: 'Product is already archived' },
      });
    }

    await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ARCHIVED, deletedAt: new Date() },
    });

    await this.invalidateProductCache(id);
    // The product is now soft-deleted, so invalidateProductCache's own slug
    // lookup is filtered out by the soft-delete middleware — clear the detail
    // cache by the slug we already hold so the storefront stops serving it.
    await this.redis.del(`${PRODUCT_DETAIL_CACHE_PREFIX}${existing.slug}`);

    // Archive emits PRODUCT_MUTATED so the sitemap regenerates (drops the URL) and —
    // when the product was live — IndexNow is told the URL changed (Bing/Yandex
    // re-crawl, hit the 404, and drop it). Prior to [DR-15] archive emitted nothing,
    // so a removed product lingered in the sitemap until the next 6 h cron tick.
    this.events.emit(PRODUCT_MUTATED_EVENT, {
      productId: id,
      slug: existing.slug,
      shouldSubmitIndexNow: existing.status === ProductStatus.ACTIVE,
    } satisfies ProductMutatedEventPayload);
  }

  /** Restore: clear deletedAt + set status=DRAFT */
  async restoreProduct(id: string): Promise<unknown> {
    // Must bypass soft-delete middleware — use findFirst with explicit deletedAt filter
    const existing = await this.prisma.product.findFirst({
      where: { id, deletedAt: { not: null } },
    });
    if (!existing)
      throw new NotFoundException({
        error: { code: 'PRODUCT_ARCHIVED_NOT_FOUND', message: 'Archived product not found' },
      });

    await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.DRAFT, deletedAt: null },
    });

    await this.invalidateProductCache(id);
    this.events.emit(PRODUCT_MUTATED_EVENT, {
      productId: id,
      slug: existing.slug,
      // Restore returns the product to DRAFT — not publicly indexable — so no IndexNow
      // submission. A later publish (DRAFT→ACTIVE) submits it via updateProduct.
      shouldSubmitIndexNow: false,
    } satisfies ProductMutatedEventPayload);
    return this.adminGetProduct(id);
  }

  // ── Admin: Variants ─────────────────────────────────────────────────────────

  async createVariant(productId: string, dto: CreateProductVariantAdminDto): Promise<unknown> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new ProductNotFoundException();

    const skuExists = await this.prisma.productVariant.findFirst({
      where: { sku: dto.sku, deletedAt: null },
    });
    if (skuExists) throw new ProductSkuTakenException(dto.sku);

    const variant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          price: dto.price,
          compareAtPrice: dto.compareAtPrice ?? null,
          costPrice: dto.costPrice ?? null,
          weight: dto.weight ?? null,
          length: dto.length ?? null,
          width: dto.width ?? null,
          height: dto.height ?? null,
          barcode: dto.barcode ?? null,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          maxDownloads: dto.maxDownloads ?? null,
          downloadExpiryDays: dto.downloadExpiryDays ?? null,
          licenseKey: dto.licenseKey ?? null,
        },
      });

      if (dto.attributeValueIds?.length) {
        await tx.variantAttributeValue.createMany({
          data: dto.attributeValueIds.map((attributeValueId) => ({
            variantId: created.id,
            attributeValueId,
          })),
        });
      }

      return created;
    });

    await this.invalidateProductCache(productId);
    return variant;
  }

  async updateVariant(
    productId: string,
    variantId: string,
    dto: UpdateProductVariantAdminDto,
  ): Promise<unknown> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
    });
    if (!variant) throw new ProductVariantNotFoundException();

    if (dto.sku && dto.sku !== variant.sku) {
      const skuExists = await this.prisma.productVariant.findFirst({
        where: { sku: dto.sku, deletedAt: null, id: { not: variantId } },
      });
      if (skuExists) throw new ProductSkuTakenException(dto.sku);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const v = await tx.productVariant.update({
        where: { id: variantId },
        data: {
          ...(dto.sku !== undefined && { sku: dto.sku }),
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.compareAtPrice !== undefined && { compareAtPrice: dto.compareAtPrice }),
          ...(dto.costPrice !== undefined && { costPrice: dto.costPrice }),
          ...(dto.weight !== undefined && { weight: dto.weight }),
          ...(dto.length !== undefined && { length: dto.length }),
          ...(dto.width !== undefined && { width: dto.width }),
          ...(dto.height !== undefined && { height: dto.height }),
          ...(dto.barcode !== undefined && { barcode: dto.barcode }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.maxDownloads !== undefined && { maxDownloads: dto.maxDownloads }),
          ...(dto.downloadExpiryDays !== undefined && {
            downloadExpiryDays: dto.downloadExpiryDays,
          }),
          ...(dto.licenseKey !== undefined && { licenseKey: dto.licenseKey }),
        },
      });

      if (dto.attributeValueIds !== undefined) {
        await tx.variantAttributeValue.deleteMany({ where: { variantId } });
        if (dto.attributeValueIds.length > 0) {
          await tx.variantAttributeValue.createMany({
            data: dto.attributeValueIds.map((attributeValueId) => ({
              variantId,
              attributeValueId,
            })),
          });
        }
      }

      return v;
    });

    await this.invalidateProductCache(productId);
    return updated;
  }

  async deleteVariant(productId: string, variantId: string): Promise<void> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
    });
    if (!variant) throw new ProductVariantNotFoundException();

    // Block deleting the only active variant
    const activeCount = await this.prisma.productVariant.count({
      where: { productId, isActive: true, deletedAt: null },
    });
    if (activeCount <= 1) {
      throw new ConflictException({
        error: {
          code: 'PRODUCT_VARIANT_LAST_ACTIVE',
          message: 'Cannot delete the last active variant',
        },
      });
    }

    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.invalidateProductCache(productId);
  }

  // ── Admin: Assets ───────────────────────────────────────────────────────────

  async updateAssets(productId: string, dto: UpdateProductAssetsAdminDto): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new ProductNotFoundException();

    const primaryCount = dto.assets.filter((a) => a.isPrimary).length;
    if (primaryCount > 1) {
      throw new BadRequestException({
        error: {
          code: 'PRODUCT_ASSET_PRIMARY_CONFLICT',
          message: 'Only one asset can be marked as primary',
        },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // Remove all existing asset assignments
      await tx.productAsset.deleteMany({ where: { productId } });

      if (dto.assets.length > 0) {
        await tx.productAsset.createMany({
          data: dto.assets.map((a) => ({
            productId,
            assetId: a.assetId,
            sortOrder: a.sortOrder,
            isPrimary: a.isPrimary,
          })),
        });
      }
    });

    await this.invalidateProductCache(productId);
  }

  // ── Admin: FAQs ─────────────────────────────────────────────────────────────

  async createFaq(productId: string, dto: CreateProductFaqAdminDto): Promise<unknown> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new ProductNotFoundException();

    const faq = await this.prisma.productFaq.create({
      data: {
        productId,
        question: dto.question as object,
        answer: dto.answer as object,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.invalidateProductCache(productId);
    return faq;
  }

  async updateFaq(
    productId: string,
    faqId: string,
    dto: UpdateProductFaqAdminDto,
  ): Promise<unknown> {
    const faq = await this.prisma.productFaq.findFirst({ where: { id: faqId, productId } });
    if (!faq) throw new ProductFaqNotFoundException();

    const updated = await this.prisma.productFaq.update({
      where: { id: faqId },
      data: {
        ...(dto.question !== undefined && { question: dto.question as object }),
        ...(dto.answer !== undefined && { answer: dto.answer as object }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });

    await this.invalidateProductCache(productId);
    return updated;
  }

  async deleteFaq(productId: string, faqId: string): Promise<void> {
    const faq = await this.prisma.productFaq.findFirst({ where: { id: faqId, productId } });
    if (!faq) throw new ProductFaqNotFoundException();

    await this.prisma.productFaq.delete({ where: { id: faqId } });
    await this.invalidateProductCache(productId);
  }

  /**
   * Stock for every variant of one product, in one request.
   *
   * Nothing could do this before: the stock list filters on variantId or
   * locationId only, so a screen wanting a whole product had to issue one
   * request per variant, and a variant with no StockLevel row would still be
   * missing from the answer.
   *
   * Products enumerates its OWN variants and asks the inventory module for the
   * stock, so neither module reads the other's tables (§3.1). Every non-deleted
   * variant appears, including ones with no rows: that absence is exactly the
   * case an operator needs to see in order to fix it.
   */
  async adminGetProductStock(productId: string): Promise<unknown> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new ProductNotFoundException();

    const variants = await this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
      select: { id: true, sku: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { sku: 'asc' }],
    });

    const [stock, locations, threshold] = await Promise.all([
      this.inventory.stockForVariants(variants.map((v) => v.id)),
      this.inventory.listActiveLocations(),
      this.inventory.stockThreshold(),
    ]);

    // Unwrapped on purpose. The global response interceptor supplies the
    // `{ data: ... }` envelope; returning one here too emits
    // `{"data":{"data":…}}`, which the admin client unwraps once and then fails
    // to parse, so a successful request reads as "Could not load".
    return {
      lowStockThreshold: threshold,
      // Locations ride along so the screen does not need a second request just
      // to know where it may write.
      locations,
      variants: variants.map((v) => {
        const entry = stock.get(v.id);
        const totals = entry?.totals ?? { onHand: 0, reserved: 0, available: 0 };
        return {
          variantId: v.id,
          sku: v.sku,
          isDefault: v.isDefault,
          totals,
          // Graded server-side with the same threshold the inventory list
          // uses, so the two screens cannot disagree about the same variant.
          status: stockStatusFor(totals.onHand, threshold),
          levels: entry?.levels ?? [],
        };
      }),
    };
  }

  // ── Admin: Specifications ───────────────────────────────────────────────────

  /**
   * Replace a product's whole specification set, in the order given.
   *
   * `key` and `valueKey` are folded here and never accepted from a client: the
   * key is what `@@unique([productId, key])` and the facet grouping run on, so
   * a supplied value would be a silent-overwrite vector on the product and a
   * way to poison the cross-product label autocomplete.
   *
   * Diff by key rather than delete-all-then-recreate: recreating would reset
   * `createdAt` on rows the operator never touched, which misreports every save
   * as fresh authoring to anything reading that column.
   */
  async replaceSpecs(productId: string, dto: ReplaceProductSpecsAdminDto): Promise<unknown> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new ProductNotFoundException();

    const rows = dto.specs.map((item, index) => ({
      key: specKey(item.label.default),
      valueKey: specKey(item.value.default),
      label: item.label as object,
      value: item.value as object,
      sortOrder: index,
    }));

    // Two spellings that fold to one key are one specification as far as the
    // unique constraint is concerned. Reject before the write, naming both, so
    // the operator fixes the row rather than reading a Prisma P2002 as a 500.
    const seen = new Map<string, string>();
    for (const [i, row] of rows.entries()) {
      const previous = seen.get(row.key);
      if (previous !== undefined) {
        throw new ProductSpecDuplicateKeyException(row.key, [previous, dto.specs[i].label.default]);
      }
      seen.set(row.key, dto.specs[i].label.default);
    }

    // A label that folds to nothing (punctuation only) would collide with every
    // other such label on the same product and could never be filtered.
    const empty = rows.find((r) => r.key.length === 0);
    if (empty) throw new ProductSpecEmptyKeyException();

    await this.prisma.$transaction(async (tx) => {
      await tx.productSpec.deleteMany({
        where: { productId, key: { notIn: rows.map((r) => r.key) } },
      });
      for (const row of rows) {
        await tx.productSpec.upsert({
          where: { productId_key: { productId, key: row.key } },
          create: { productId, ...row },
          update: {
            value: row.value,
            valueKey: row.valueKey,
            label: row.label,
            sortOrder: row.sortOrder,
          },
        });
      }
    });

    await this.invalidateProductCache(productId);

    return this.prisma.productSpec.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Distinct specification labels across the catalogue, most-used first.
   *
   * Deliberately NOT `listSpecFacets`: that one is the storefront's filter rail,
   * so it sees only ACTIVE products and then applies viability bars. An operator
   * writing the first or second product to use a label would not find it in an
   * autocomplete built on that. This is the inverse: every label ever written,
   * DRAFT included.
   *
   * It does exclude soft-deleted products. `ProductSpec.onDelete` is Cascade,
   * which only fires on a hard delete, so an archived product's labels would
   * otherwise haunt the list forever.
   *
   * The term is folded with the same `specKey` the stored keys were folded with,
   * which is what makes the match accent-insensitive without a second
   * normalisation. `startsWith` and not `contains`: a leading-wildcard LIKE
   * cannot use the btree behind `@@index([key])`, so every keystroke would scan
   * the table.
   */
  async listSpecLabels(query: ListSpecLabelsAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const folded = query.search ? specKey(query.search) : '';

    const where = {
      product: { deletedAt: null },
      ...(folded ? { key: { startsWith: folded } } : {}),
    };

    const grouped = await this.prisma.productSpec.groupBy({
      by: ['key'],
      where,
      _count: { _all: true },
      orderBy: [{ _count: { key: 'desc' } }, { key: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const distinct = await this.prisma.productSpec.groupBy({ by: ['key'], where });

    // `groupBy` cannot return the label JSON, so resolve one spelling per key.
    // Most recently written wins, which is the right tie-break when two
    // products spell the same folded key differently.
    const keys = grouped.map((g) => g.key);
    const labels = keys.length
      ? await this.prisma.productSpec.findMany({
          where: { ...where, key: { in: keys } },
          distinct: ['key'],
          orderBy: { updatedAt: 'desc' },
          select: { key: true, label: true },
          take: keys.length,
        })
      : [];
    const labelByKey = new Map(labels.map((l) => [l.key, l.label]));

    return {
      data: grouped.map((g) => ({
        key: g.key,
        label: labelByKey.get(g.key) ?? null,
        // One row per product per key is guaranteed by @@unique([productId, key]),
        // so the row count IS the product count.
        productCount: g._count._all,
      })),
      meta: { page, pageSize, total: distinct.length },
    };
  }

  // ── Admin: Bulk ─────────────────────────────────────────────────────────────

  async bulkUpdatePrices(dto: BulkUpdatePricesAdminDto): Promise<void> {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.productVariant.update({
          where: { id: item.variantId },
          data: { price: item.price },
        }),
      ),
    );
  }

  async bulkUpdateStatus(dto: BulkUpdateStatusAdminDto): Promise<void> {
    await this.prisma.product.updateMany({
      where: { id: { in: dto.productIds } },
      data: { status: dto.status },
    });

    // Invalidate each product's quality cache
    await Promise.all(dto.productIds.map((id) => this.invalidateProductCache(id)));
  }

  // ── Admin: Product Types ────────────────────────────────────────────────────

  async listProductTypes(page = 1, pageSize = this.pageSize): Promise<PaginatedResult<unknown>> {
    const skip = (page - 1) * pageSize;

    const [total, items] = await Promise.all([
      this.prisma.productType.count(),
      this.prisma.productType.findMany({
        include: {
          attributes: { include: { attributeValues: true }, orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    return {
      data: items,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async createProductType(dto: CreateProductTypeAdminDto): Promise<unknown> {
    const existing = await this.prisma.productType.findUnique({ where: { code: dto.code } });
    if (existing) throw new ProductTypeCodeTakenException(dto.code);

    return this.prisma.productType.create({
      data: {
        name: dto.name as object,
        code: dto.code,
        taxClassId: dto.taxClassId ?? null,
      },
    });
  }

  async updateProductType(id: string, dto: UpdateProductTypeAdminDto): Promise<unknown> {
    const existing = await this.prisma.productType.findUnique({ where: { id } });
    if (!existing) throw new ProductTypeNotFoundException();

    if (dto.code && dto.code !== existing.code) {
      const conflict = await this.prisma.productType.findFirst({
        where: { code: dto.code, id: { not: id } },
      });
      if (conflict) throw new ProductTypeCodeTakenException(dto.code);
    }

    return this.prisma.productType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name as object }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.taxClassId !== undefined && { taxClassId: dto.taxClassId }),
      },
      include: { attributes: { include: { attributeValues: true } } },
    });
  }

  async deleteProductType(id: string): Promise<void> {
    const existing = await this.prisma.productType.findUnique({ where: { id } });
    if (!existing) throw new ProductTypeNotFoundException();

    const productCount = await this.prisma.product.count({ where: { productTypeId: id } });
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete product type: ${productCount} product(s) are using it`,
      );
    }

    await this.prisma.productType.delete({ where: { id } });
  }

  // ── Admin: Attributes ───────────────────────────────────────────────────────

  async listAttributes(
    page = 1,
    pageSize = this.pageSize,
    productTypeId?: string,
  ): Promise<PaginatedResult<unknown>> {
    const skip = (page - 1) * pageSize;
    const where = productTypeId ? { productTypeId } : {};

    const [total, items] = await Promise.all([
      this.prisma.attribute.count({ where }),
      this.prisma.attribute.findMany({
        where,
        include: { attributeValues: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ productTypeId: 'asc' }, { sortOrder: 'asc' }],
        skip,
        take: pageSize,
      }),
    ]);

    return {
      data: items,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async createAttribute(dto: CreateAttributeAdminDto): Promise<unknown> {
    const productType = await this.prisma.productType.findUnique({
      where: { id: dto.productTypeId },
    });
    if (!productType) throw new ProductTypeNotFoundException();

    const existing = await this.prisma.attribute.findUnique({
      where: { productTypeId_code: { productTypeId: dto.productTypeId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(
        `Attribute code "${dto.code}" already exists in this product type`,
      );
    }

    return this.prisma.attribute.create({
      data: {
        productTypeId: dto.productTypeId,
        name: dto.name as object,
        code: dto.code,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { attributeValues: true },
    });
  }

  async updateAttribute(id: string, dto: UpdateAttributeAdminDto): Promise<unknown> {
    const existing = await this.prisma.attribute.findUnique({ where: { id } });
    if (!existing) throw new ProductAttributeNotFoundException();

    if (dto.code && dto.code !== existing.code) {
      const conflict = await this.prisma.attribute.findUnique({
        where: {
          productTypeId_code: { productTypeId: existing.productTypeId, code: dto.code },
        },
      });
      if (conflict) {
        throw new ConflictException(
          `Attribute code "${dto.code}" already exists in this product type`,
        );
      }
    }

    return this.prisma.attribute.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name as object }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
      include: { attributeValues: true },
    });
  }

  async deleteAttribute(id: string): Promise<void> {
    const existing = await this.prisma.attribute.findUnique({ where: { id } });
    if (!existing) throw new ProductAttributeNotFoundException();

    // Cascade deletes attribute values, but check for variant usages first
    const usageCount = await this.prisma.variantAttributeValue.count({
      where: { attributeValue: { attributeId: id } },
    });
    if (usageCount > 0) {
      throw new ConflictException(
        `Cannot delete attribute: ${usageCount} variant(s) are using its values`,
      );
    }

    await this.prisma.attribute.delete({ where: { id } });
  }

  // ── Admin: Attribute Values ─────────────────────────────────────────────────

  async createAttributeValue(
    attributeId: string,
    dto: CreateAttributeValueAdminDto,
  ): Promise<unknown> {
    const attribute = await this.prisma.attribute.findUnique({ where: { id: attributeId } });
    if (!attribute) throw new ProductAttributeNotFoundException();

    const existing = await this.prisma.attributeValue.findUnique({
      where: { attributeId_code: { attributeId, code: dto.code } },
    });
    if (existing) {
      throw new ProductAttributeValueCodeTakenException(dto.code);
    }

    return this.prisma.attributeValue.create({
      data: {
        attributeId,
        value: dto.value as object,
        code: dto.code,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateAttributeValue(
    attributeId: string,
    valueId: string,
    dto: UpdateAttributeValueAdminDto,
  ): Promise<unknown> {
    const existing = await this.prisma.attributeValue.findFirst({
      where: { id: valueId, attributeId },
    });
    if (!existing) throw new ProductAttributeValueNotFoundException();

    if (dto.code && dto.code !== existing.code) {
      const conflict = await this.prisma.attributeValue.findUnique({
        where: { attributeId_code: { attributeId, code: dto.code } },
      });
      if (conflict) {
        throw new ProductAttributeValueCodeTakenException(dto.code);
      }
    }

    return this.prisma.attributeValue.update({
      where: { id: valueId },
      data: {
        ...(dto.value !== undefined && { value: dto.value as object }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deleteAttributeValue(attributeId: string, valueId: string): Promise<void> {
    const existing = await this.prisma.attributeValue.findFirst({
      where: { id: valueId, attributeId },
    });
    if (!existing) throw new ProductAttributeValueNotFoundException();

    const usageCount = await this.prisma.variantAttributeValue.count({
      where: { attributeValueId: valueId },
    });
    if (usageCount > 0) {
      throw new ConflictException(
        `Cannot delete attribute value: ${usageCount} variant(s) are using it`,
      );
    }

    await this.prisma.attributeValue.delete({ where: { id: valueId } });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Generates a unique slug from a base name.
   * Appends -1, -2, … if the base slug is already taken.
   */
  async generateUniqueSlug(baseName: string): Promise<string> {
    const base = toSlug(baseName);
    const existing = await this.prisma.product.findUnique({ where: { slug: base } });
    if (!existing) return base;

    // Find all products with slugs matching "base" or "base-N"
    const conflicts = await this.prisma.product.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });

    const taken = new Set(conflicts.map((p) => p.slug));
    let counter = 1;
    while (taken.has(`${base}-${counter}`)) counter++;
    return `${base}-${counter}`;
  }

  /**
   * Cross-module read helper for the SEO submit orchestrator (DR-17 D2). Resolves
   * a list of product ids to the `{ id, slug }` of the ones that are publicly
   * visible — `status: ACTIVE` (soft-deleted rows are auto-filtered by the Prisma
   * middleware). Ids that are unknown, draft, archived, or soft-deleted are simply
   * dropped from the result, NOT errored: a manual reindex must never spend
   * crawler quota on a slug that would resolve to a 404 on the storefront.
   */
  async resolveActivePublicSlugs(ids: string[]): Promise<{ id: string; slug: string }[]> {
    if (ids.length === 0) return [];
    return this.prisma.product.findMany({
      where: { id: { in: ids }, status: ProductStatus.ACTIVE },
      select: { id: true, slug: true },
    });
  }

  /**
   * Cross-module read helper for the SEO URL-Inspection sweep (DR-17 D5). Returns
   * the `limit` most-recently-updated publicly-visible (`status: ACTIVE`) products,
   * freshest first — soft-deleted rows are auto-filtered by the Prisma middleware.
   * The sweep inspects new/changed SKUs first and stays under the 2 000/day GSC
   * budget, so the result is bounded by `take` and ordered by the fixed `updatedAt`
   * column (never a request-supplied sort field — §3.5).
   */
  async listRecentlyUpdatedActiveSlugs(
    limit: number,
  ): Promise<{ id: string; slug: string; updatedAt: Date }[]> {
    if (limit <= 0) return [];
    return this.prisma.product.findMany({
      where: { status: ProductStatus.ACTIVE },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, slug: true, updatedAt: true },
    });
  }

  private async getCachedQualityScore(product: ProductWithRelations): Promise<QualityScore> {
    const cacheKey = `${PRODUCT_QUALITY_CACHE_PREFIX}${product.id}`;
    const cached = await this.tryGetCache(cacheKey);
    if (cached) return cached as QualityScore;

    const score = computeQualityScore(product);
    await this.trySetCache(cacheKey, score, PRODUCT_QUALITY_TTL_SECONDS);
    return score;
  }

  /**
   * Reject unknown `categoryIds` before the transaction reaches
   * `productCategory.createMany`, where an unknown id is a Prisma P2003 and
   * therefore a 500 for a client mistake.
   *
   * The Category read lives in CategoriesService so this module never touches
   * a table it does not own (§3.1).
   */
  private async assertCategoriesExist(categoryIds: readonly string[]): Promise<void> {
    if (categoryIds.length === 0) return;
    const found = new Set(await this.categories.findExistingIds(categoryIds));
    const missing = [...new Set(categoryIds)].filter((id) => !found.has(id));
    if (missing.length > 0) throw new ProductCategoryNotFoundException(missing);
  }

  private async invalidateProductCache(productId: string): Promise<void> {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { slug: true },
      });
      const keys = [
        `${PRODUCT_QUALITY_CACHE_PREFIX}${productId}`,
        // The spec-facet rail is derived from live ProductSpec rows and was
        // never invalidated by anything. It is catalogue-global rather than
        // per-product, and `listSpecFacets` filters on `status: ACTIVE`, so a
        // product merely flipping ACTIVE to DRAFT already changed facet
        // membership while the rail kept serving the old set for the whole TTL.
        // Dropping it here covers that and every spec write.
        PRODUCT_SPEC_FACETS_CACHE_KEY,
        ...(product ? [`${PRODUCT_DETAIL_CACHE_PREFIX}${product.slug}`] : []),
      ];
      await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(
        `Cache invalidation failed for product ${productId}: ${(err as Error).message}`,
      );
    }
  }

  private async tryGetCache(key: string): Promise<unknown | null> {
    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as unknown) : null;
    } catch (err) {
      this.logger.warn(`Cache GET failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  private async trySetCache(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      this.logger.warn(`Cache SET failed for key "${key}": ${(err as Error).message}`);
    }
  }

  // ── Asset references (S18 — DR-07) ──────────────────────────────────────────
  /**
   * Returns products that reference the given asset via the `ProductAsset`
   * join table. Soft-delete filter applies via the global Prisma middleware
   * (Product is soft-deleted). Used by `AssetsService.getReferences()` to
   * support the DR-07 hard-delete guard. Modular-isolation gate per
   * constitution §3.1.
   */
  async findByAssetId(
    assetId: string,
  ): Promise<Array<{ id: string; name: unknown; slug: string }>> {
    return this.prisma.product.findMany({
      where: { assets: { some: { assetId } } },
      select: { id: true, name: true, slug: true },
    });
  }

  /**
   * Returns variants that reference the given asset as a downloadable file
   * (`VariantDownloadFile`). Soft-delete filter applies — soft-deleted
   * variants are excluded. The `productId` and `productSlug` route the
   * operator to the parent product's edit page.
   */
  async findVariantsByDownloadAssetId(
    assetId: string,
  ): Promise<Array<{ id: string; productId: string; productSlug: string; sku: string }>> {
    const rows = await this.prisma.productVariant.findMany({
      where: { downloadableFiles: { some: { assetId } } },
      select: {
        id: true,
        sku: true,
        productId: true,
        product: { select: { slug: true } },
      },
    });
    return rows.map((v) => ({
      id: v.id,
      productId: v.productId,
      productSlug: v.product?.slug ?? '',
      sku: v.sku,
    }));
  }
}
