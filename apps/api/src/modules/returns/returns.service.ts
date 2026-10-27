// raw-sql-approved: PostgreSQL SEQUENCE generation for return + exchange-order
// numbers per merchants-engine technical spec §9.4 C4 (atomic monotonic
// sequences) — see `apps/api/prisma/migrations/.../sequences.sql`. Reviewed
// by db-safety-auditor on 2026-04-29 during S18 close-out.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AdjustmentReason,
  MovementType,
  OrderStatus,
  Prisma,
  RestockDecision,
  ReturnRefundMethod,
  ReturnStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { OrdersService } from '../orders/orders.service';
import {
  IdempotencyKeyConflictException,
  IdempotencyKeyForbiddenException,
} from '../../common/exceptions/idempotency.exception';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import type { CreateReturnDto } from './dto/create-return.dto';
import type {
  ListReturnsStorefrontDto,
  ListReturnsAdminDto,
  ReturnsAnalyticsQueryDto,
} from './dto/query-returns.dto';
import type { RejectReturnDto } from './dto/reject-return.dto';
import type { ReceiveReturnDto } from './dto/receive-return.dto';
import type { RefundReturnDto } from './dto/refund-return.dto';
import { MoneyFormatterService } from '../currencies/money-formatter.service';
import {
  DEFAULT_RETURN_WINDOW_DAYS,
  RETURN_NUMBER_PREFIX,
  RETURN_STATUS_TRANSITIONS,
  VALID_RETURN_SORT_FIELDS,
  RETURN_EVENTS,
} from './returns.constants';

// ── Prisma include shapes ────────────────────────────────────────────────────

const RETURN_INCLUDE = {
  items: {
    include: {
      orderItem: {
        select: { id: true, sku: true, productName: true, unitPrice: true, quantity: true },
      },
      variant: { select: { id: true, sku: true } },
    },
  },
  // Per asset-variant-serving (AV1) the asset projection carries `status` +
  // `variants` so consumers can resolve the right intent through
  // `tryPickVariantUrl(asset, 'thumbnail')`. `url` retained for backward-compat
  // with existing customer + admin clients — post-AV1 it points at the
  // canonical large-webp variant URL on READY assets.
  photos: {
    include: {
      asset: {
        select: { id: true, url: true, mimeType: true, status: true, variants: true },
      },
    },
  },
  order: { select: { id: true, orderNumber: true, status: true, currency: true, createdAt: true } },
  customer: { select: { id: true, email: true, firstName: true, lastName: true } },
} as const;

const RETURN_LIST_SELECT = {
  id: true,
  returnNumber: true,
  orderId: true,
  customerId: true,
  status: true,
  reason: true,
  reasonDetail: true,
  refundMethod: true,
  refundAmount: true,
  requestedAt: true,
  approvedAt: true,
  receivedAt: true,
  refundedAt: true,
  createdAt: true,
  updatedAt: true,
  order: { select: { orderNumber: true, currency: true } },
  customer: { select: { id: true, email: true, firstName: true, lastName: true } },
  _count: { select: { items: true } },
} as const;

/**
 * Drops `Return.adminNotes` from a customer-facing return (plan J, sweep S3).
 *
 * `RETURN_INCLUDE` is relation-only, so the customer detail and the create
 * response used to hand out the whole row. `adminNotes` is where the reject
 * flow stores its reason and where the refund flow appends operator notes, so
 * it mixes internal processing state with text nobody wrote for a customer.
 * Everything else on the included row is the caller's own data.
 *
 * The customer LIST was already clean: `RETURN_LIST_SELECT` never had the
 * column. Admin methods keep the full include.
 *
 * Surfacing a rejection reason properly needs a dedicated customer-facing
 * column and copy; that is new product work, deliberately not done here.
 */
