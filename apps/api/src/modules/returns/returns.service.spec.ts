import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AdjustmentReason,
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
import {
  IdempotencyKeyConflictException,
  IdempotencyKeyForbiddenException,
} from '../../common/exceptions/idempotency.exception';
import { OrdersService } from '../orders/orders.service';
import { ReturnsService } from './returns.service';
import { RETURN_EVENTS } from './returns.constants';
import { storeMoney } from '@common/money';
import { MoneyFormatterService } from '../currencies/money-formatter.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function dec(n: number) {
  return { toNumber: () => n } as unknown as Prisma.Decimal;
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'ORD-2026-000001',
    userId: 'user-1',
    status: 'DELIVERED',
    currency: 'AED',
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    items: [
      {
        id: 'oi-1',
        orderId: 'order-1',
        variantId: 'variant-1',
        productId: 'product-1',
        productName: { default: 'Widget' },
        sku: 'WDG-001',
        unitPrice: dec(100),
        quantity: 3,
        total: dec(300),
      },
      {
        id: 'oi-2',
        orderId: 'order-1',
        variantId: 'variant-2',
        productId: 'product-1',
        productName: { default: 'Gadget' },
        sku: 'GDG-001',
        unitPrice: dec(50),
        quantity: 2,
        total: dec(100),
      },
    ],
    ...overrides,
  };
}

function makeReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    returnNumber: 'RET-2026-000001',
    orderId: 'order-1',
    customerId: 'user-1',
    status: ReturnStatus.REQUESTED,
    reason: 'DEFECTIVE',
    reasonDetail: null,
    refundMethod: null,
    refundAmount: dec(100),
    adminNotes: null,
    requestedAt: new Date(),
    approvedAt: null,
    receivedAt: null,
    refundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: 'ri-1',
        returnId: 'return-1',
        orderItemId: 'oi-1',
        variantId: 'variant-1',
        quantity: 1,
        restockDecision: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    photos: [],
    order: {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: 'DELIVERED',
      currency: 'AED',
      createdAt: new Date(),
    },
    customer: { id: 'user-1', email: 'user@example.com', firstName: 'Test', lastName: 'User' },
    ...overrides,
  };
}

function makePrisma() {
  return {
    order: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    return: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    returnItem: {
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    asset: {
      count: jest.fn(),
    },
    auditLogEntry: {
      create: jest.fn(),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ value: BigInt(1) }]),
  };
}

function makeInventory() {
  return { incrementStock: jest.fn() };
}

function makeGiftCards() {
  return { issueStoreCredit: jest.fn() };
}

