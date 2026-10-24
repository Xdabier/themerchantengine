import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import type { StorefrontSection } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import { AssetsService } from '../assets/assets.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { SettingsService } from '../settings/settings.service';
import { SETTINGS_GROUPS } from '../settings/settings.constants';
import {
  STOREFRONT_CONFIG_REDIS_CLIENT,
  STOREFRONT_LOW_STOCK_FALLBACK,
  STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
  STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS,
  STOREFRONT_SECTIONS_CACHE_PREFIX,
  STOREFRONT_SECTIONS_TTL_SECONDS,
} from './storefront-config.constants';
import { STOREFRONT_SECTION_UPDATED_EVENT } from './storefront-config.events';
import type { CreateSectionAdminDto } from './dto/create-section.dto';
import type { UpdateSectionAdminDto } from './dto/update-section.dto';
import type { ReorderSectionsAdminDto } from './dto/reorder-sections.dto';
import type { ToggleVisibilityAdminDto } from './dto/toggle-visibility.dto';
import {
  ALLOWED_SECTION_TYPES,
  getAssetIdReferencePaths,
  isAllowedSectionType,
  SECTION_ASSET_INTENT,
  validateSectionConfig,
  type AllowedSectionType,
} from './dto/configs';
import type { PublicVariantUrl } from '../assets/assets.service';

export interface SectionAssetReference {
  id: string;
  pageSlug: string;
  type: AllowedSectionType;
  sortOrder: number;
}

/**
 * Everything the storefront is allowed to read without a session.
 *
 * An explicit allowlist, never a settings dump. `SETTINGS_KEYS` grows whenever
 * an operator gets a new knob, and a payload shaped as "the groups the
 * storefront happens to need" would put each new key on an unauthenticated
 * endpoint by default. Widening this interface is the deliberate act that
 * publishes a setting, and `storefront-config.service.spec.ts` fails on any
 * key that appears without one.
 */
export interface StorefrontPublicConfig {
  identity: {
    /** Translatable on the wire; the global interceptor resolves it per request. */
    storeName: unknown;
    contactEmail: string | null;
    phone: string | null;
    /** Only the platforms the operator actually filled in. */
    socialLinks: Record<string, string>;
    logoUrl: string | null;
  };
  currency: { code: string; symbol: string; decimalPlaces: number };
  locales: { supportedLocales: string[]; defaultLocale: string };
  inventory: { lowStockThreshold: number };
  pixels: {
    googleAnalyticsId: string | null;
    metaPixelId: string | null;
    tiktokPixelId: string | null;
    snapPixelId: string | null;
  };
}

const PIXEL_SLOTS = ['googleAnalyticsId', 'metaPixelId', 'tiktokPixelId', 'snapPixelId'] as const;

