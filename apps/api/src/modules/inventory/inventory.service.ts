// raw-sql-approved: atomic stock writes, all of the same WHERE-guarded shape
// so the database refuses a losing write rather than a stale read allowing it.
//   - decrementStock + transferInventory: UPDATE ... WHERE on_hand >= qty,
//     per merchants-engine technical spec §9.4 C2.
//   - adjustInventory set-to mode: UPDATE ... WHERE on_hand = expected AND
//     target >= reserved ... RETURNING, a compare-and-set. RETURNING rather
//     than a row count because the count cannot distinguish a lost race from
//     a missing row from a below-reserved target.
//   - adjustInventory negative delta: UPDATE ... WHERE on_hand + delta >= 0,
//     replacing a read-then-compare that two concurrent calls could both pass.
// See specs/decision-records/16-raw-sql-inventory-stock-decrement.md.
// Reviewed by db-safety-auditor on 2026-05-15; amended 2026-08-27 for the
// adjustInventory statements above.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryStockConflictException } from './inventory-stock-conflict.exception';
import { InventorySetBelowReservedException } from './inventory-set-below-reserved.exception';
import { InventoryAdjustModeException } from './inventory-adjust-mode.exception';
import { AdjustmentReason, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../../common/idempotency.service';
import {
  IdempotencyKeyConflictException,
  IdempotencyKeyForbiddenException,
} from '../../common/exceptions/idempotency.exception';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import {
  INVENTORY_EVENTS,
  LOW_STOCK_THRESHOLD,
  VALID_MOVEMENT_SORT_FIELDS,
  VALID_STOCK_SORT_FIELDS,
  stockStatusFor,
  type StockStatus,
} from './inventory.constants';
import { SettingsService } from '../settings/settings.service';
import type { CreateInventoryLocationAdminDto } from './dto/create-location.dto';
import type { UpdateInventoryLocationAdminDto } from './dto/update-location.dto';
import type { AdjustInventoryAdminDto } from './dto/adjust-inventory.dto';
import type { TransferInventoryAdminDto } from './dto/transfer-inventory.dto';
import type { ListStockLevelsAdminDto, ListMovementsAdminDto } from './dto/query-inventory.dto';

// ── Public interface types ─────────────────────────────────────────────────────

export type AvailabilityResult = {
  available: number;
  locations: {
    locationId: string;
    locationName: string;
    onHand: number;
    reserved: number;
    available: number;
  }[];
};

/** Net available stock for one variant plus the three-state grade of it. */
export type VariantAvailability = { stock: number; availability: StockStatus };

export type DecrementOptions = {
  locationId?: string;
  referenceType?: string;
  referenceId?: string;
  performedBy?: string;
};

export type IncrementOptions = {
  locationId?: string;
  referenceType?: string;
  referenceId?: string;
  performedBy?: string;
  movementType?: MovementType;
};

// ── Service ────────────────────────────────────────────────────────────────────

/**
 * The transaction handle the extended client actually hands its callback.
 *
 * Not `Prisma.TransactionClient`: this client is built with `$extends` for the
 * soft-delete middleware, so its transaction type is a wider shape than the
 * generated alias and the two are not assignable. Deriving it from the service
 * keeps them in step if the extension list ever changes.
 */
interface VariantStockRows {
  levels: Array<{
    stockLevelId: string;
    locationId: string;
    location: { id: string; name: string; code: string; isActive: boolean };
    onHand: number;
    reserved: number;
    available: number;
    updatedAt: Date;
  }>;
  totals: { onHand: number; reserved: number; available: number };
}

type StockTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly idempotency: IdempotencyService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The one low-stock threshold every surface shares: the store setting when it
   * is a valid non-negative integer, else the module constant. Read once per
   * request so the status badge, the list filter and the storefront
   * availability state cannot disagree. Public so sibling modules (products,
   * search) can derive availability through service injection rather than
   * reading settings or stock rows themselves.
   */
  async effectiveLowStockThreshold(): Promise<number> {
    try {
      const raw = await this.settings.get<unknown>('defaultLowStockThreshold');
      const value = typeof raw === 'number' ? raw : raw == null ? NaN : Number(raw);
      if (Number.isInteger(value) && value >= 0) return value;
    } catch (err) {
      this.logger.warn(`Low-stock threshold setting unreadable: ${(err as Error).message}`);
    }
    return LOW_STOCK_THRESHOLD;
  }

  /**
   * Net available stock and its grade for a set of variants, in one query.
   * Exists so sibling modules (products, search) can show a fresh availability
   * state without caching one and without reading stock rows themselves, which
   * §3.1 forbids. Every id passed in comes back: a variant with no stock row
   * folds to 0 and grades OUT_OF_STOCK.
   */
  async availabilityForVariants(variantIds: string[]): Promise<Map<string, VariantAvailability>> {
    const graded = new Map<string, VariantAvailability>();
    if (variantIds.length === 0) return graded;

    // Read once for the whole batch so two variants can never be graded
    // against different thresholds.
    const threshold = await this.effectiveLowStockThreshold();

    const levels = await this.prisma.stockLevel.findMany({
      where: { variantId: { in: variantIds } },
      select: { variantId: true, onHand: true, reserved: true },
    });

    const stockByVariant = new Map<string, number>();
    for (const level of levels) {
      // Clamp per location: a reservation can briefly exceed onHand while a
      // decrement is in flight, and one location must not eat another's stock.
      const available = Math.max(0, level.onHand - level.reserved);
      stockByVariant.set(level.variantId, (stockByVariant.get(level.variantId) ?? 0) + available);
    }

    for (const variantId of variantIds) {
      const stock = stockByVariant.get(variantId) ?? 0;
      graded.set(variantId, { stock, availability: stockStatusFor(stock, threshold) });
    }

    return graded;
  }

  /**
   * Shared idempotency guard for the two admin-tier sensitive writes
   * (`adjustInventory`, `transferInventory`). Returns `null` from the
   * cached/in-flight/conflict/forbidden branches so the caller can
   * short-circuit; returns the args bundle from the fresh branch so the
   * caller can finalize via `completeRequest` once the side-effects land.
   */
  private async beginIdempotent(
    scope: string,
    idempotencyKey: string,
    performedBy: string,
    body: Record<string, unknown>,
  ): Promise<{ callerHash: string; bodyHash: string } | null> {
    const callerHash = IdempotencyService.sha256Hex(performedBy);
    const bodyHash = IdempotencyService.sha256Hex(IdempotencyService.stableStringify(body));
    const begin = await this.idempotency.beginRequest({
      scope,
      key: idempotencyKey,
      callerHash,
      bodyHash,
    });
    switch (begin.state) {
      case 'cached':
        return null;
      case 'forbidden':
        throw new IdempotencyKeyForbiddenException();
      case 'conflict':
        throw new IdempotencyKeyConflictException();
      case 'in-flight':
        throw new IdempotencyKeyConflictException();
      case 'fresh':
        return { callerHash, bodyHash };
    }
  }

  // ── Public interface (called by Cart / Orders modules) ─────────────────────

  /**
   * Returns total available stock across all active locations for a variant.
   * available = onHand - reserved (computed, never stored — §9.1 S1).
   */
  async checkAvailability(variantId: string): Promise<AvailabilityResult> {
    const levels = await this.prisma.stockLevel.findMany({
      where: { variantId, location: { isActive: true } },
      include: { location: { select: { name: true } } },
    });

    const locationBreakdown = levels.map((l) => ({
      locationId: l.locationId,
      locationName: l.location.name,
      onHand: l.onHand,
      reserved: l.reserved,
      available: l.onHand - l.reserved,
    }));

    const available = locationBreakdown.reduce((sum, l) => sum + l.available, 0);

    return { available, locations: locationBreakdown };
  }

  /**
   * Atomically decrements onHand at the best available location.
   * Uses $executeRaw — the ONE sanctioned exception to the no-raw-SQL rule.
   * The UPDATE ... WHERE onHand >= qty guarantees no oversell even under concurrency.
   *
   * Returns true on success, false if stock was insufficient.
   */
  async decrementStock(
    variantId: string,
    quantity: number,
    options: DecrementOptions = {},
  ): Promise<boolean> {
    // Resolve target location — prefer caller-supplied, otherwise pick highest onHand
    let locationId = options.locationId;
    if (!locationId) {
      const best = await this.prisma.stockLevel.findFirst({
        where: { variantId, location: { isActive: true } },
        orderBy: { onHand: 'desc' },
      });
      if (!best) return false;
      locationId = best.locationId;
    }

    // Sanctioned $executeRaw: atomic stock decrement — only approved use of raw SQL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsAffected: number = await (this.prisma as any).$executeRaw`
      UPDATE "StockLevel"
      SET "onHand" = "onHand" - ${quantity}::int
      WHERE "variantId" = ${variantId}
      AND "locationId" = ${locationId}
      AND "onHand" >= ${quantity}::int
    `;

    if (rowsAffected === 0) return false;

    await this.prisma.inventoryMovement.create({
      data: {
        variantId,
        locationId,
        type: MovementType.SALE,
        quantity: -quantity,
        referenceType: options.referenceType ?? null,
        referenceId: options.referenceId ?? null,
        performedBy: options.performedBy ?? null,
      },
    });

    this.logger.log(`Stock decremented: variant=${variantId} qty=${quantity} loc=${locationId}`);

    await this.emitStockAlertIfCrossed(variantId);
    return true;
  }

  /**
   * Emits inventory.out_of_stock or inventory.low_stock after a successful
   * decrement drives onHand across the threshold boundary. Aggregates onHand
   * across active locations so a variant only flags when total stock drops.
   * Fire-and-forget — errors are logged, never thrown.
   */
  private async emitStockAlertIfCrossed(variantId: string): Promise<void> {
    try {
      const levels = await this.prisma.stockLevel.findMany({
        where: { variantId, location: { isActive: true } },
        include: { variant: { select: { sku: true } } },
      });
      const total = levels.reduce((sum, l) => sum + l.onHand, 0);
      const sku = levels[0]?.variant?.sku ?? null;
      if (total <= 0) {
        this.events.emit(INVENTORY_EVENTS.OUT_OF_STOCK, { variantId, sku, quantity: 0 });
      } else if (total <= LOW_STOCK_THRESHOLD) {
        this.events.emit(INVENTORY_EVENTS.LOW_STOCK, { variantId, sku, quantity: total });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to emit stock alert for variant ${variantId}: ${(err as Error).message}`,
      );
    }
  }

  /** Sum onHand across a variant's active locations — the variant's total stock. */
  private async sumOnHand(variantId: string): Promise<number> {
    const levels = await this.prisma.stockLevel.findMany({
      where: { variantId, location: { isActive: true } },
      select: { onHand: true },
    });
    return (levels ?? []).reduce((sum, l) => sum + l.onHand, 0);
  }

  /**
   * Emits inventory.restocked when a stock-IN drives a variant's TOTAL onHand
   * across active locations from <=0 to >0 (NE8). Fire-and-forget — errors are
   * logged, never thrown. The event string matches the webhooks catalogue so the
   * already-wired webhooks listener AND the back-in-stock fan-out both consume
   * it. Transfers never call this: a transfer conserves the variant total
   * (decrement source + increment destination), so it can never cross zero.
   * The double-emit risk under concurrent increments is acceptable — the
   * downstream per-(user,product,day) dedupe key absorbs duplicates.
   */
  private async emitRestockIfCrossed(
    variantId: string,
    prevTotal: number,
    newTotal: number,
  ): Promise<void> {
    try {
      if (!(prevTotal <= 0 && newTotal > 0)) return;
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { sku: true, productId: true },
      });
      this.events.emit(INVENTORY_EVENTS.RESTOCKED, {
        variantId,
        productId: variant?.productId ?? null,
        sku: variant?.sku ?? null,
        quantity: newTotal,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit restock event for variant ${variantId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Increments onHand for a variant (returns / adjustments).
   * Upserts the StockLevel record so the first stock receipt also creates the row.
   */
  async incrementStock(
    variantId: string,
    quantity: number,
    reason: AdjustmentReason,
    options: IncrementOptions = {},
  ): Promise<void> {
    let locationId = options.locationId;
    if (!locationId) {
      const existing = await this.prisma.stockLevel.findFirst({
        where: { variantId, location: { isActive: true } },
      });
      if (existing) {
        locationId = existing.locationId;
      } else {
        const loc = await this.prisma.inventoryLocation.findFirst({ where: { isActive: true } });
        if (!loc) throw new NotFoundException('No active inventory location found');
        locationId = loc.id;
      }
    }

    const prevTotal = await this.sumOnHand(variantId);

    await this.prisma.stockLevel.upsert({
      where: { variantId_locationId: { variantId, locationId } },
      update: { onHand: { increment: quantity } },
      create: { variantId, locationId, onHand: quantity, reserved: 0 },
    });

    await this.prisma.inventoryMovement.create({
      data: {
        variantId,
        locationId,
        type: options.movementType ?? MovementType.ADJUSTMENT,
        quantity,
        reason,
        referenceType: options.referenceType ?? null,
        referenceId: options.referenceId ?? null,
        performedBy: options.performedBy ?? null,
      },
    });

    this.logger.log(`Stock incremented: variant=${variantId} qty=${quantity} loc=${locationId}`);

    // A single-location increment adds exactly `quantity` to the variant total.
    await this.emitRestockIfCrossed(variantId, prevTotal, prevTotal + quantity);
  }

  // ── Admin: Stock levels ────────────────────────────────────────────────────

  async listStockLevels(query: ListStockLevelsAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = VALID_STOCK_SORT_FIELDS.includes(
      (query.sortBy ?? '') as (typeof VALID_STOCK_SORT_FIELDS)[number],
    )
      ? query.sortBy!
      : 'updatedAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const threshold = await this.effectiveLowStockThreshold();

    const where: Prisma.StockLevelWhereInput = {};
    if (query.variantId) where.variantId = query.variantId;
    if (query.locationId) where.locationId = query.locationId;

    // Stock status filter — applied on stored onHand (available = onHand - reserved)
    if (query.stockStatus === 'OUT_OF_STOCK') {
      where.onHand = { lte: 0 };
    } else if (query.stockStatus === 'LOW_STOCK') {
      where.onHand = { gt: 0, lte: threshold };
    } else if (query.stockStatus === 'IN_STOCK') {
      where.onHand = { gt: threshold };
    }

    const [records, total] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where,
        include: {
          location: { select: { id: true, name: true, code: true } },
          // The product name, so a stock row can link to the product by name
          // rather than leaving the operator to recognise a SKU.
          variant: {
            select: {
              id: true,
              sku: true,
              productId: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockLevel.count({ where }),
    ]);

    const data = records.map((r) => ({
      ...r,
      available: r.onHand - r.reserved,
      lowStockThreshold: threshold,
      status: stockStatusFor(r.onHand, threshold),
    }));

    return { data, meta: { page, pageSize, total } };
  }

  /**
   * Variant stock for the admin detail screen, WITH the variant's identity.
   *
   * It replaced a bare-array `getVariantStock`, which could not answer this
   * screen's first question: a variant with no StockLevel rows returned `[]`,
   * so the page had no product to name and no product to link to, and fell
   * back to printing the raw variant id. That is precisely the variant an
   * operator is looking for when stock is missing.
   *
   * The array version is gone rather than kept beside this one. Its docstring
   * claimed the wishlist module consumed it; the wishlist calls
   * `availabilityForVariants`, and nothing called the array. Two live-looking
   * shapes for one route are what let the controller change under the e2e
   * specs without anyone noticing.
   */
  async getVariantStockDetail(variantId: string): Promise<unknown> {
    await this.ensureVariantExists(variantId);

    const [variant, levels] = await Promise.all([
      this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: {
          id: true,
          sku: true,
          product: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.stockLevel.findMany({
        where: { variantId },
        include: {
          location: { select: { id: true, name: true, code: true, isActive: true } },
        },
        orderBy: { location: { name: 'asc' } },
      }),
    ]);

    // Unwrapped: the global response interceptor adds the `{ data: ... }`
    // envelope, and wrapping here too emits `{"data":{"data":…}}`.
    return {
      variant,
      levels: levels.map((l) => ({ ...l, available: l.onHand - l.reserved })),
    };
  }

  /**
   * Per-location stock for a set of variants, in one read.
   *
   * Public so the products module can compose a product-scoped view without
   * touching StockLevel itself (§3.1). Sibling of `availabilityForVariants`,
   * which aggregates and therefore cannot serve a screen that has to write to
   * one specific location.
   *
   * Returns an entry for EVERY requested variant, including those with no rows
   * at all. That is what makes creating the first stock row reachable: a screen
   * built on a filter over StockLevel would simply not show such a variant.
   */
  async stockForVariants(variantIds: readonly string[]): Promise<Map<string, VariantStockRows>> {
    const out = new Map<string, VariantStockRows>();
    for (const id of variantIds)
      out.set(id, { levels: [], totals: { onHand: 0, reserved: 0, available: 0 } });
    if (variantIds.length === 0) return out;

    const levels = await this.prisma.stockLevel.findMany({
      where: { variantId: { in: [...variantIds] } },
      include: { location: { select: { id: true, name: true, code: true, isActive: true } } },
      orderBy: { location: { name: 'asc' } },
    });

    for (const level of levels) {
      const entry = out.get(level.variantId);
      if (!entry) continue;
      // Clamp per location, exactly as availabilityForVariants does: a
      // reservation can briefly exceed onHand while a decrement is in flight,
      // and one location must not eat another's stock.
      const available = Math.max(0, level.onHand - level.reserved);
      entry.levels.push({
        stockLevelId: level.id,
        locationId: level.locationId,
        location: level.location,
        onHand: level.onHand,
        reserved: level.reserved,
        available,
        updatedAt: level.updatedAt,
      });
      entry.totals.onHand += level.onHand;
      entry.totals.reserved += level.reserved;
      entry.totals.available += available;
    }
    return out;
  }

  /** Active locations, for a screen that has to offer somewhere to write to. */
  async listActiveLocations(): Promise<unknown[]> {
    return this.prisma.inventoryLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /** The low-stock threshold a caller should grade these numbers against. */
  async stockThreshold(): Promise<number> {
    return this.effectiveLowStockThreshold();
  }

  // ── Admin: Manual adjustment ───────────────────────────────────────────────

  /**
   * Compare-and-set one location's `onHand`.
   *
   * The whole guard lives in the WHERE, including the reserved check, so there
   * is no read-then-write window: a concurrent change makes the statement match
   * zero rows rather than letting this call overwrite it.
   *
   * `$queryRaw` with RETURNING rather than `$executeRaw`, because a row count
   * alone cannot tell "the row moved" from "there is no row" from "the target
   * is below reserved", and those are three different answers for the operator.
   */
  private async applySetTo(
    tx: StockTx,
    dto: AdjustInventoryAdminDto,
    setTo: number,
    expectedOnHand: number,
  ): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated: Array<{ onHand: number }> = await (tx as any).$queryRaw`
      UPDATE "StockLevel"
      SET "onHand" = ${setTo}::int
      WHERE "variantId" = ${dto.variantId}
      AND "locationId" = ${dto.locationId}
      AND "onHand" = ${expectedOnHand}::int
      AND ${setTo}::int >= "reserved"
      RETURNING "onHand"
    `;
    if (updated.length === 1) return setTo - expectedOnHand;

    // Nothing matched. Read the row to say which of the three it was.
    const level = await tx.stockLevel.findUnique({
      where: { variantId_locationId: { variantId: dto.variantId, locationId: dto.locationId } },
    });

    if (!level) {
      // No row yet. Only a caller that expected none may create one; expecting
      // some other number means they were looking at something that has since
      // gone, which is still a conflict.
      if (expectedOnHand !== 0) throw new InventoryStockConflictException(0);
      await tx.stockLevel.create({
        data: { variantId: dto.variantId, locationId: dto.locationId, onHand: setTo, reserved: 0 },
      });
      return setTo;
    }
    if (setTo < level.reserved) {
      throw new InventorySetBelowReservedException(setTo, level.reserved);
    }
    throw new InventoryStockConflictException(level.onHand);
  }

  /**
   * Apply a signed delta.
   *
   * A negative delta is applied with the same WHERE-guarded shape
   * `decrementStock` uses (§3.4). It previously read the row and compared in
   * JavaScript inside the transaction, so two concurrent negative adjustments
   * could both pass the check and drive `onHand` below zero.
   */
  private async applyDelta(
    tx: StockTx,
    dto: AdjustInventoryAdminDto,
    quantity: number,
  ): Promise<number> {
    if (quantity >= 0) {
      // A positive delta cannot underflow, so the upsert is safe as it stands
      // and still covers the create case.
      await tx.stockLevel.upsert({
        where: { variantId_locationId: { variantId: dto.variantId, locationId: dto.locationId } },
        update: { onHand: { increment: quantity } },
        create: {
          variantId: dto.variantId,
          locationId: dto.locationId,
          onHand: quantity,
          reserved: 0,
        },
      });
      return quantity;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsAffected: number = await (tx as any).$executeRaw`
      UPDATE "StockLevel"
      SET "onHand" = "onHand" + ${quantity}::int
      WHERE "variantId" = ${dto.variantId}
      AND "locationId" = ${dto.locationId}
      AND "onHand" + ${quantity}::int >= 0
    `;
    if (rowsAffected === 0) {
      const level = await tx.stockLevel.findUnique({
        where: { variantId_locationId: { variantId: dto.variantId, locationId: dto.locationId } },
      });
      throw new BadRequestException(
        `Adjustment would drive onHand below zero (current: ${level?.onHand ?? 0}, delta: ${quantity})`,
      );
    }
    return quantity;
  }

  async adjustInventory(
    dto: AdjustInventoryAdminDto,
    performedBy: string,
    idempotencyKey: string,
  ): Promise<void> {
    const isSet = dto.setTo !== undefined;
    if (isSet && dto.quantity !== undefined) {
      throw new InventoryAdjustModeException('Send either quantity or setTo, not both');
    }
    if (!isSet && dto.quantity === undefined) {
      throw new InventoryAdjustModeException('Send either quantity or setTo');
    }
    if (isSet && dto.expectedOnHand === undefined) {
      throw new InventoryAdjustModeException('setTo requires expectedOnHand');
    }

    const idempArgs = await this.beginIdempotent('inventory-adjust', idempotencyKey, performedBy, {
      ...dto,
    });
    if (!idempArgs) return;

    try {
      await this.ensureVariantExists(dto.variantId);
      await this.ensureLocationExists(dto.locationId);

      const prevTotal = await this.sumOnHand(dto.variantId);

      // The signed change this call makes, computed ONCE and reused for the
      // movement row and the restock event. Deriving it twice is how the
      // set-to path produced `prevTotal + undefined` and silently stopped
      // emitting `inventory.restocked`, which drives the back-in-stock mail.
      let delta: number;

      await this.prisma.$transaction(async (tx) => {
        delta = isSet
          ? await this.applySetTo(tx, dto, dto.setTo as number, dto.expectedOnHand as number)
          : await this.applyDelta(tx, dto, dto.quantity as number);

        await tx.inventoryMovement.create({
          data: {
            variantId: dto.variantId,
            locationId: dto.locationId,
            type: MovementType.ADJUSTMENT,
            // Always the DELTA, never the absolute target. InventoryMovement is
            // an append-only ledger of signed changes, so writing 25 for a
            // set-to-25 over a previous 20 would corrupt every reading of it.
            quantity: delta,
            reason: dto.reason,
            notes: dto.notes ?? null,
            performedBy,
          },
        });
      });

      await this.emitRestockIfCrossed(dto.variantId, prevTotal, prevTotal + delta!);

      await this.idempotency.completeRequest({
        scope: 'inventory-adjust',
        key: idempotencyKey,
        ...idempArgs,
        entityId: `${dto.variantId}:${dto.locationId}`,
        responseJson: null,
      });
    } catch (err) {
      await this.idempotency.abortRequest({
        scope: 'inventory-adjust',
        key: idempotencyKey,
        callerHash: idempArgs.callerHash,
      });
      throw err;
    }
  }

  // ── Admin: Transfer ────────────────────────────────────────────────────────

  async transferInventory(
    dto: TransferInventoryAdminDto,
    performedBy: string,
    idempotencyKey: string,
  ): Promise<void> {
    const idempArgs = await this.beginIdempotent(
      'inventory-transfer',
      idempotencyKey,
      performedBy,
      { ...dto },
    );
    if (!idempArgs) return;

    try {
      if (dto.fromLocationId === dto.toLocationId) {
        throw new BadRequestException('Source and destination locations must differ');
      }

      await this.ensureVariantExists(dto.variantId);
      await this.ensureLocationExists(dto.fromLocationId);
      await this.ensureLocationExists(dto.toLocationId);

      await this.prisma.$transaction(async (tx) => {
        const source = await tx.stockLevel.findUnique({
          where: {
            variantId_locationId: { variantId: dto.variantId, locationId: dto.fromLocationId },
          },
        });

        const available = source ? source.onHand - source.reserved : 0;
        if (available < dto.quantity) {
          throw new BadRequestException(
            `Insufficient available stock at source location (available: ${available}, requested: ${dto.quantity})`,
          );
        }

        // Race-safe decrement: WHERE on_hand >= qty serialises concurrent transfers
        // on the StockLevel row — the loser sees rowsAffected = 0 even when the
        // JS-side fast-fail above passed against a stale read. See
        // specs/decision-records/16-raw-sql-inventory-stock-decrement.md.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rowsAffected: number = await (tx as any).$executeRaw`
          UPDATE "StockLevel"
          SET "onHand" = "onHand" - ${dto.quantity}::int
          WHERE "variantId" = ${dto.variantId}
          AND "locationId" = ${dto.fromLocationId}
          AND "onHand" >= ${dto.quantity}::int
        `;
        if (rowsAffected === 0) {
          throw new BadRequestException(
            `Insufficient available stock at source location (requested: ${dto.quantity})`,
          );
        }

        await tx.stockLevel.upsert({
          where: {
            variantId_locationId: { variantId: dto.variantId, locationId: dto.toLocationId },
          },
          update: { onHand: { increment: dto.quantity } },
          create: {
            variantId: dto.variantId,
            locationId: dto.toLocationId,
            onHand: dto.quantity,
            reserved: 0,
          },
        });

        await tx.inventoryMovement.createMany({
          data: [
            {
              variantId: dto.variantId,
              locationId: dto.fromLocationId,
              type: MovementType.TRANSFER,
              quantity: -dto.quantity,
              notes: dto.notes ?? null,
              performedBy,
            },
            {
              variantId: dto.variantId,
              locationId: dto.toLocationId,
              type: MovementType.TRANSFER,
              quantity: dto.quantity,
              notes: dto.notes ?? null,
              performedBy,
            },
          ],
        });
      });

      await this.idempotency.completeRequest({
        scope: 'inventory-transfer',
        key: idempotencyKey,
        ...idempArgs,
        entityId: `${dto.variantId}:${dto.fromLocationId}->${dto.toLocationId}`,
        responseJson: null,
      });
    } catch (err) {
      await this.idempotency.abortRequest({
        scope: 'inventory-transfer',
        key: idempotencyKey,
        callerHash: idempArgs.callerHash,
      });
      throw err;
    }
  }

  // ── Admin: Movement log ────────────────────────────────────────────────────

  async listMovements(query: ListMovementsAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = VALID_MOVEMENT_SORT_FIELDS.includes(
      (query.sortBy ?? '') as (typeof VALID_MOVEMENT_SORT_FIELDS)[number],
    )
      ? query.sortBy!
      : 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.InventoryMovementWhereInput = {};
    if (query.variantId) where.variantId = query.variantId;
    if (query.locationId) where.locationId = query.locationId;
    if (query.type) where.type = query.type;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [records, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          location: { select: { id: true, name: true, code: true } },
          // Same widening as the stock list: a movement row should name the
          // product it moved, not only its SKU.
          variant: {
            select: {
              id: true,
              sku: true,
              productId: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);

    return { data: records, meta: { page, pageSize, total } };
  }

  // ── Admin: Locations CRUD ─────────────────────────────────────────────────

  async listLocations(page: number, pageSize: number): Promise<PaginatedResult<unknown>> {
    const [data, total] = await Promise.all([
      this.prisma.inventoryLocation.findMany({
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryLocation.count(),
    ]);
    return { data, meta: { page, pageSize, total } };
  }

  async createLocation(dto: CreateInventoryLocationAdminDto): Promise<unknown> {
    const exists = await this.prisma.inventoryLocation.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException(`Location code "${dto.code}" already exists`);

    return this.prisma.inventoryLocation.create({
      data: {
        name: dto.name,
        code: dto.code,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateLocation(id: string, dto: UpdateInventoryLocationAdminDto): Promise<unknown> {
    await this.ensureLocationExists(id);

    if (dto.code) {
      const conflict = await this.prisma.inventoryLocation.findFirst({
        where: { code: dto.code, NOT: { id } },
      });
      if (conflict) throw new ConflictException(`Location code "${dto.code}" already exists`);
    }

    return this.prisma.inventoryLocation.update({ where: { id }, data: dto });
  }

  async deleteLocation(id: string): Promise<void> {
    await this.ensureLocationExists(id);

    const hasStock = await this.prisma.stockLevel.findFirst({
      where: { locationId: id, onHand: { gt: 0 } },
    });
    if (hasStock) {
      throw new BadRequestException(
        'Cannot delete a location that holds stock — adjust inventory to zero first',
      );
    }

    await this.prisma.inventoryLocation.delete({ where: { id } });
  }

  // ── Admin: Alerts ─────────────────────────────────────────────────────────

  async listAlerts(page: number, pageSize: number): Promise<PaginatedResult<unknown>> {
    const skip = (page - 1) * pageSize;
    const threshold = await this.effectiveLowStockThreshold();

    const [data, total] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: { onHand: { lte: threshold } },
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              product: { select: { id: true, name: true, slug: true } },
            },
          },
          location: { select: { id: true, name: true, code: true } },
        },
        orderBy: { onHand: 'asc' },
        skip,
        take: pageSize,
      }),
      this.prisma.stockLevel.count({ where: { onHand: { lte: threshold } } }),
    ]);

    const alerts = (data as Array<Record<string, unknown>>).map((sl) => ({
      ...sl,
      lowStockThreshold: threshold,
      alertType: (sl.onHand as number) <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
    }));

    return { data: alerts, meta: { page, pageSize, total } };
  }

  // ── Private guards ─────────────────────────────────────────────────────────

  private async ensureVariantExists(variantId: string): Promise<void> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundException(`ProductVariant "${variantId}" not found`);
  }

  private async ensureLocationExists(locationId: string): Promise<void> {
    const loc = await this.prisma.inventoryLocation.findUnique({ where: { id: locationId } });
    if (!loc) throw new NotFoundException(`InventoryLocation "${locationId}" not found`);
  }
}
