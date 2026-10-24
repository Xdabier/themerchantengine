import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import { applyRate } from '@common/money';
import type { CreateTaxZoneAdminDto } from './dto/create-zone.dto';
import type { UpdateTaxZoneAdminDto } from './dto/update-zone.dto';
import type { CreateTaxClassAdminDto } from './dto/create-class.dto';
import type { ListTaxZonesAdminDto, ListTaxClassesAdminDto } from './dto/query-tax.dto';
import {
  TAX_REDIS_CLIENT,
  TAX_ZONE_CACHE_PREFIX,
  TAX_ZONE_DEFAULT_CACHE_KEY,
  TAX_ZONE_TTL_SECONDS,
} from './tax.constants';

// ── Public interface types ─────────────────────────────────────────────────────

export type TaxResult = {
  /** Effective rate as a decimal fraction (e.g. 0.05 = 5%). */
  rate: number;
  /** Calculated tax amount (amount × rate). */
  amount: number;
  /**
   * Snapshot of the resolved zone. `name` is the raw Translatable JSONB so the
   * global `TranslatableInterceptor` resolves it per `Accept-Language` at the
   * wire boundary. Order snapshots store this raw shape into `taxBreakdown` so
   * a future read at a different locale stays correct.
   */
  zone: { id: string; name: Prisma.JsonValue; isCompound: boolean } | null;
};

// ── Zero-rate class names ──────────────────────────────────────────────────────

const ZERO_RATE_NAMES = new Set(['zero-rated', 'exempt']);