export interface ResolvedSectionsResult {
  data: StorefrontSection[];
  meta: { pageSlug: string; total: number; page: 1; pageSize: number; totalPages: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class StorefrontConfigService {
  private readonly logger = new Logger(StorefrontConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STOREFRONT_CONFIG_REDIS_CLIENT) private readonly redis: Redis,
    @Inject(forwardRef(() => AssetsService)) private readonly assets: AssetsService,
    private readonly events: EventEmitter2,
    private readonly settings: SettingsService,
    private readonly currencies: CurrenciesService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * The public storefront configuration, behind `GET /v1/storefront/config`.
   *
   * Composed from four owning modules through their exported services, never
   * by reading `StoreSetting` here (§3.1). Cached briefly, see
   * `STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS` for why the window is a minute and
   * not the sections window.
   */
  async getPublicConfig(): Promise<StorefrontPublicConfig> {
    const cached = (await this.tryGetCache(
      STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
    )) as StorefrontPublicConfig | null;
    if (cached) return cached;

    const [general, appearance, currency, locales, threshold, pixels] = await Promise.all([
      this.settings.getGroup(SETTINGS_GROUPS.GENERAL),
      this.settings.getGroup(SETTINGS_GROUPS.APPEARANCE),
      this.currencies.getStore(),
      this.settings.getLocales(),
      this.settings.get<unknown>('defaultLowStockThreshold'),
      this.analytics.getPixels(),
    ]);

    const config: StorefrontPublicConfig = {
      identity: {
        storeName: general['storeName'] ?? null,
        contactEmail: nonEmptyString(general['contactEmail']),
        phone: nonEmptyString(general['phone']),
        socialLinks: configuredLinks(general['socialLinks']),
        // `faviconUrl` sits in the same group and deliberately stays behind:
        // nothing on the storefront reads it, and an unread field on a public
        // endpoint is surface for no benefit.
        logoUrl: nonEmptyString(appearance['logoUrl']),
      },
      // `enabled` is the admin currency roster and stays admin-only.
      currency: {
        code: currency.code,
        symbol: currency.symbol,
        decimalPlaces: currency.decimalPlaces,
      },
      locales,
      inventory: { lowStockThreshold: readThreshold(threshold) },
      pixels: {
        googleAnalyticsId: null,
        metaPixelId: null,
        tiktokPixelId: null,
        snapPixelId: null,
      },
    };

    const stored = pixels as Record<string, unknown>;
    for (const slot of PIXEL_SLOTS) {
      config.pixels[slot] = nonEmptyString(stored?.[slot]);
    }

    await this.trySetCache(
      STOREFRONT_PUBLIC_CONFIG_CACHE_KEY,
      config,
      STOREFRONT_PUBLIC_CONFIG_TTL_SECONDS,
    );
    return config;
  }

  // ── Storefront ──────────────────────────────────────────────────────────────

  /**
   * @deprecated S21 cutover (DR-04). Replaced by `getSections('home')` which
   * reads from `StorefrontSection` (operator-managed via admin). The S21
   * cleanup script (`scripts/s21-assert-no-dropped-section-types.ts --apply`)
   * deletes the four `StoreSetting` keys this method reads, so the method
   * now returns `{ hero: { imageUrl: null, altText: null }, midBanner: { imageUrl: null, altText: null } }`
   * after the deploy runs. The endpoint itself stays alive for one release
   * window so any out-of-tree client can migrate; removed in a follow-up
   * commit one release after S21 ships.
   *
   * Read homepage hero + mid-banner config from StoreSetting (group=storefront).
   * Returns null fields when not seeded — storefront falls back to a brand
   * decorative panel in that case.
   */
  async getHomeBanners(): Promise<{
    hero: { imageUrl: string | null; altText: { en?: string; ar?: string } | null };
    midBanner: { imageUrl: string | null; altText: { en?: string; ar?: string } | null };
  }> {
    const rows = await this.prisma.storeSetting.findMany({
      where: {
        group: 'storefront',
        key: {
          in: [
            'home.hero.imageUrl',
            'home.hero.altText',
            'home.midBanner.imageUrl',
            'home.midBanner.altText',
          ],
        },
      },
    });
    const map = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
    return {
      hero: {
        imageUrl: (map.get('home.hero.imageUrl') as string | undefined) ?? null,
        altText: (map.get('home.hero.altText') as { en?: string; ar?: string } | undefined) ?? null,
      },
      midBanner: {
        imageUrl: (map.get('home.midBanner.imageUrl') as string | undefined) ?? null,
        altText:
          (map.get('home.midBanner.altText') as { en?: string; ar?: string } | undefined) ?? null,
      },
    };
  }

  /**
   * Returns visible sections for a page slug, ordered by sortOrder.
   *
   * Filters: isVisible=true, visibleFrom <= now, visibleUntil >= now (or null).
   * Each row's `config` JSONB has its `assetId` references hydrated to the
   * sibling key `assetUrl`, so the storefront can render `<img src>` without
   * a second round-trip. `Translatable` JSONB fields are returned untouched
   * — the global `Accept-Language` interceptor resolves them per request.
   *
   * Result cached for 10 minutes (rows only); invalidated on any mutation.
   */
  async getSections(pageSlug: string): Promise<ResolvedSectionsResult> {
    const rows = await this.fetchVisibleSectionRows(pageSlug);
    const hydrated = await this.hydrateAssetUrls(rows);
    return {
      data: hydrated,
      meta: {
        pageSlug,
        total: hydrated.length,
        page: 1,
        pageSize: hydrated.length,
        totalPages: 1,
      },
    };
  }

  private async fetchVisibleSectionRows(pageSlug: string): Promise<StorefrontSection[]> {
    const cacheKey = `${STOREFRONT_SECTIONS_CACHE_PREFIX}${pageSlug}`;
    const cached = await this.tryGetCache(cacheKey);
    if (cached) return cached as StorefrontSection[];

    const now = new Date();

    const sections = await this.prisma.storefrontSection.findMany({
      where: {
        pageSlug,
        isVisible: true,
        OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }],
        AND: [{ OR: [{ visibleUntil: null }, { visibleUntil: { gte: now } }] }],
      },
      orderBy: { sortOrder: 'asc' },
    });

    await this.trySetCache(cacheKey, sections);
    return sections;
  }

