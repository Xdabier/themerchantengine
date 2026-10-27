import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ShippingMethodType } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import type { CreateShippingZoneAdminDto } from './dto/create-zone.dto';
import type { UpdateShippingZoneAdminDto } from './dto/update-zone.dto';
import type { CreateShippingMethodAdminDto } from './dto/create-method.dto';
import type { UpdateShippingMethodAdminDto } from './dto/update-method.dto';
import type { ListZonesAdminDto, ListMethodsAdminDto } from './dto/query-shipping.dto';
import type { CalculateRatesDto } from './dto/calculate-rates.dto';
import {
  SHIPPING_REDIS_CLIENT,
  SHIPPING_ZONES_CACHE_PREFIX,
  SHIPPING_ZONES_TTL_SECONDS,
} from './shipping.constants';

// ── Internal zone type (with methods included) ────────────────────────────────

type ZoneWithMethods = Prisma.ShippingZoneGetPayload<{
  include: { methods: true };
}>;

// ── Public interface types ─────────────────────────────────────────────────────

export type RateResult = {
  methodId: string;
  name: unknown; // Translatable JSON
  price: number;
  /** True when this is the zone's preselected standard method (§4.15). */
  isDefault: boolean;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
};

// ── Internal JSON shapes ───────────────────────────────────────────────────────