function makeEvents() {
  return { emit: jest.fn() };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return { get: jest.fn((key: string) => overrides[key] ?? undefined) };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

/** The money formatter over the process snapshot, so amounts follow `storeMoney`. */
function moneyFormatterMock() {
  return {
    format: (value: unknown, code?: string | null) => storeMoney.format(value as never, code),
    currencyCode: () => storeMoney.currencyCode(),
    taxLabel: () => storeMoney.taxLabel(),
    config: () => storeMoney.current(),
  };
}

describe('ReturnsService', () => {
  let service: ReturnsService;
  let prisma: ReturnType<typeof makePrisma>;
  let inventory: ReturnType<typeof makeInventory>;
  let giftCards: ReturnType<typeof makeGiftCards>;
  let events: ReturnType<typeof makeEvents>;
  let config: ReturnType<typeof makeConfig>;
  let idempotency: {
    beginRequest: jest.Mock;
    completeRequest: jest.Mock;
    abortRequest: jest.Mock;
    isReplay: jest.Mock;
  };
  /**
   * The order state machine is owned by OrdersService (§3.1 modular isolation).
   * Returns closes an order by asking it, not by writing `Order.status` itself.
   */
  let orders: { updateStatus: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    inventory = makeInventory();
    giftCards = makeGiftCards();
    events = makeEvents();
    config = makeConfig();
    orders = { updateStatus: jest.fn().mockResolvedValue({}) };
    idempotency = {
      beginRequest: jest.fn().mockResolvedValue({ state: 'fresh' }),
      completeRequest: jest.fn().mockResolvedValue(undefined),
      abortRequest: jest.fn().mockResolvedValue(undefined),
      isReplay: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventory },
        { provide: GiftCardsService, useValue: giftCards },
        { provide: EventEmitter2, useValue: events },
        { provide: ConfigService, useValue: config },
        { provide: IdempotencyService, useValue: idempotency },
        { provide: OrdersService, useValue: orders },
        { provide: MoneyFormatterService, useValue: moneyFormatterMock() },
      ],
    }).compile();

    service = module.get(ReturnsService);
  });

  // ── createReturn ────────────────────────────────────────────────────────────

  describe('createReturn', () => {
    const dto = {
      items: [{ orderItemId: 'oi-1', quantity: 1 }],
      reason: 'DEFECTIVE' as const,
    };

    it('creates a return and emits event', async () => {
      const order = makeOrder();
      prisma.order.findUnique.mockResolvedValue(order);
      prisma.return.findFirst.mockResolvedValue(null);
      prisma.return.create.mockResolvedValue(makeReturn());

      const result = await service.createReturn('order-1', dto, 'user-1');

      expect(prisma.return.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-1',
            customerId: 'user-1',
            reason: 'DEFECTIVE',
            refundAmount: 100,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(RETURN_EVENTS.CREATED, expect.any(Object));
      expect(result).toBeDefined();
    });

    it('strips adminNotes from the create response (plan J)', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.return.findFirst.mockResolvedValue(null);
      prisma.return.create.mockResolvedValue(makeReturn({ adminNotes: 'internal' }));

      const result = (await service.createReturn('order-1', dto, 'user-1')) as Record<
        string,
        unknown
      >;

      expect(result).not.toHaveProperty('adminNotes');
    });

    it('throws NotFoundException when order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.createReturn('bad-id', dto, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when order belongs to another user', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder({ userId: 'other-user' }));
      await expect(service.createReturn('order-1', dto, 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when order is not DELIVERED', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder({ status: 'PROCESSING' }));
      await expect(service.createReturn('order-1', dto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when return window has expired', async () => {
      const expiredOrder = makeOrder({
        updatedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
      });
      prisma.order.findUnique.mockResolvedValue(expiredOrder);
      await expect(service.createReturn('order-1', dto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when active return already exists', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.return.findFirst.mockResolvedValue({ id: 'ret-x', returnNumber: 'RET-2026-000099' });
      await expect(service.createReturn('order-1', dto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when item does not belong to order', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.return.findFirst.mockResolvedValue(null);
      const badDto = {
        items: [{ orderItemId: 'oi-999', quantity: 1 }],
        reason: 'DEFECTIVE' as const,
      };
      await expect(service.createReturn('order-1', badDto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when return quantity exceeds ordered quantity', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.return.findFirst.mockResolvedValue(null);
      const badDto = {
        items: [{ orderItemId: 'oi-1', quantity: 99 }],
        reason: 'DEFECTIVE' as const,
      };
      await expect(service.createReturn('order-1', badDto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when a photo asset ID is invalid', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.return.findFirst.mockResolvedValue(null);
      prisma.asset.count.mockResolvedValue(0);
      const dtoWithPhoto = { ...dto, photoAssetIds: ['asset-bad'] };
      await expect(service.createReturn('order-1', dtoWithPhoto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calculates refundAmount correctly', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder());
      prisma.return.findFirst.mockResolvedValue(null);
      const multiDto = {
        items: [
          { orderItemId: 'oi-1', quantity: 2 }, // 2 × 100 = 200
          { orderItemId: 'oi-2', quantity: 1 }, // 1 × 50 = 50
        ],
        reason: 'CHANGED_MIND' as const,
      };
      prisma.return.create.mockImplementation(({ data }: { data: { refundAmount: number } }) => ({
        ...makeReturn(),
        refundAmount: dec(data.refundAmount),
      }));
      await service.createReturn('order-1', multiDto, 'user-1');
      expect(prisma.return.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ refundAmount: 250 }) }),
      );
    });
  });

  // ── approveReturn ───────────────────────────────────────────────────────────

  describe('approveReturn', () => {
    it('transitions REQUESTED → APPROVED and emits event', async () => {
      const ret = makeReturn();
      prisma.return.findUnique.mockResolvedValue(ret);
      prisma.return.update.mockResolvedValue({ ...ret, status: ReturnStatus.APPROVED });
      prisma.auditLogEntry.create.mockResolvedValue({});

      await service.approveReturn('return-1', 'admin-1');

      expect(prisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReturnStatus.APPROVED,
            approvedAt: expect.any(Date),
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(RETURN_EVENTS.APPROVED, expect.any(Object));
    });

    it('throws BadRequestException for invalid transition (REJECTED → APPROVED)', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReturn({ status: ReturnStatus.REJECTED }));
      await expect(service.approveReturn('return-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when return not found', async () => {
      prisma.return.findUnique.mockResolvedValue(null);
      await expect(service.approveReturn('bad-id', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── rejectReturn ────────────────────────────────────────────────────────────

  describe('rejectReturn', () => {
    it('transitions REQUESTED → REJECTED and stores reason', async () => {
      const ret = makeReturn();
      prisma.return.findUnique.mockResolvedValue(ret);
      prisma.return.update.mockResolvedValue({ ...ret, status: ReturnStatus.REJECTED });
      prisma.auditLogEntry.create.mockResolvedValue({});

      await service.rejectReturn('return-1', { reason: 'Item is not defective' }, 'admin-1');

      expect(prisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReturnStatus.REJECTED,
            adminNotes: 'Item is not defective',
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(RETURN_EVENTS.REJECTED, expect.any(Object));
    });
  });

  // ── receiveReturn ───────────────────────────────────────────────────────────

  describe('receiveReturn', () => {
    const approvedReturn = makeReturn({ status: ReturnStatus.APPROVED });

    it('RESTOCK decision calls incrementStock with RETURN_RESTOCK', async () => {
      prisma.return.findUnique.mockResolvedValue(approvedReturn);
      prisma.returnItem.update.mockResolvedValue({});
      prisma.return.update.mockResolvedValue({
        ...approvedReturn,
        status: ReturnStatus.ITEM_RECEIVED,
      });
      prisma.auditLogEntry.create.mockResolvedValue({});
      inventory.incrementStock.mockResolvedValue(undefined);

      await service.receiveReturn(
        'return-1',
        { items: [{ returnItemId: 'ri-1', restockDecision: RestockDecision.RESTOCK }] },
        'admin-1',
      );

      expect(inventory.incrementStock).toHaveBeenCalledWith(
        'variant-1',
        1,
        AdjustmentReason.RETURN_RESTOCK,
        expect.objectContaining({ referenceType: 'Return', referenceId: 'return-1' }),
      );
      expect(events.emit).toHaveBeenCalledWith(RETURN_EVENTS.RECEIVED, expect.any(Object));
    });

    it('DAMAGED decision calls incrementStock with RETURN_DAMAGED', async () => {
      prisma.return.findUnique.mockResolvedValue(approvedReturn);
      prisma.returnItem.update.mockResolvedValue({});
      prisma.return.update.mockResolvedValue({
        ...approvedReturn,
        status: ReturnStatus.ITEM_RECEIVED,
      });
      prisma.auditLogEntry.create.mockResolvedValue({});
      inventory.incrementStock.mockResolvedValue(undefined);

      await service.receiveReturn(
        'return-1',
        { items: [{ returnItemId: 'ri-1', restockDecision: RestockDecision.DAMAGED }] },
        'admin-1',
      );

      expect(inventory.incrementStock).toHaveBeenCalledWith(
        'variant-1',
        1,
        AdjustmentReason.RETURN_DAMAGED,
        expect.any(Object),
      );
    });

    it('DISPOSE decision does NOT call incrementStock', async () => {
      prisma.return.findUnique.mockResolvedValue(approvedReturn);
      prisma.returnItem.update.mockResolvedValue({});
      prisma.return.update.mockResolvedValue({
        ...approvedReturn,
        status: ReturnStatus.ITEM_RECEIVED,
      });
      prisma.auditLogEntry.create.mockResolvedValue({});

      await service.receiveReturn(
        'return-1',
        { items: [{ returnItemId: 'ri-1', restockDecision: RestockDecision.DISPOSE }] },
        'admin-1',
      );

      expect(inventory.incrementStock).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for unknown returnItemId', async () => {
      prisma.return.findUnique.mockResolvedValue(approvedReturn);
      await expect(
        service.receiveReturn(
          'return-1',
          { items: [{ returnItemId: 'ri-999', restockDecision: RestockDecision.RESTOCK }] },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('continues gracefully when incrementStock throws', async () => {
      prisma.return.findUnique.mockResolvedValue(approvedReturn);
      prisma.returnItem.update.mockResolvedValue({});
      prisma.return.update.mockResolvedValue({
        ...approvedReturn,
        status: ReturnStatus.ITEM_RECEIVED,
      });
      prisma.auditLogEntry.create.mockResolvedValue({});
      inventory.incrementStock.mockRejectedValue(new Error('No active location'));

      // Should NOT throw — error is caught and logged
      await expect(
        service.receiveReturn(
          'return-1',
          { items: [{ returnItemId: 'ri-1', restockDecision: RestockDecision.RESTOCK }] },
          'admin-1',
        ),
      ).resolves.not.toThrow();
    });
  });

  // ── processRefund ───────────────────────────────────────────────────────────

  describe('processRefund', () => {
    const receivedReturn = makeReturn({
      status: ReturnStatus.ITEM_RECEIVED,
      refundAmount: dec(100),
    });

    it('issues store credit when refundMethod is STORE_CREDIT', async () => {
      prisma.return.findUnique.mockResolvedValue(receivedReturn);
      prisma.order.findUnique.mockResolvedValue({ currency: 'AED' });
      prisma.return.update.mockResolvedValue({
        ...receivedReturn,
        status: ReturnStatus.REFUND_PROCESSED,
      });
      prisma.auditLogEntry.create.mockResolvedValue({});
      giftCards.issueStoreCredit.mockResolvedValue({ id: 'gc-1', code: 'ABCD1234EFGH5678' });

      await service.processRefund(
        'return-1',
        { refundMethod: ReturnRefundMethod.STORE_CREDIT },
        'admin-1',
        'idem-r1',
      );

      expect(giftCards.issueStoreCredit).toHaveBeenCalledWith('user-1', 100, 'AED');
      // NE5: the minted store-credit code threads into the single return.refunded
      // email (no separate store-credit email — avoids a double-send).
      expect(events.emit).toHaveBeenCalledWith(
        RETURN_EVENTS.REFUNDED,
        expect.objectContaining({ storeCreditCode: 'ABCD1234EFGH5678' }),
      );
      expect(idempotency.completeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'returns-refund', key: 'idem-r1', entityId: 'return-1' }),
      );
    });

    it('stubs original payment refund without calling giftCards', async () => {
      prisma.return.findUnique.mockResolvedValue(receivedReturn);
      prisma.order.findUnique.mockResolvedValue({ currency: 'AED' });
      prisma.return.update.mockResolvedValue({
        ...receivedReturn,
        status: ReturnStatus.REFUND_PROCESSED,
      });
      prisma.auditLogEntry.create.mockResolvedValue({});

      await service.processRefund(
        'return-1',
        { refundMethod: ReturnRefundMethod.ORIGINAL_PAYMENT },
        'admin-1',
        'idem-r2',
      );

      expect(giftCards.issueStoreCredit).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when refund amount is zero', async () => {
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ status: ReturnStatus.ITEM_RECEIVED, refundAmount: dec(0) }),
      );
      await expect(
        service.processRefund(
          'return-1',
          { refundMethod: ReturnRefundMethod.STORE_CREDIT },
          'admin-1',
          'idem-r3',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid transition', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReturn({ status: ReturnStatus.REQUESTED }));
      await expect(
        service.processRefund(
          'return-1',
          { refundMethod: ReturnRefundMethod.STORE_CREDIT },
          'admin-1',
          'idem-r4',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns cached response when IdempotencyService reports cached', async () => {
      const cached = { id: 'return-1', status: 'REFUND_PROCESSED', cached: true };
      idempotency.beginRequest.mockResolvedValue({ state: 'cached', cachedResponse: cached });

      const result = await service.processRefund(
        'return-1',
        { refundMethod: ReturnRefundMethod.STORE_CREDIT },
        'admin-1',
        'idem-cached',
      );

      expect(result).toBe(cached);
      expect(prisma.return.findUnique).not.toHaveBeenCalled();
      expect(giftCards.issueStoreCredit).not.toHaveBeenCalled();
      // NE5: a cached replay must not re-fire the refund / exchange-created events.
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('throws IdempotencyKeyForbiddenException on different-caller replay', async () => {
      idempotency.beginRequest.mockResolvedValue({ state: 'forbidden' });
      await expect(
        service.processRefund(
          'return-1',
          { refundMethod: ReturnRefundMethod.STORE_CREDIT },
          'admin-2',
          'idem-forbidden',
        ),
      ).rejects.toThrow(IdempotencyKeyForbiddenException);
    });

    it('throws IdempotencyKeyConflictException on different-body replay', async () => {
      idempotency.beginRequest.mockResolvedValue({ state: 'conflict' });
      await expect(
        service.processRefund(
          'return-1',
          { refundMethod: ReturnRefundMethod.ORIGINAL_PAYMENT },
          'admin-1',
          'idem-conflict',
        ),
      ).rejects.toThrow(IdempotencyKeyConflictException);
    });
  });

  // ── closeReturn ─────────────────────────────────────────────────────────────

  describe('closeReturn', () => {
    it('transitions REFUND_PROCESSED → CLOSED', async () => {
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ status: ReturnStatus.REFUND_PROCESSED }),
      );
      prisma.return.update.mockResolvedValue(makeReturn({ status: ReturnStatus.CLOSED }));
      prisma.auditLogEntry.create.mockResolvedValue({});

      await service.closeReturn('return-1', 'admin-1');

      expect(prisma.return.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ReturnStatus.CLOSED } }),
      );
      expect(events.emit).toHaveBeenCalledWith(RETURN_EVENTS.CLOSED, expect.any(Object));
    });

    it('moves the order to RETURNED through the orders service, not a bare update', async () => {
      // Plan M phase M2. A bare `prisma.order.update` here wrote no
      // OrderStatusHistory row, so a returned order rendered a timeline ending
      // at DELIVERED while its status read RETURNED. Worse, the backfill's
      // NOT EXISTS guard skips such an order forever, because it already holds
      // a non-PENDING row, so no later deploy repairs it (finding AD6).
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ status: ReturnStatus.REFUND_PROCESSED }),
      );
      prisma.return.update.mockResolvedValue(makeReturn({ status: ReturnStatus.CLOSED }));
      prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.DELIVERED });
      prisma.auditLogEntry.create.mockResolvedValue({});

      await service.closeReturn('return-1', 'admin-1');

      // The returns prisma mock has no `order.update` at all, which is the
      // point: this module has no business writing that column.
      expect(orders.updateStatus).toHaveBeenCalledWith('order-1', OrderStatus.RETURNED, 'admin-1');
    });

    it('leaves an order that never reached DELIVERED alone', async () => {
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ status: ReturnStatus.REFUND_PROCESSED }),
      );
      prisma.return.update.mockResolvedValue(makeReturn({ status: ReturnStatus.CLOSED }));
      prisma.order.findUnique.mockResolvedValue({ status: OrderStatus.CANCELLED });
      prisma.auditLogEntry.create.mockResolvedValue({});

      await service.closeReturn('return-1', 'admin-1');

      expect(orders.updateStatus).not.toHaveBeenCalled();
    });
  });

  // ── findOneStorefront ────────────────────────────────────────────────────────

  describe('findOneStorefront', () => {
    it('returns the return for the owner', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReturn());
      const result = await service.findOneStorefront('return-1', 'user-1');
      expect(result).toBeDefined();
    });

    it('throws ForbiddenException for non-owner', async () => {
      prisma.return.findUnique.mockResolvedValue(makeReturn());
      await expect(service.findOneStorefront('return-1', 'other-user')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when return does not exist', async () => {
      prisma.return.findUnique.mockResolvedValue(null);
      await expect(service.findOneStorefront('bad-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    // `adminNotes` mixes the reject flow's reason with operator processing
    // notes, so it is internal until a dedicated customer field exists
    // (plan J, sweep S3).
    it('strips adminNotes from the owner response', async () => {
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ adminNotes: 'internal: fraud check pending' }),
      );

      const result = (await service.findOneStorefront('return-1', 'user-1')) as Record<
        string,
        unknown
      >;

      expect(result).not.toHaveProperty('adminNotes');
      expect(result['returnNumber']).toBe('RET-2026-000001');
      expect(JSON.stringify(result)).not.toContain('fraud check pending');
    });

    it('keeps adminNotes on the admin read', async () => {
      prisma.return.findUnique.mockResolvedValue(
        makeReturn({ adminNotes: 'internal: fraud check pending' }),
      );

      const result = (await service.findOneAdmin('return-1')) as Record<string, unknown>;

      expect(result['adminNotes']).toBe('internal: fraud check pending');
    });
  });

  // ── listStorefront ───────────────────────────────────────────────────────────

  describe('listStorefront', () => {
    it('returns paginated returns for the customer', async () => {
      prisma.return.findMany.mockResolvedValue([makeReturn()]);
      prisma.return.count.mockResolvedValue(1);

      const result = await service.listStorefront('user-1', {});

      expect(result).toEqual({
        data: expect.any(Array),
        meta: { page: 1, pageSize: 20, total: 1 },
      });
      expect(prisma.return.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: 'user-1' } }),
      );
    });
  });

  // ── listAdmin ────────────────────────────────────────────────────────────────

  describe('listAdmin', () => {
    it('returns paginated returns with status filter', async () => {
      prisma.return.findMany.mockResolvedValue([makeReturn()]);
      prisma.return.count.mockResolvedValue(1);

      const result = await service.listAdmin({ status: ReturnStatus.REQUESTED });

      expect(prisma.return.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: ReturnStatus.REQUESTED }),
        }),
      );
      expect(result.meta.total).toBe(1);
    });

    it('defaults to createdAt desc sort for invalid sortBy', async () => {
      prisma.return.findMany.mockResolvedValue([]);
      prisma.return.count.mockResolvedValue(0);

      await service.listAdmin({ sortBy: 'injectedField', sortOrder: 'asc' });

      expect(prisma.return.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  // ── getAnalytics ─────────────────────────────────────────────────────────────

  describe('getAnalytics', () => {
    it('returns analytics summary', async () => {
      prisma.return.count.mockResolvedValue(10);
      prisma.return.groupBy.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(100);
      prisma.returnItem.groupBy.mockResolvedValue([]);

      const result = (await service.getAnalytics({})) as Record<string, unknown>;

      expect(result.totalReturns).toBe(10);
      expect(result.totalOrders).toBe(100);
      expect(result.returnRate).toBe(10);
    });
  });

  // ── findByAssetId (S18 — DR-07) ─────────────────────────────────────────────

  describe('findByAssetId', () => {
    it('returns returns carrying the asset with composed customer name', async () => {
      prisma.return.findMany.mockResolvedValueOnce([
        {
          id: 'ret-1',
          returnNumber: 'RET-2026-000001',
          customer: { firstName: 'Mariam', lastName: 'Hashim' },
        },
      ]);

      const result = await service.findByAssetId('asset-9');

      expect(result).toEqual([
        { id: 'ret-1', returnNumber: 'RET-2026-000001', customerName: 'Mariam Hashim' },
      ]);
      expect(prisma.return.findMany).toHaveBeenCalledWith({
        where: { photos: { some: { assetId: 'asset-9' } } },
        select: {
          id: true,
          returnNumber: true,
          customer: { select: { firstName: true, lastName: true } },
        },
      });
    });

    it('handles missing customer name fields', async () => {
      prisma.return.findMany.mockResolvedValueOnce([
        {
          id: 'ret-2',
          returnNumber: 'RET-2026-000002',
          customer: { firstName: null, lastName: null },
        },
      ]);
      const result = await service.findByAssetId('asset-1');
      expect(result).toEqual([{ id: 'ret-2', returnNumber: 'RET-2026-000002', customerName: '' }]);
    });

    it('returns empty when no return references the asset', async () => {
      prisma.return.findMany.mockResolvedValueOnce([]);
      const result = await service.findByAssetId('asset-none');
      expect(result).toEqual([]);
    });
  });
});