  /**
   * Walks every `(type, path)` tuple declared by the per-type configs and
   * replaces the `assetId` value in `config` with sibling `assetUrl` +
   * `assetVariants` keys per DR-04 amendment 2026-05-01. Variant URLs come
   * from the canonical-variant resolver — `assetUrl` carries the canonical
   * variant for the section's intent (e.g. `large` for HERO, `medium` for
   * PROMOTIONAL_BANNER), `assetVariants` carries the responsive set so the
   * storefront can render `<picture>` with `srcset` + `sizes`.
   *
   * The lookup is bulk: one `publicProjection` per distinct intent across the
   * page. Sections whose type has no asset paths are returned untouched.
   */
  private async hydrateAssetUrls(rows: StorefrontSection[]): Promise<StorefrontSection[]> {
    if (rows.length === 0) return rows;

    const referencePaths = getAssetIdReferencePaths();
    const idsByIntent = new Map<string, Set<string>>();
    for (const row of rows) {
      const cfg = row.config as Record<string, unknown> | null;
      if (!cfg || !isAllowedSectionType(row.type)) continue;
      const intent = SECTION_ASSET_INTENT[row.type];
      for (const entry of referencePaths) {
        if (entry.type !== row.type) continue;
        const value = readJsonPath(cfg, entry.path);
        if (typeof value !== 'string') continue;
        if (!idsByIntent.has(intent)) idsByIntent.set(intent, new Set());
        idsByIntent.get(intent)!.add(value);
      }
    }
    if (idsByIntent.size === 0) return rows;

    const projectionByIntent = new Map<string, Map<string, PublicVariantUrl>>();
    for (const [intent, ids] of idsByIntent) {
      const projection = await this.assets.publicProjection(
        [...ids],
        intent as Parameters<typeof this.assets.publicProjection>[1],
      );
      projectionByIntent.set(intent, projection);
    }

    return rows.map((row) => {
      if (!isAllowedSectionType(row.type)) return row;
      const cfg = row.config as Record<string, unknown> | null;
      if (!cfg) return row;
      const intent = SECTION_ASSET_INTENT[row.type];
      const projection = projectionByIntent.get(intent);
      if (!projection) return row;
      const next: Record<string, unknown> = { ...cfg };
      let mutated = false;
      for (const entry of referencePaths) {
        if (entry.type !== row.type) continue;
        const value = readJsonPath(next, entry.path);
        if (typeof value !== 'string') continue;
        const variant = projection.get(value);
        if (!variant) continue;
        writeJsonPathSibling(next, entry.path, 'assetUrl', variant.url);
        writeJsonPathSibling(next, entry.path, 'assetVariants', variant.srcset ?? []);
        mutated = true;
      }
      return mutated ? { ...row, config: next as Prisma.JsonValue } : row;
    });
  }

  // ── Admin ───────────────────────────────────────────────────────────────────

  /**
   * Returns all distinct page slugs that have at least one section.
   */
  async getPages(): Promise<string[]> {
    const rows = await this.prisma.storefrontSection.findMany({
      select: { pageSlug: true },
      distinct: ['pageSlug'],
      orderBy: { pageSlug: 'asc' },
    });
    return rows.map((r) => r.pageSlug);
  }