type WeightRange = { minKg: number; maxKg: number; price: number };
type PriceRange = { minAmount: number; maxAmount: number; price: number };
type PostalCodeRange = { from: string; to: string };

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── Public: Rate calculation (storefront) ──────────────────────────────────

  /**
   * Finds the highest-priority zone matching the destination, then calculates
   * a price for each active method in that zone (§4.15, §9.9).
   *
   * Zone matching: country required; postal code ranges applied when present.
   * Priority: lower number = higher precedence — first match wins.
   */
  async calculateRates(dto: CalculateRatesDto): Promise<RateResult[]> {
    const cartWeight = dto.items.reduce((sum, i) => sum + i.weight * i.quantity, 0);
    const cartSubtotal = dto.subtotal;

    // Fetch all active zones matching the country (cache-aside, 15min TTL)
    const cacheKey = `${SHIPPING_ZONES_CACHE_PREFIX}${dto.country}`;
    let zones: ZoneWithMethods[];
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        zones = JSON.parse(cached) as ZoneWithMethods[];
      } else {
        zones = await this.prisma.shippingZone.findMany({
          where: { isActive: true, countries: { has: dto.country } },
          orderBy: { priority: 'asc' },
          include: {
            methods: {
              where: { isActive: true },
              orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
            },
          },
        });
        await this.redis.set(cacheKey, JSON.stringify(zones), 'EX', SHIPPING_ZONES_TTL_SECONDS);
      }
    } catch {
      zones = await this.prisma.shippingZone.findMany({
        where: { isActive: true, countries: { has: dto.country } },
        orderBy: { priority: 'asc' },
        include: {
          methods: {
            where: { isActive: true },
            orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
          },
        },
      });
    }

    // First zone that also passes postal code check wins (§9.9)
    const matchingZone = zones.find((zone) => {
      if (!dto.postalCode || !zone.postalCodeRanges) return true;
      const ranges = zone.postalCodeRanges as PostalCodeRange[];
      return ranges.some((r) => dto.postalCode! >= r.from && dto.postalCode! <= r.to);
    });

    if (!matchingZone) return [];

    const rates: RateResult[] = [];
    for (const method of matchingZone.methods) {
      const price = this.resolveMethodPrice(method, cartWeight, cartSubtotal);
      if (price === null) continue; // no applicable range — skip method
      rates.push({
        methodId: method.id,
        name: method.name,
        price,
        isDefault: method.isDefault ?? false,
        estimatedDaysMin: method.estimatedDaysMin,
        estimatedDaysMax: method.estimatedDaysMax,
      });
    }

    this.logger.log(
      `calculateRates: country=${dto.country} zone=${matchingZone.id} methods=${rates.length}`,
    );
    return rates;
  }

  /**
   * Picks the rate to charge when the caller has not chosen one explicitly.
   * Flag-based (not position-based) so it is correct even if a stale Redis cache
   * entry preserved a pre-deploy ordering: the zone's `isDefault` method wins,
   * falling back to the first rate. Returns null only when there are no rates.
   */
  resolveDefaultRate(rates: RateResult[]): RateResult | null {
    if (!rates.length) return null;
    return rates.find((r) => r.isDefault) ?? rates[0];
  }

  /**
   * True when the store has at least one active, non-deleted shipping zone.
   * Lets the order pipeline tell "store ships, but not to this destination"
   * (→ SHIPPING_UNAVAILABLE) apart from "store has no shipping configured at
   * all" (→ legacy 0-shipping order, e.g. digital-only / test fixtures).
   */
  async hasActiveZones(): Promise<boolean> {
    const count = await this.prisma.shippingZone.count({
      where: { isActive: true, deletedAt: null },
    });
    return count > 0;
  }

  /**
   * Resolves the store's single standard rate WITHOUT a destination address, for
   * the cart page (which has no shipping address yet). Returns a rate only when
   * the store has exactly ONE active default method across all live zones — the
   * QA-only single-zone case. With zero or multiple defaults the destination is
   * ambiguous, so it returns null and the cart shows its "calculated at checkout"
   * hint. Pure read (no writes) — safe on the hot getCart path and idempotent.
   */
  async getStoreDefaultRate(input: {
    items: { weight: number; quantity: number }[];
    subtotal: number;
  }): Promise<RateResult | null> {
    const defaults = await this.prisma.shippingMethod.findMany({
      where: {
        isDefault: true,
        isActive: true,
        deletedAt: null,
        zone: { isActive: true, deletedAt: null },
      },
      take: 2,
    });
    if (defaults.length !== 1) return null; // none, or ambiguous across zones

    const method = defaults[0];
    const cartWeight = input.items.reduce((sum, i) => sum + i.weight * i.quantity, 0);
    const price = this.resolveMethodPrice(method, cartWeight, input.subtotal);
    if (price === null) return null;

    return {
      methodId: method.id,
      name: method.name,
      price,
      isDefault: true,
      estimatedDaysMin: method.estimatedDaysMin,
      estimatedDaysMax: method.estimatedDaysMax,
    };
  }

  // ── Admin: Zones ───────────────────────────────────────────────────────────

  async listZones(query: ListZonesAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.shippingZone.findMany({
        orderBy: { priority: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.shippingZone.count(),
    ]);

    return { data, meta: { page, pageSize, total } };
  }

  async createZone(dto: CreateShippingZoneAdminDto): Promise<unknown> {
    const zone = await this.prisma.shippingZone.create({
      data: {
        name: dto.name,
        countries: dto.countries,
        states: dto.states ?? [],
        postalCodeRanges: dto.postalCodeRanges ?? undefined,
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.invalidateShippingCache();
    return zone;
  }

  async updateZone(id: string, dto: UpdateShippingZoneAdminDto): Promise<unknown> {
    await this.ensureZoneExists(id);

    const updated = await this.prisma.shippingZone.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.countries !== undefined && { countries: dto.countries }),
        ...(dto.states !== undefined && { states: dto.states }),
        ...(dto.postalCodeRanges !== undefined && { postalCodeRanges: dto.postalCodeRanges }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.invalidateShippingCache();
    return updated;
  }

  // ── Admin: Methods ─────────────────────────────────────────────────────────

  async listMethods(query: ListMethodsAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortOrder = query.sortOrder ?? 'asc';

    const where = query.zoneId ? { zoneId: query.zoneId } : {};

    const [data, total] = await Promise.all([
      this.prisma.shippingMethod.findMany({
        where,
        orderBy: { sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { zone: { select: { id: true, name: true } } },
      }),
      this.prisma.shippingMethod.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total } };
  }

  async createMethod(dto: CreateShippingMethodAdminDto): Promise<unknown> {
    await this.ensureZoneExists(dto.zoneId);
    this.validateMethodConfig(dto.type, dto);

    const method = await this.prisma.$transaction(async (tx) => {
      // Clear any sibling default first — the partial-unique index permits only
      // one default per live zone, so creating a second default would throw.
      // The clear-then-set is the primary guard, the index the backstop (§3.4).
      if (dto.isDefault) {
        await tx.shippingMethod.updateMany({
          where: { zoneId: dto.zoneId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }
      return tx.shippingMethod.create({
        data: {
          zoneId: dto.zoneId,
          name: dto.name,
          type: dto.type,
          price: dto.price ?? null,
          weightRanges: dto.weightRanges ?? undefined,
          priceRanges: dto.priceRanges ?? undefined,
          freeAbove: dto.freeAbove ?? null,
          estimatedDaysMin: dto.estimatedDaysMin ?? null,
          estimatedDaysMax: dto.estimatedDaysMax ?? null,
          isActive: dto.isActive ?? true,
          isDefault: dto.isDefault ?? false,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    });
    await this.invalidateShippingCache();
    return method;
  }

  async updateMethod(id: string, dto: UpdateShippingMethodAdminDto): Promise<unknown> {
    const method = await this.prisma.shippingMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException(`ShippingMethod "${id}" not found`);

    const effectiveType = dto.type ?? method.type;
    this.validateMethodConfig(effectiveType, dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Promoting this method to default clears the zone's other live defaults
      // first, so the one-default-per-zone partial-unique index is never
      // violated. Clear-then-set is the primary guard, the index the backstop.
      if (dto.isDefault === true) {
        await tx.shippingMethod.updateMany({
          where: { zoneId: method.zoneId, isDefault: true, deletedAt: null, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.shippingMethod.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.weightRanges !== undefined && { weightRanges: dto.weightRanges }),
          ...(dto.priceRanges !== undefined && { priceRanges: dto.priceRanges }),
          ...(dto.freeAbove !== undefined && { freeAbove: dto.freeAbove }),
          ...(dto.estimatedDaysMin !== undefined && { estimatedDaysMin: dto.estimatedDaysMin }),
          ...(dto.estimatedDaysMax !== undefined && { estimatedDaysMax: dto.estimatedDaysMax }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        },
      });
    });
    await this.invalidateShippingCache();
    return updated;
  }

  /** Deactivates a shipping method (soft disable — orders retain their snapshot). */
  async deleteMethod(id: string): Promise<void> {
    const method = await this.prisma.shippingMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException(`ShippingMethod "${id}" not found`);

    await this.prisma.shippingMethod.update({
      where: { id },
      data: { isActive: false },
    });
    await this.invalidateShippingCache();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async ensureZoneExists(id: string): Promise<void> {
    const zone = await this.prisma.shippingZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException(`ShippingZone "${id}" not found`);
  }

  /** Flushes all shipping zone cache keys (pattern-delete on Redis). */
  private async invalidateShippingCache(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${SHIPPING_ZONES_CACHE_PREFIX}*`);
      if (keys.length > 0) await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(`Shipping cache invalidation failed: ${(err as Error).message}`);
    }
  }

  /**
   * Calculates the shipping price for a method given cart weight and subtotal.
   * Returns null when the method type has no applicable configuration/range.
   */
  private resolveMethodPrice(
    method: {
      type: ShippingMethodType;
      price: unknown;
      weightRanges: unknown;
      priceRanges: unknown;
      freeAbove: unknown;
    },
    cartWeight: number,
    cartSubtotal: number,
  ): number | null {
    // freeAbove threshold overrides any calculated price
    if (method.freeAbove !== null && cartSubtotal >= Number(method.freeAbove)) {
      return 0;
    }

    switch (method.type) {
      case ShippingMethodType.FREE:
        return 0;

      case ShippingMethodType.FLAT_RATE:
        return method.price !== null ? Number(method.price) : null;

      case ShippingMethodType.WEIGHT_BASED: {
        if (!method.weightRanges) return null;
        const ranges = method.weightRanges as WeightRange[];
        const match = ranges.find((r) => cartWeight >= r.minKg && cartWeight <= r.maxKg);
        return match ? match.price : null;
      }

      case ShippingMethodType.PRICE_BASED: {
        if (!method.priceRanges) return null;
        const ranges = method.priceRanges as PriceRange[];
        const match = ranges.find(
          (r) => cartSubtotal >= r.minAmount && cartSubtotal <= r.maxAmount,
        );
        return match ? match.price : null;
      }

      case ShippingMethodType.CARRIER_CALCULATED:
        return null; // not implemented

      default:
        return null;
    }
  }

  /**
   * Guards against obviously wrong method configurations at create/update time.
   */
  private validateMethodConfig(
    type: ShippingMethodType,
    dto: Partial<CreateShippingMethodAdminDto>,
  ): void {
    if (type === ShippingMethodType.FLAT_RATE && dto.price === undefined && dto.price === null) {
      throw new BadRequestException('FLAT_RATE methods require a price');
    }
    if (type === ShippingMethodType.WEIGHT_BASED && !dto.weightRanges?.length) {
      // Only fail on create (price can be updated separately)
      if ('zoneId' in dto) {
        throw new BadRequestException('WEIGHT_BASED methods require weightRanges');
      }
    }
    if (type === ShippingMethodType.PRICE_BASED && !dto.priceRanges?.length) {
      if ('zoneId' in dto) {
        throw new BadRequestException('PRICE_BASED methods require priceRanges');
      }
    }
  }
}