function isZeroRated(name: string): boolean {
  return ZERO_RATE_NAMES.has(name.toLowerCase().replace(/\s+/g, '-'));
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TAX_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── Public: Tax calculation ────────────────────────────────────────────────

  /**
   * Calculates tax for a given country, product tax class, and amount.
   *
   * Zone resolution (§9.9):
   *  1. Find the highest-priority active zone whose countries[] includes `country`.
   *  2. If no zone matches, fall back to the zone with isDefault = true.
   *  3. If `taxClassId` names a Zero-Rated or Exempt class, return 0%.
   *  4. Otherwise find a TaxClass in the matched zone with the same name and use
   *     its rate; fall back to the zone's base rate.
   *
   * Rate is stored as a decimal fraction (0.05 = 5%); taxAmount = amount × rate.
   */
  async calculateTax(
    country: string,
    taxClassId: string | null,
    amount: number,
  ): Promise<TaxResult> {
    // Resolve zone: priority-ordered country match, then isDefault fallback
    const zone = await this.resolveZone(country);

    if (!zone) {
      return { rate: 0, amount: 0, zone: null };
    }

    // Resolve effective rate
    let effectiveRate = Number(zone.rate);

    if (taxClassId) {
      const taxClass = await this.prisma.taxClass.findUnique({ where: { id: taxClassId } });

      if (taxClass) {
        // Zero-Rated / Exempt → always 0%
        if (isZeroRated(taxClass.name)) {
          return {
            rate: 0,
            amount: 0,
            zone: { id: zone.id, name: zone.name, isCompound: zone.isCompound },
          };
        }

        // Find the equivalent class (by name) in the matched zone for zone-specific rate
        const zoneClass = await this.prisma.taxClass.findFirst({
          where: { zoneId: zone.id, name: taxClass.name },
        });

        if (zoneClass) {
          effectiveRate = Number(zoneClass.rate);
        }
        // else: class type not configured for this zone → use zone base rate
      }
    }

    // Quantised at the point of computation, not left as a raw float for the
    // column to round on write. Three engines would otherwise each round this
    // by their own rule — Postgres `numeric`, the JS float composition that
    // builds the order total, and `Intl` on display — and 19 per cent puts a
    // half-millime tie on every base ending in a 50-millime step.
    const taxAmount = applyRate(amount, effectiveRate);

    this.logger.log(
      `calculateTax: country=${country} zone=${zone.id} rate=${effectiveRate} taxAmount=${taxAmount}`,
    );

    return {
      rate: effectiveRate,
      amount: taxAmount,
      zone: { id: zone.id, name: zone.name, isCompound: zone.isCompound },
    };
  }

  // ── Admin: Zones ───────────────────────────────────────────────────────────

  async listZones(query: ListTaxZonesAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.taxZone.findMany({
        orderBy: { priority: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.taxZone.count(),
    ]);

    return { data, meta: { page, pageSize, total } };
  }

  async createZone(dto: CreateTaxZoneAdminDto): Promise<unknown> {
    const zone = await this.prisma.taxZone.create({
      data: {
        name: dto.name,
        countries: dto.countries,
        rate: dto.rate,
        isDefault: dto.isDefault ?? false,
        isCompound: dto.isCompound ?? false,
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.invalidateTaxCache();
    return zone;
  }

  async getZone(id: string): Promise<unknown> {
    const zone = await this.prisma.taxZone.findUnique({ where: { id } });
    if (!zone) {
      throw new NotFoundException(`Tax zone "${id}" not found`);
    }
    return zone;
  }

  async updateZone(id: string, dto: UpdateTaxZoneAdminDto): Promise<unknown> {
    await this.ensureZoneExists(id);

    const updated = await this.prisma.taxZone.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.countries !== undefined && { countries: dto.countries }),
        ...(dto.rate !== undefined && { rate: dto.rate }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.isCompound !== undefined && { isCompound: dto.isCompound }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.invalidateTaxCache();
    return updated;
  }

  // ── Admin: Classes ─────────────────────────────────────────────────────────

  async listClasses(query: ListTaxClassesAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = query.zoneId ? { zoneId: query.zoneId } : {};

    const [data, total] = await Promise.all([
      this.prisma.taxClass.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { zone: { select: { id: true, name: true } } },
      }),
      this.prisma.taxClass.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total } };
  }

  async createClass(dto: CreateTaxClassAdminDto): Promise<unknown> {
    await this.ensureZoneExists(dto.zoneId);

    return this.prisma.taxClass.create({
      data: {
        zoneId: dto.zoneId,
        name: dto.name,
        rate: dto.rate,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async resolveZone(country: string) {
    const cacheKey = `${TAX_ZONE_CACHE_PREFIX}${country}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as Awaited<ReturnType<typeof this.prisma.taxZone.findFirst>>;
      }
    } catch {
      // cache miss — fall through to DB
    }

    // 1. Priority-ordered country match
    const matched = await this.prisma.taxZone.findFirst({
      where: { isActive: true, countries: { has: country } },
      orderBy: { priority: 'asc' },
    });

    if (matched) {
      await this.trySetCache(cacheKey, matched);
      return matched;
    }

    // 2. isDefault fallback (§9.9)
    try {
      const defaultCached = await this.redis.get(TAX_ZONE_DEFAULT_CACHE_KEY);
      if (defaultCached) {
        return JSON.parse(defaultCached) as Awaited<
          ReturnType<typeof this.prisma.taxZone.findFirst>
        >;
      }
    } catch {
      // cache miss
    }

    const defaultZone = await this.prisma.taxZone.findFirst({
      where: { isActive: true, isDefault: true },
      orderBy: { priority: 'asc' },
    });
    if (defaultZone) {
      await this.trySetCache(TAX_ZONE_DEFAULT_CACHE_KEY, defaultZone);
    }
    return defaultZone;
  }

  private async trySetCache(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', TAX_ZONE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Tax cache SET failed for key "${key}": ${(err as Error).message}`);
    }
  }

  private async invalidateTaxCache(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${TAX_ZONE_CACHE_PREFIX}*`);
      const allKeys = [...keys, TAX_ZONE_DEFAULT_CACHE_KEY];
      await this.redis.del(...allKeys);
    } catch (err) {
      this.logger.warn(`Tax cache invalidation failed: ${(err as Error).message}`);
    }
  }

  private async ensureZoneExists(id: string): Promise<void> {
    const zone = await this.prisma.taxZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException(`TaxZone "${id}" not found`);
  }
}