  /**
   * Returns all sections for a page (admin view — no visibility filtering).
   */
  async adminGetSections(
    pageSlug: string,
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResult<StorefrontSection>> {
    const skip = (page - 1) * pageSize;

    const [total, sections] = await Promise.all([
      this.prisma.storefrontSection.count({ where: { pageSlug } }),
      this.prisma.storefrontSection.findMany({
        where: { pageSlug },
        orderBy: { sortOrder: 'asc' },
        skip,
        take: pageSize,
      }),
    ]);

    return {
      data: sections,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /**
   * Creates a new section for a page. The `config` JSONB is validated
   * against the per-type DTO selected by `dto.type` per DR-04/DR-05;
   * unknown fields are rejected, not stripped (constitution §3.5).
   */
  async createSection(dto: CreateSectionAdminDto): Promise<StorefrontSection> {
    if (!isAllowedSectionType(dto.type)) {
      throw new BadRequestException(
        `Section type "${dto.type}" is not supported. Allowed: ${ALLOWED_SECTION_TYPES.join(', ')}`,
      );
    }

    const validatedConfig = await validateSectionConfig(dto.type, dto.config);

    const section = await this.prisma.storefrontSection.create({
      data: {
        // pageSlug is always supplied by the controller from the URL path param.
        // The DTO marks it optional so that the body can omit it (per API ref).
        pageSlug: dto.pageSlug!,
        type: dto.type,
        title: dto.title as object | undefined,
        config: validatedConfig as Prisma.InputJsonValue,
        sortOrder: dto.sortOrder ?? 0,
        isVisible: dto.isVisible ?? true,
        visibleFrom: dto.visibleFrom ? new Date(dto.visibleFrom) : null,
        visibleUntil: dto.visibleUntil ? new Date(dto.visibleUntil) : null,
      },
    });

    await this.invalidatePageCache(section.pageSlug);
    this.emitSectionUpdated(section.pageSlug);
    return section;
  }

  /**
   * Updates a section's config/metadata. pageSlug cannot be changed.
   * When `dto.config` is provided, validates against the per-type DTO
   * selected by `dto.type ?? <existing row type>`.
   */
  async updateSection(id: string, dto: UpdateSectionAdminDto): Promise<StorefrontSection> {
    const section = await this.findOrThrow(id);

    const nextType = dto.type ?? section.type;
    if (!isAllowedSectionType(nextType)) {
      throw new BadRequestException(
        `Section type "${nextType}" is not supported. Allowed: ${ALLOWED_SECTION_TYPES.join(', ')}`,
      );
    }

    let validatedConfig: object | undefined;
    if (dto.config !== undefined) {
      validatedConfig = await validateSectionConfig(nextType, dto.config);
    } else if (dto.type !== undefined && dto.type !== section.type) {
      // Type change without a config payload would leave the JSONB shape
      // mismatched — refuse rather than silently corrupt the row.
      throw new BadRequestException(
        `Changing section type requires a fresh config payload matching the new type.`,
      );
    }

    const updated = await this.prisma.storefrontSection.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.title !== undefined && { title: dto.title as object }),
        ...(validatedConfig !== undefined && {
          config: validatedConfig as Prisma.InputJsonValue,
        }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isVisible !== undefined && { isVisible: dto.isVisible }),
        ...(dto.visibleFrom !== undefined && {
          visibleFrom: dto.visibleFrom ? new Date(dto.visibleFrom) : null,
        }),
        ...(dto.visibleUntil !== undefined && {
          visibleUntil: dto.visibleUntil ? new Date(dto.visibleUntil) : null,
        }),
      },
    });