export function toCustomerReturn<T extends { adminNotes?: unknown }>(
  ret: T,
): Omit<T, 'adminNotes'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { adminNotes, ...customerSafe } = ret;
  return customerSafe;
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly giftCards: GiftCardsService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly idempotency: IdempotencyService,
    /** The order state machine. Returns never writes `Order.status` itself. */
    private readonly orders: OrdersService,
    private readonly money: MoneyFormatterService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE RETURN (§4.9)
  // ═══════════════════════════════════════════════════════════════════════════

  async createReturn(orderId: string, dto: CreateReturnDto, userId: string): Promise<unknown> {
    // ── 1. Load order and verify ownership ───────────────────────────────
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(`Order "${orderId}" not found`);
    if (order.userId !== userId) throw new ForbiddenException('Not your order');

    // ── 2. Order must be DELIVERED ────────────────────────────────────────
    if (order.status !== 'DELIVERED') {
      throw new BadRequestException('Returns can only be requested for delivered orders');
    }

    // ── 3. Return window check ────────────────────────────────────────────
    const windowDays = this.config.get<number>('RETURN_WINDOW_DAYS') ?? DEFAULT_RETURN_WINDOW_DAYS;
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    // H-2: use deliveredAt (set when order transitions to DELIVERED) not updatedAt (§4.9)
    const deliveredAt = order.deliveredAt ?? order.updatedAt;
    if (Date.now() - deliveredAt.getTime() > windowMs) {
      throw new BadRequestException(
        `Return window of ${windowDays} days has closed for this order`,
      );
    }

    // ── 4. No duplicate active return on same order ───────────────────────
    const existing = await this.prisma.return.findFirst({
      where: {
        orderId,
        status: { notIn: [ReturnStatus.REJECTED, ReturnStatus.CLOSED] },
      },
      select: { id: true, returnNumber: true },
    });
    if (existing) {
      throw new BadRequestException(
        `An active return (${existing.returnNumber}) already exists for this order`,
      );
    }

    // ── 5. Validate each line item belongs to the order ───────────────────
    const orderItemMap = new Map(order.items.map((i) => [i.id, i]));
    for (const line of dto.items) {
      const orderItem = orderItemMap.get(line.orderItemId);
      if (!orderItem) {
        throw new BadRequestException(
          `Order item "${line.orderItemId}" does not belong to order "${orderId}"`,
        );
      }
      if (line.quantity > orderItem.quantity) {
        throw new BadRequestException(
          `Return quantity (${line.quantity}) exceeds ordered quantity (${orderItem.quantity}) for item "${line.orderItemId}"`,
        );
      }
      // C-1: EXCHANGE refund method requires exchangeVariantId on every item (§4.9)
      if (dto.refundMethod === ReturnRefundMethod.EXCHANGE && !line.exchangeVariantId) {
        throw new BadRequestException(
          `exchangeVariantId is required for EXCHANGE refund on item "${line.orderItemId}"`,
        );
      }
    }

    // ── 6. Validate photo assets exist ────────────────────────────────────
    if (dto.photoAssetIds?.length) {
      const found = await this.prisma.asset.count({
        where: { id: { in: dto.photoAssetIds } },
      });
      if (found !== dto.photoAssetIds.length) {
        throw new BadRequestException('One or more photo asset IDs are invalid');
      }
    }

    // ── 7. Calculate refund amount ────────────────────────────────────────
    const refundAmount = dto.items.reduce((sum, line) => {
      const orderItem = orderItemMap.get(line.orderItemId)!;
      return sum + toNum(orderItem.unitPrice) * line.quantity;
    }, 0);

    // ── 8. Generate return number ─────────────────────────────────────────
    const returnNumber = await this.generateReturnNumber();

    // ── 9. Persist ────────────────────────────────────────────────────────
    const created = await this.prisma.return.create({
      data: {
        returnNumber,
        orderId,
        customerId: userId,
        reason: dto.reason,
        reasonDetail: dto.reasonDetail ?? null,
        refundMethod: dto.refundMethod ?? null,
        refundAmount,
        items: {
          create: dto.items.map((line) => {
            const orderItem = orderItemMap.get(line.orderItemId)!;
            return {
              orderItemId: line.orderItemId,
              variantId: orderItem.variantId ?? null,
              exchangeVariantId: line.exchangeVariantId ?? null,
              quantity: line.quantity,
            };
          }),
        },
        photos: dto.photoAssetIds?.length
          ? { create: dto.photoAssetIds.map((assetId) => ({ assetId })) }
          : undefined,
      },
      include: RETURN_INCLUDE,
    });

    this.events.emit(RETURN_EVENTS.CREATED, {
      returnId: created.id,
      returnNumber: created.returnNumber,
      orderId,
      userId,
    });

    this.logger.log(
      `createReturn: returnNumber=${returnNumber} orderId=${orderId} userId=${userId}`,
    );
    return toCustomerReturn(created);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STOREFRONT QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  async listStorefront(
    userId: string,
    query: ListReturnsStorefrontDto,
  ): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const where: Prisma.ReturnWhereInput = { customerId: userId };

    const [data, total] = await Promise.all([
      this.prisma.return.findMany({
        where,
        select: RETURN_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total } };
  }

  async findOneStorefront(returnId: string, userId: string): Promise<unknown> {
    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: RETURN_INCLUDE,
    });
    if (!ret) throw new NotFoundException(`Return "${returnId}" not found`);
    if (ret.customerId !== userId) throw new ForbiddenException('Not your return');
    return toCustomerReturn(ret);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  async listAdmin(query: ListReturnsAdminDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = (VALID_RETURN_SORT_FIELDS as readonly string[]).includes(query.sortBy ?? '')
      ? query.sortBy!
      : 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.ReturnWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.reason) where.reason = query.reason;
    if (query.customerId) where.customerId = query.customerId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.return.findMany({
        where,
        select: RETURN_LIST_SELECT,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total } };
  }

  async findOneAdmin(returnId: string): Promise<unknown> {
    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: RETURN_INCLUDE,
    });
    if (!ret) throw new NotFoundException(`Return "${returnId}" not found`);
    return ret;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN ACTIONS — STATUS TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async approveReturn(returnId: string, performedBy: string): Promise<unknown> {
    const ret = await this.loadAndValidateTransition(returnId, ReturnStatus.APPROVED);

    const updated = await this.prisma.return.update({
      where: { id: returnId },
      data: { status: ReturnStatus.APPROVED, approvedAt: new Date() },
      include: RETURN_INCLUDE,
    });

    await this.auditLog(performedBy, 'return.approved', returnId, {
      from: ret.status,
      to: ReturnStatus.APPROVED,
    });

    this.events.emit(RETURN_EVENTS.APPROVED, {
      returnId,
      returnNumber: ret.returnNumber,
      customerId: ret.customerId,
    });

    return updated;
  }

  async rejectReturn(
    returnId: string,
    dto: RejectReturnDto,
    performedBy: string,
  ): Promise<unknown> {
    const ret = await this.loadAndValidateTransition(returnId, ReturnStatus.REJECTED);

    const updated = await this.prisma.return.update({
      where: { id: returnId },
      data: { status: ReturnStatus.REJECTED, adminNotes: dto.reason },
      include: RETURN_INCLUDE,
    });

    await this.auditLog(performedBy, 'return.rejected', returnId, {
      from: ret.status,
      to: ReturnStatus.REJECTED,
      reason: dto.reason,
    });

    this.events.emit(RETURN_EVENTS.REJECTED, {
      returnId,
      returnNumber: ret.returnNumber,
      customerId: ret.customerId,
      reason: dto.reason,
    });

    return updated;
  }

  async receiveReturn(
    returnId: string,
    dto: ReceiveReturnDto,
    performedBy: string,
  ): Promise<unknown> {
    const ret = await this.loadAndValidateTransition(returnId, ReturnStatus.ITEM_RECEIVED);

    // ── Validate all return item IDs belong to this return ────────────────
    const returnItemMap = new Map(ret.items.map((i) => [i.id, i]));
    for (const line of dto.items) {
      if (!returnItemMap.has(line.returnItemId)) {
        throw new BadRequestException(
          `Return item "${line.returnItemId}" does not belong to return "${returnId}"`,
        );
      }
    }

    // ── Update restock decisions and increment stock ───────────────────────
    for (const line of dto.items) {
      const returnItem = returnItemMap.get(line.returnItemId)!;

      await this.prisma.returnItem.update({
        where: { id: line.returnItemId },
        data: {
          restockDecision: line.restockDecision,
          notes: line.notes ?? null,
        },
      });

      // Only increment stock for RESTOCK and DAMAGED (not DISPOSE)
      if (
        returnItem.variantId &&
        (line.restockDecision === RestockDecision.RESTOCK ||
          line.restockDecision === RestockDecision.DAMAGED)
      ) {
        const reason =
          line.restockDecision === RestockDecision.RESTOCK
            ? AdjustmentReason.RETURN_RESTOCK
            : AdjustmentReason.RETURN_DAMAGED;

        try {
          await this.inventory.incrementStock(returnItem.variantId, returnItem.quantity, reason, {
            referenceType: 'Return',
            referenceId: returnId,
            performedBy,
            movementType: MovementType.RETURN,
          });
        } catch (err) {
          this.logger.error(
            `Failed to increment stock for variant=${returnItem.variantId} on receiveReturn=${returnId}: ${(err as Error).message}`,
          );
        }
      }
    }

    const updated = await this.prisma.return.update({
      where: { id: returnId },
      data: { status: ReturnStatus.ITEM_RECEIVED, receivedAt: new Date() },
      include: RETURN_INCLUDE,
    });

    await this.auditLog(performedBy, 'return.received', returnId, {
      from: ret.status,
      to: ReturnStatus.ITEM_RECEIVED,
      items: dto.items,
    });

    this.events.emit(RETURN_EVENTS.RECEIVED, {
      returnId,
      returnNumber: ret.returnNumber,
      customerId: ret.customerId,
    });

    return updated;
  }

  async processRefund(
    returnId: string,
    dto: RefundReturnDto,
    performedBy: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    // ── Idempotency check (§9.5 I1) — atomic SET NX with admin + body binding ─
    const callerHash = IdempotencyService.sha256Hex(performedBy);
    const bodyHash = IdempotencyService.sha256Hex(
      IdempotencyService.stableStringify({ returnId, ...dto }),
    );
    const idempotencyArgs = {
      scope: 'returns-refund',
      key: idempotencyKey,
      callerHash,
      bodyHash,
    };
    const begin = await this.idempotency.beginRequest(idempotencyArgs);
    switch (begin.state) {
      case 'cached':
        return begin.cachedResponse;
      case 'forbidden':
        throw new IdempotencyKeyForbiddenException();
      case 'conflict':
        throw new IdempotencyKeyConflictException();
      case 'in-flight':
        // Reuse the orders shape — same wire contract across all
        // sensitive writes: 409 + IDEMPOTENCY_KEY_CONFLICT (the body
        // hash matches, the cache value just has not been written yet).
        throw new IdempotencyKeyConflictException();
      case 'fresh':
        break;
    }

    try {
      const ret = await this.loadAndValidateTransition(returnId, ReturnStatus.REFUND_PROCESSED);

      const refundMethod = dto.refundMethod ?? ret.refundMethod;
      if (!refundMethod) {
        throw new BadRequestException('Refund method is required');
      }

      const refundAmount = toNum(ret.refundAmount ?? 0);
      if (refundAmount <= 0) {
        throw new BadRequestException('Refund amount must be greater than zero');
      }

      const order = await this.prisma.order.findUnique({
        where: { id: ret.orderId },
        select: { currency: true },
      });
      const currency = order?.currency ?? this.money.currencyCode();

      let storeCreditCode: string | undefined;
      if (refundMethod === ReturnRefundMethod.STORE_CREDIT) {
        // Capture the minted code so the single return.refunded email can carry
        // it — issueStoreCredit deliberately emits no event of its own, so the
        // customer is told the code once (no duplicate store-credit email).
        const storeCreditCard = await this.giftCards.issueStoreCredit(
          ret.customerId,
          refundAmount,
          currency,
        );
        storeCreditCode = storeCreditCard.code;
      } else if (refundMethod === ReturnRefundMethod.EXCHANGE) {
        // C-1: Create exchange order for the requested replacement variants (§4.9)
        await this.createExchangeOrder(ret, currency, performedBy);
      } else {
        // ORIGINAL_PAYMENT — stub (payment provider not yet implemented)
        this.logger.log(
          `processRefund: original-payment stub for returnId=${returnId} amount=${refundAmount} ${currency}`,
        );
      }

      const updateData: Prisma.ReturnUpdateInput = {
        status: ReturnStatus.REFUND_PROCESSED,
        refundedAt: new Date(),
        refundMethod,
      };
      if (dto.notes) updateData.adminNotes = dto.notes;

      const updated = await this.prisma.return.update({
        where: { id: returnId },
        data: updateData,
        include: RETURN_INCLUDE,
      });

      await this.auditLog(performedBy, 'return.refunded', returnId, {
        from: ret.status,
        to: ReturnStatus.REFUND_PROCESSED,
        refundMethod,
        refundAmount,
        currency,
      });

      this.events.emit(RETURN_EVENTS.REFUNDED, {
        returnId,
        returnNumber: ret.returnNumber,
        customerId: ret.customerId,
        refundMethod,
        refundAmount,
        currency,
        ...(storeCreditCode ? { storeCreditCode } : {}),
      });

      await this.idempotency.completeRequest({
        ...idempotencyArgs,
        entityId: returnId,
        responseJson: updated,
      });

      return updated;
    } catch (err) {
      // Release the in-flight sentinel so the client can retry — otherwise
      // the 24h TTL would block legitimate retries with the same key + body.
      await this.idempotency.abortRequest({
        scope: idempotencyArgs.scope,
        key: idempotencyKey,
        callerHash,
      });
      throw err;
    }
  }

  async closeReturn(returnId: string, performedBy: string): Promise<unknown> {
    const ret = await this.loadAndValidateTransition(returnId, ReturnStatus.CLOSED);

    const updated = await this.prisma.return.update({
      where: { id: returnId },
      data: { status: ReturnStatus.CLOSED },
      include: RETURN_INCLUDE,
    });

    // H-1: Transition order to RETURNED (terminal state per spec §4.8) when return is closed.
    //
    // Through `OrdersService`, not a bare `prisma.order.update`. The order state
    // machine belongs to that module (§3.1), and only it writes the
    // `OrderStatusHistory` row: a bare update left a returned order rendering a
    // timeline that ended at DELIVERED while its status read RETURNED, and the
    // backfill could never repair it because such an order already holds a
    // non-PENDING row and the idempotency guard skips it forever (finding AD6).
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: ret.orderId },
        select: { status: true },
      });
      if (order?.status === OrderStatus.DELIVERED) {
        await this.orders.updateStatus(ret.orderId, OrderStatus.RETURNED, performedBy);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to transition order ${ret.orderId} to RETURNED: ${(err as Error).message}`,
      );
    }

    await this.auditLog(performedBy, 'return.closed', returnId, {
      from: ret.status,
      to: ReturnStatus.CLOSED,
    });

    this.events.emit(RETURN_EVENTS.CLOSED, {
      returnId,
      returnNumber: ret.returnNumber,
      customerId: ret.customerId,
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYTICS (§4.9)
  // ═══════════════════════════════════════════════════════════════════════════

  async getAnalytics(query: ReturnsAnalyticsQueryDto): Promise<unknown> {
    const returnWhere: Prisma.ReturnWhereInput = {};
    const orderWhere: Prisma.OrderWhereInput = {};

    if (query.dateFrom || query.dateTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.dateFrom) dateFilter.gte = new Date(query.dateFrom);
      if (query.dateTo) dateFilter.lte = new Date(query.dateTo);
      returnWhere.createdAt = dateFilter;
      orderWhere.createdAt = dateFilter;
    }

    const [totalReturns, byStatus, byReason, refundsByMethod, totalOrders, topVariants] =
      await Promise.all([
        this.prisma.return.count({ where: returnWhere }),
        this.prisma.return.groupBy({
          by: ['status'],
          _count: { id: true },
          where: returnWhere,
        }),
        this.prisma.return.groupBy({
          by: ['reason'],
          _count: { id: true },
          where: returnWhere,
          orderBy: { _count: { id: 'desc' } },
        }),
        this.prisma.return.groupBy({
          by: ['refundMethod'],
          _count: { id: true },
          where: { ...returnWhere, refundMethod: { not: null } },
        }),
        this.prisma.order.count({ where: orderWhere }),
        this.prisma.returnItem.groupBy({
          by: ['variantId'],
          _sum: { quantity: true },
          where: { variantId: { not: null } },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 10,
        }),
      ]);

    return {
      totalReturns,
      totalOrders,
      returnRate: totalOrders > 0 ? Number(((totalReturns / totalOrders) * 100).toFixed(2)) : 0,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id })),
      byReason: byReason.map((r) => ({ reason: r.reason, count: r._count.id })),
      refundsByMethod: refundsByMethod.map((r) => ({
        method: r.refundMethod,
        count: r._count.id,
      })),
      topReturnedVariants: topVariants.map((v) => ({
        variantId: v.variantId,
        totalQuantityReturned: v._sum.quantity ?? 0,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Creates an exchange order for each return item's `exchangeVariantId`.
   * Called from `processRefund()` when refundMethod === EXCHANGE (§4.9 C-1).
   *
   * The exchange order copies the original order's address snapshots and
   * starts in PENDING status for admin fulfillment. Stock is reserved immediately.
   */
  private async createExchangeOrder(
    ret: {
      id: string;
      orderId: string;
      customerId: string;
      returnNumber: string;
      items: Array<{ exchangeVariantId?: string | null; quantity: number }>;
    },
    currency: string,
    performedBy: string,
  ): Promise<void> {
    // 1. Load original order address snapshots
    const originalOrder = await this.prisma.order.findUnique({
      where: { id: ret.orderId },
      select: { userId: true, shippingAddress: true, billingAddress: true },
    });
    if (!originalOrder) throw new NotFoundException(`Order "${ret.orderId}" not found`);

    // 2. Collect exchange lines (must all have exchangeVariantId)
    const exchangeLines = (
      ret.items as Array<{ exchangeVariantId?: string | null; quantity: number }>
    ).filter((i): i is { exchangeVariantId: string; quantity: number } => !!i.exchangeVariantId);
    if (!exchangeLines.length) {
      throw new BadRequestException('No exchange variants specified for EXCHANGE refund');
    }

    // 3. Load variant details (price, sku, product name)
    const variantIds = exchangeLines.map((l) => l.exchangeVariantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, deletedAt: null },
      select: {
        id: true,
        sku: true,
        price: true,
        weight: true,
        productId: true,
        product: { select: { name: true } },
      },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    for (const vId of variantIds) {
      if (!variantMap.has(vId)) {
        throw new BadRequestException(`Exchange variant "${vId}" not found or unavailable`);
      }
    }

    // 4. Build order items
    const orderItems = exchangeLines.map((line) => {
      const v = variantMap.get(line.exchangeVariantId)!;
      const unitPrice = toNum(v.price);
      return {
        variantId: v.id,
        productId: v.productId,
        productName: v.product.name as Prisma.InputJsonValue,
        sku: v.sku,
        unitPrice,
        quantity: line.quantity,
        total: unitPrice * line.quantity,
        weight: v.weight ?? undefined,
      };
    });

    const subtotal = orderItems.reduce((s, i) => s + i.total, 0);

    // 5. Generate exchange order number
    const year = new Date().getFullYear();
    const seq = await this.nextSequenceValue('exchange_order');
    const orderNumber = `EXC-${year}-${String(seq).padStart(6, '0')}`;

    // 6. Persist exchange order
    const exchangeOrder = await this.prisma.order.create({
      data: {
        orderNumber,
        userId: originalOrder.userId,
        shippingAddress: originalOrder.shippingAddress as Prisma.InputJsonValue,
        billingAddress: originalOrder.billingAddress as Prisma.InputJsonValue,
        subtotal,
        discountAmount: 0,
        shippingAmount: 0,
        taxAmount: 0,
        total: subtotal,
        currency,
        notes: `Exchange order for return ${ret.returnNumber}`,
        items: {
          create: orderItems.map((item) => ({
            variantId: item.variantId,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            discountAmount: 0,
            taxAmount: 0,
            total: item.total,
            ...(item.weight !== undefined && { weight: item.weight }),
          })),
        },
      },
      select: { id: true, orderNumber: true },
    });

    // 7. Reserve stock for each exchange variant
    for (const line of exchangeLines) {
      const reserved = await this.inventory.decrementStock(line.exchangeVariantId, line.quantity, {
        referenceType: 'Order',
        referenceId: exchangeOrder.id,
        performedBy,
      });
      if (!reserved) {
        this.logger.warn(
          `Insufficient stock for exchange variant=${line.exchangeVariantId} on return=${ret.id}`,
        );
      }
    }

    await this.auditLog(performedBy, 'return.exchange_order_created', ret.id, {
      exchangeOrderId: exchangeOrder.id,
      exchangeOrderNumber: exchangeOrder.orderNumber,
    });

    // NE5: confirm the EXC- order to the customer. The dispatch resolver loads
    // the order by `orderId`, so the payload mirrors an order event.
    this.events.emit(RETURN_EVENTS.EXCHANGE_CREATED, {
      orderId: exchangeOrder.id,
      orderNumber: exchangeOrder.orderNumber,
      returnNumber: ret.returnNumber,
    });

    this.logger.log(
      `createExchangeOrder: returnId=${ret.id} exchangeOrderNumber=${exchangeOrder.orderNumber}`,
    );
  }

  /**
   * Loads a return and validates that the target status transition is allowed.
   * Returns the full return record (with items) for the caller to use.
   */
  private async loadAndValidateTransition(returnId: string, targetStatus: ReturnStatus) {
    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: { items: true },
    });
    if (!ret) throw new NotFoundException(`Return "${returnId}" not found`);

    const allowed = RETURN_STATUS_TRANSITIONS[ret.status];
    if (!allowed.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot transition return from ${ret.status} to ${targetStatus}`,
      );
    }

    return ret;
  }

  /**
   * Atomically fetches the next value from a year-partitioned PostgreSQL SEQUENCE.
   *
   * Sanctioned $executeRawUnsafe / $queryRawUnsafe: atomic sequence generation (§9.4 C4).
   * The sequence name is derived from hardcoded prefix + current year — no injection risk.
   */
  private async nextSequenceValue(name: string): Promise<number> {
    const year = new Date().getFullYear();
    const seqName = `${name}_seq_${year}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.prisma as any).$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS "${seqName}" START WITH 1 INCREMENT BY 1`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: { value: bigint }[] = await (this.prisma as any).$queryRawUnsafe(
      `SELECT nextval('"${seqName}"') AS value`,
    );

    return Number(result[0].value);
  }

  private async generateReturnNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const seq = await this.nextSequenceValue('return');
    return `${RETURN_NUMBER_PREFIX}-${year}-${String(seq).padStart(6, '0')}`;
  }

  private async auditLog(
    userId: string,
    action: string,
    entityId: string,
    changes: unknown,
  ): Promise<void> {
    try {
      await this.prisma.auditLogEntry.create({
        data: {
          userId,
          action,
          entityType: 'Return',
          entityId,
          changes: changes as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(`Audit log failed: ${(err as Error).message}`);
    }
  }

  // ── Asset references (S18 — DR-07) ────────────────────────────────────────
  /**
   * Returns returns that have the given asset attached as a photo.
   * Used by `AssetsService.getReferences()` to surface where an asset is in
   * use before allowing hard-delete (DR-07). Modular-isolation gate per
   * constitution §3.1 — never queried directly by other modules.
   */
  async findByAssetId(
    assetId: string,
  ): Promise<Array<{ id: string; returnNumber: string; customerName: string }>> {
    const rows = await this.prisma.return.findMany({
      where: { photos: { some: { assetId } } },
      select: {
        id: true,
        returnNumber: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      returnNumber: r.returnNumber,
      customerName: [r.customer?.firstName, r.customer?.lastName].filter(Boolean).join(' ').trim(),
    }));
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function toNum(value: { toNumber(): number } | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'object' ? value.toNumber() : value;
}