    await this.invalidatePageCache(section.pageSlug);
    this.emitSectionUpdated(section.pageSlug);
    return updated;
  }

  /**
   * DR-07 — finds every `StorefrontSection` whose `config` JSONB references
   * the given `assetId`. Iterates the per-type schemas' declared `assetId`
   * paths (see `dto/configs/index.ts`) and unions the matches across
   * `(type, path)` tuples. Uses Prisma's typed JSON path predicate; **no
   * `$queryRaw`**. Soft-deleted rows are excluded by Prisma middleware.
   *
   * Returns an empty array when no per-type schema declares an `assetId`
   * path (e.g., if the asset-bearing types are removed in a future DR).
   */
  async findSectionsByAssetId(assetId: string): Promise<SectionAssetReference[]> {
    const referencePaths = getAssetIdReferencePaths();
    if (referencePaths.length === 0) return [];

    const orClauses: Prisma.StorefrontSectionWhereInput[] = referencePaths.map((entry) => ({
      type: entry.type,
      config: {
        path: [...entry.path],
        equals: assetId,
      },
    }));

    const rows = await this.prisma.storefrontSection.findMany({
      where: { OR: orClauses },
      select: { id: true, pageSlug: true, type: true, sortOrder: true },
      orderBy: [{ pageSlug: 'asc' }, { sortOrder: 'asc' }],
    });

    return rows
      .filter((r): r is typeof r & { type: AllowedSectionType } => isAllowedSectionType(r.type))
      .map((r) => ({
        id: r.id,
        pageSlug: r.pageSlug,
        type: r.type,
        sortOrder: r.sortOrder,
      }));
  }

  /**
   * Soft-deletes a section.
   */
  async deleteSection(id: string): Promise<void> {
    const section = await this.findOrThrow(id);

    await this.prisma.storefrontSection.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.invalidatePageCache(section.pageSlug);
    this.emitSectionUpdated(section.pageSlug);
  }

  /**
   * Reorders all sections on a page in a single transaction.
   * `orderedIds` must reference all non-deleted sections on the page.
   */
  async reorderSections(pageSlug: string, dto: ReorderSectionsAdminDto): Promise<void> {
    const existing = await this.prisma.storefrontSection.findMany({
      where: { pageSlug },
      select: { id: true },
    });

    const existingIds = new Set(existing.map((s) => s.id));
    const invalid = dto.orderedIds.filter((id) => !existingIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `orderedIds contains IDs not found on page "${pageSlug}": ${invalid.join(', ')}`,
      );
    }

    await this.prisma.$transaction(
      dto.orderedIds.map((id, index) =>
        this.prisma.storefrontSection.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );

    await this.invalidatePageCache(pageSlug);
    this.emitSectionUpdated(pageSlug);
  }

  /**
   * Toggles visibility (and optional window) for a single section.
   */
  async toggleVisibility(id: string, dto: ToggleVisibilityAdminDto): Promise<StorefrontSection> {
    const section = await this.findOrThrow(id);

    const updated = await this.prisma.storefrontSection.update({
      where: { id },
      data: {
        isVisible: dto.isVisible,
        ...(dto.visibleFrom !== undefined && {
          visibleFrom: dto.visibleFrom ? new Date(dto.visibleFrom) : null,
        }),
        ...(dto.visibleUntil !== undefined && {
          visibleUntil: dto.visibleUntil ? new Date(dto.visibleUntil) : null,
        }),
      },
    });

    await this.invalidatePageCache(section.pageSlug);
    this.emitSectionUpdated(section.pageSlug);
    return updated;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async findOrThrow(id: string): Promise<StorefrontSection> {
    const section = await this.prisma.storefrontSection.findUnique({ where: { id } });
    if (!section) throw new NotFoundException(`StorefrontSection "${id}" not found`);
    return section;
  }

  private async tryGetCache(key: string): Promise<unknown | null> {
    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as unknown) : null;
    } catch (err) {
      this.logger.warn(`Cache GET failed for "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  private async trySetCache(
    key: string,
    value: unknown,
    ttlSeconds: number = STOREFRONT_SECTIONS_TTL_SECONDS,
  ): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Cache SET failed for "${key}": ${(err as Error).message}`);
    }
  }

  private async invalidatePageCache(pageSlug: string): Promise<void> {
    try {
      await this.redis.del(`${STOREFRONT_SECTIONS_CACHE_PREFIX}${pageSlug}`);
    } catch (err) {
      this.logger.warn(`Cache invalidation failed for "${pageSlug}": ${(err as Error).message}`);
    }
  }

  private emitSectionUpdated(pageSlug: string): void {
    this.events.emit(STOREFRONT_SECTION_UPDATED_EVENT, { pageSlug });
  }
}

// ── Module-private JSON path helpers ──────────────────────────────────────────

function readJsonPath(obj: Record<string, unknown>, path: readonly string[]): unknown {
  let cursor: unknown = obj;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function writeJsonPathSibling(
  obj: Record<string, unknown>,
  path: readonly string[],
  siblingKey: string,
  value: unknown,
): void {
  if (path.length === 0) return;
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    const cloned: Record<string, unknown> = { ...(next as Record<string, unknown>) };
    cursor[segment] = cloned;
    cursor = cloned;
  }
  cursor[siblingKey] = value;
}

// ── Public-config readers ────────────────────────────────────────────────────

/** An unset setting is stored as `''`; the storefront wants a null to test. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Only the social platforms the operator filled in, so the footer can render
 * a link per entry without testing each one for emptiness. */
function configuredLinks(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [platform, url] of Object.entries(value as Record<string, unknown>)) {
    const trimmed = nonEmptyString(url);
    if (trimmed) out[platform] = trimmed;
  }
  return out;
}

/** Mirrors `InventoryService.effectiveLowStockThreshold`, which this module may
 * not call: settings must not depend on inventory (§3.1). The two fallbacks are
 * held together by the service spec. */
function readThreshold(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : raw == null ? NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : STOREFRONT_LOW_STOCK_FALLBACK;
}
