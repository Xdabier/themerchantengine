import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { AdjustmentReason, MovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { InventoryStockConflictException } from './inventory-stock-conflict.exception';
import { InventorySetBelowReservedException } from './inventory-set-below-reserved.exception';
import { InventoryAdjustModeException } from './inventory-adjust-mode.exception';
import { SettingsService } from '../settings/settings.service';
import { InventoryService } from './inventory.service';
import { LOW_STOCK_THRESHOLD } from './inventory.constants';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeLocation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'loc-1',
    name: 'Main Warehouse',
    code: 'WH-MAIN',
    address: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStockLevel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sl-1',
    variantId: 'var-1',
    locationId: 'loc-1',
    onHand: 50,
    reserved: 5,
    updatedAt: new Date(),
    location: { name: 'Main Warehouse' },
    ...overrides,
  };
}

function makeMovement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mv-1',
    variantId: 'var-1',
    locationId: 'loc-1',
    type: MovementType.SALE,
    quantity: -10,
    reason: null,
    referenceType: null,
    referenceId: null,
    performedBy: null,
    notes: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Prisma mock ───────────────────────────────────────────────────────────────

function makePrismaMock() {
  return {
    stockLevel: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    inventoryLocation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    inventoryMovement: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $executeRaw: jest.fn() as any,
    $transaction: jest.fn(),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let events: { emit: jest.Mock };
  let settings: { get: jest.Mock };
  let idempotency: {
    beginRequest: jest.Mock;
    completeRequest: jest.Mock;
    abortRequest: jest.Mock;
    isReplay: jest.Mock;
  };

  beforeEach(async () => {
    prisma = makePrismaMock();
    events = { emit: jest.fn() };
    settings = { get: jest.fn().mockResolvedValue(5) };
    idempotency = {
      beginRequest: jest.fn().mockResolvedValue({ state: 'fresh' }),
      completeRequest: jest.fn().mockResolvedValue(undefined),
      abortRequest: jest.fn().mockResolvedValue(undefined),
      isReplay: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
        { provide: IdempotencyService, useValue: idempotency },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  // ── checkAvailability ──────────────────────────────────────────────────────

  describe('checkAvailability', () => {
    it('sums available across all active locations', async () => {
      prisma.stockLevel.findMany.mockResolvedValue([
        makeStockLevel({
          onHand: 50,
          reserved: 5,
          locationId: 'loc-1',
          location: { name: 'WH-A' },
        }),
        makeStockLevel({
          id: 'sl-2',
          onHand: 20,
          reserved: 0,
          locationId: 'loc-2',
          location: { name: 'WH-B' },
        }),
      ]);

      const result = await service.checkAvailability('var-1');

      expect(result.available).toBe(65); // (50-5) + (20-0)
      expect(result.locations).toHaveLength(2);
      expect(result.locations[0].available).toBe(45);
      expect(result.locations[1].available).toBe(20);
    });

    it('returns 0 available when no stock levels exist', async () => {
      prisma.stockLevel.findMany.mockResolvedValue([]);
      const result = await service.checkAvailability('var-1');
      expect(result.available).toBe(0);
      expect(result.locations).toHaveLength(0);
    });
  });

  // ── decrementStock ─────────────────────────────────────────────────────────

  describe('decrementStock', () => {
    it('returns false when no stock level exists for variant', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(null);
      const result = await service.decrementStock('var-1', 10);
      expect(result).toBe(false);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('returns false when atomic UPDATE affects 0 rows (insufficient stock)', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel());
      prisma.$executeRaw.mockResolvedValue(0);
      const result = await service.decrementStock('var-1', 100);
      expect(result).toBe(false);
      expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('returns true and logs SALE movement when UPDATE succeeds', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel());
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());

      const result = await service.decrementStock('var-1', 10, {
        referenceType: 'ORDER',
        referenceId: 'ord-1',
        performedBy: 'user-1',
      });

      expect(result).toBe(true);
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: MovementType.SALE,
            quantity: -10,
            referenceType: 'ORDER',
            referenceId: 'ord-1',
          }),
        }),
      );
    });

    it('uses provided locationId without querying for best location', async () => {
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());
      prisma.stockLevel.findMany.mockResolvedValue([]);

      await service.decrementStock('var-1', 5, { locationId: 'loc-explicit' });

      expect(prisma.stockLevel.findFirst).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const rawCall = (prisma.$executeRaw as jest.Mock).mock.calls[0];
      // Template literal tag — first arg is the TemplateStringsArray
      expect(rawCall).toBeDefined();
    });

    it('emits inventory.out_of_stock when total onHand reaches zero after decrement', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel());
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());
      prisma.stockLevel.findMany.mockResolvedValue([
        { ...makeStockLevel({ onHand: 0 }), variant: { sku: 'SKU-1' } },
      ]);

      await service.decrementStock('var-1', 10);

      expect(events.emit).toHaveBeenCalledWith('inventory.out_of_stock', {
        variantId: 'var-1',
        sku: 'SKU-1',
        quantity: 0,
      });
    });

    it('emits inventory.low_stock when remaining onHand is at or below threshold', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel());
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());
      prisma.stockLevel.findMany.mockResolvedValue([
        { ...makeStockLevel({ onHand: 5 }), variant: { sku: 'SKU-LOW' } },
      ]);

      await service.decrementStock('var-1', 10);

      expect(events.emit).toHaveBeenCalledWith('inventory.low_stock', {
        variantId: 'var-1',
        sku: 'SKU-LOW',
        quantity: 5,
      });
    });

    it('does not emit alerts when stock stays above the threshold', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel());
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());
      prisma.stockLevel.findMany.mockResolvedValue([
        { ...makeStockLevel({ onHand: 25 }), variant: { sku: 'SKU-OK' } },
      ]);

      await service.decrementStock('var-1', 5);

      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  // ── incrementStock ─────────────────────────────────────────────────────────

  describe('incrementStock', () => {
    it('upserts stock level and logs ADJUSTMENT movement', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel());
      prisma.stockLevel.upsert.mockResolvedValue(makeStockLevel({ onHand: 60 }));
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());

      await service.incrementStock('var-1', 10, AdjustmentReason.RECEIVED);

      expect(prisma.stockLevel.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { onHand: { increment: 10 } },
        }),
      );
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: MovementType.ADJUSTMENT,
            quantity: 10,
            reason: AdjustmentReason.RECEIVED,
          }),
        }),
      );
    });

    it('throws NotFoundException when no active location exists and no locationId given', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(null);
      prisma.inventoryLocation.findFirst.mockResolvedValue(null);

      await expect(service.incrementStock('var-1', 10, AdjustmentReason.RECEIVED)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates stock level at fallback active location when variant has no existing levels', async () => {
      prisma.stockLevel.findFirst.mockResolvedValue(null);
      prisma.inventoryLocation.findFirst.mockResolvedValue(makeLocation());
      prisma.stockLevel.upsert.mockResolvedValue(makeStockLevel());
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());

      await service.incrementStock('var-1', 20, AdjustmentReason.RECEIVED);

      expect(prisma.stockLevel.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ locationId: 'loc-1', onHand: 20, reserved: 0 }),
        }),
      );
    });
  });

  // ── emitRestockIfCrossed (NE8 inventory.restocked) ───────────────────────────

  describe('inventory.restocked crossing (NE8)', () => {
    const RESTOCKED = 'inventory.restocked';

    it('incrementStock emits inventory.restocked when the variant total crosses 0 -> positive', async () => {
      // prevTotal across active locations = 0 (out of stock before the receipt)
      prisma.stockLevel.findMany.mockResolvedValue([{ onHand: 0 }]);
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel({ onHand: 0 }));
      prisma.stockLevel.upsert.mockResolvedValue(makeStockLevel({ onHand: 8 }));
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());
      prisma.productVariant.findUnique.mockResolvedValue({ sku: 'SKU-1', productId: 'prod-1' });

      await service.incrementStock('var-1', 8, AdjustmentReason.RECEIVED);

      expect(events.emit).toHaveBeenCalledWith(RESTOCKED, {
        variantId: 'var-1',
        productId: 'prod-1',
        sku: 'SKU-1',
        quantity: 8,
      });
    });

    it('incrementStock does NOT emit inventory.restocked when stock was already positive', async () => {
      prisma.stockLevel.findMany.mockResolvedValue([{ onHand: 5 }]);
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel({ onHand: 5 }));
      prisma.stockLevel.upsert.mockResolvedValue(makeStockLevel({ onHand: 15 }));
      prisma.inventoryMovement.create.mockResolvedValue(makeMovement());

      await service.incrementStock('var-1', 10, AdjustmentReason.RECEIVED);

      expect(events.emit).not.toHaveBeenCalledWith(RESTOCKED, expect.anything());
      // No variant lookup on the non-crossing path.
      expect(prisma.productVariant.findUnique).not.toHaveBeenCalled();
    });

    it('adjustInventory emits inventory.restocked when a positive adjustment crosses 0 -> positive', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'var-1',
        sku: 'SKU-1',
        productId: 'prod-1',
      });
      prisma.inventoryLocation.findUnique.mockResolvedValue(makeLocation());
      prisma.stockLevel.findMany.mockResolvedValue([{ onHand: 0 }]); // prevTotal = 0
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 0 })),
            upsert: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 12 })),
          },
          inventoryMovement: { create: jest.fn().mockResolvedValue(makeMovement()) },
        };
        return fn(tx);
      });

      await service.adjustInventory(
        {
          variantId: 'var-1',
          locationId: 'loc-1',
          quantity: 12,
          reason: AdjustmentReason.RECEIVED,
        },
        'admin-1',
        'idem-restock-1',
      );

      expect(events.emit).toHaveBeenCalledWith(RESTOCKED, {
        variantId: 'var-1',
        productId: 'prod-1',
        sku: 'SKU-1',
        quantity: 12,
      });
    });

    it('adjustInventory does NOT emit inventory.restocked when stock stays positive', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 'var-1' });
      prisma.inventoryLocation.findUnique.mockResolvedValue(makeLocation());
      prisma.stockLevel.findMany.mockResolvedValue([{ onHand: 10 }]); // prevTotal = 10
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 10 })),
            upsert: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 15 })),
          },
          inventoryMovement: { create: jest.fn().mockResolvedValue(makeMovement()) },
        };
        return fn(tx);
      });

      await service.adjustInventory(
        { variantId: 'var-1', locationId: 'loc-1', quantity: 5, reason: AdjustmentReason.RECOUNT },
        'admin-1',
        'idem-restock-2',
      );

      expect(events.emit).not.toHaveBeenCalledWith(RESTOCKED, expect.anything());
    });
  });

  describe('getVariantStockDetail', () => {
    /**
     * The whole reason this exists beside `getVariantStock`: the bare array
     * could not name the product when a variant had no rows, which is exactly
     * when an operator is looking for it.
     */
    it('returns the variant and its product even with no stock rows', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'var-1',
        sku: 'SKU-1',
        product: { id: 'prod-1', name: { default: 'Brosse' }, slug: 'brosse' },
      });
      prisma.stockLevel.findMany.mockResolvedValue([]);

      const res = (await service.getVariantStockDetail('var-1')) as {
        variant: { product: { id: string } };
        levels: unknown[];
      };

      // Unwrapped: the global interceptor supplies the `{ data: ... }` envelope,
      // and wrapping here too produces `{"data":{"data":…}}`.
      expect(res).not.toHaveProperty('data');
      expect(res.variant.product.id).toBe('prod-1');
      expect(res.levels).toEqual([]);
    });

    it('computes available per row', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'var-1',
        sku: 'SKU-1',
        product: { id: 'prod-1', name: { default: 'Brosse' }, slug: 'brosse' },
      });
      prisma.stockLevel.findMany.mockResolvedValue([
        makeStockLevel({ onHand: 12, reserved: 2, location: { id: 'loc-1' } }),
      ]);

      const res = (await service.getVariantStockDetail('var-1')) as {
        levels: Array<{ available: number }>;
      };

      expect(res.levels[0].available).toBe(10);
    });
  });

  // ── adjustInventory ────────────────────────────────────────────────────────

  describe('adjustInventory', () => {
    beforeEach(() => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 'var-1' });
      prisma.inventoryLocation.findUnique.mockResolvedValue(makeLocation());
    });

    it('rejects negative adjustment that would drive onHand below zero', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 5 })),
            upsert: jest.fn(),
          },
          inventoryMovement: { create: jest.fn() },
          // The guard is now the WHERE clause, not a JavaScript comparison, so
          // the refusal arrives as zero rows affected. Two concurrent negative
          // adjustments could both pass the old read-then-compare.
          $executeRaw: jest.fn().mockResolvedValue(0),
        };
        return fn(tx);
      });

      await expect(
        service.adjustInventory(
          {
            variantId: 'var-1',
            locationId: 'loc-1',
            quantity: -10,
            reason: AdjustmentReason.DAMAGE,
          },
          'admin-1',
          'idem-i1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    describe('set-to mode', () => {
      function txWith(overrides: Record<string, unknown> = {}) {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 20, reserved: 0 })),
            upsert: jest.fn(),
            create: jest.fn(),
          },
          inventoryMovement: { create: jest.fn() },
          $queryRaw: jest.fn().mockResolvedValue([{ onHand: 25 }]),
          $executeRaw: jest.fn().mockResolvedValue(1),
          ...overrides,
        };
        prisma.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
          fn(tx),
        );
        return tx;
      }

      it('applies the target and records the DELTA on the ledger, not the target', async () => {
        const tx = txWith();

        await service.adjustInventory(
          {
            variantId: 'var-1',
            locationId: 'loc-1',
            setTo: 25,
            expectedOnHand: 20,
            reason: AdjustmentReason.RECOUNT,
          },
          'admin-1',
          'idem-set-1',
        );

        expect(tx.$queryRaw).toHaveBeenCalled();
        // 25 over a previous 20 is +5. Writing 25 would corrupt an append-only
        // ledger of signed changes.
        expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ quantity: 5 }) }),
        );
      });

      it('a losing compare-and-set is a 409 carrying what is actually there', async () => {
        txWith({
          $queryRaw: jest.fn().mockResolvedValue([]),
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 31, reserved: 0 })),
            upsert: jest.fn(),
            create: jest.fn(),
          },
        });

        const err = await service
          .adjustInventory(
            {
              variantId: 'var-1',
              locationId: 'loc-1',
              setTo: 25,
              expectedOnHand: 20,
              reason: AdjustmentReason.RECOUNT,
            },
            'admin-1',
            'idem-set-2',
          )
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(InventoryStockConflictException);
        expect((err as { getResponse: () => unknown }).getResponse()).toMatchObject({
          error: { code: 'INVENTORY_STOCK_CONFLICT', details: { currentOnHand: 31 } },
        });
      });

      it('creates the first row when the operator expected none', async () => {
        const tx = txWith({
          $queryRaw: jest.fn().mockResolvedValue([]),
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn(),
            create: jest.fn(),
          },
        });

        await service.adjustInventory(
          {
            variantId: 'var-1',
            locationId: 'loc-1',
            setTo: 12,
            expectedOnHand: 0,
            reason: AdjustmentReason.RECOUNT,
          },
          'admin-1',
          'idem-set-3',
        );

        expect(tx.stockLevel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ onHand: 12, reserved: 0 }),
          }),
        );
        expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ quantity: 12 }) }),
        );
      });

      it('expecting a number when no row exists is still a conflict, not a create', async () => {
        const tx = txWith({
          $queryRaw: jest.fn().mockResolvedValue([]),
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn(),
            create: jest.fn(),
          },
        });

        await expect(
          service.adjustInventory(
            {
              variantId: 'var-1',
              locationId: 'loc-1',
              setTo: 12,
              expectedOnHand: 7,
              reason: AdjustmentReason.RECOUNT,
            },
            'admin-1',
            'idem-set-4',
          ),
        ).rejects.toBeInstanceOf(InventoryStockConflictException);
        expect(tx.stockLevel.create).not.toHaveBeenCalled();
      });

      it('refuses a target below what is already reserved', async () => {
        txWith({
          $queryRaw: jest.fn().mockResolvedValue([]),
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 20, reserved: 8 })),
            upsert: jest.fn(),
            create: jest.fn(),
          },
        });

        await expect(
          service.adjustInventory(
            {
              variantId: 'var-1',
              locationId: 'loc-1',
              setTo: 3,
              expectedOnHand: 20,
              reason: AdjustmentReason.RECOUNT,
            },
            'admin-1',
            'idem-set-5',
          ),
        ).rejects.toBeInstanceOf(InventorySetBelowReservedException);
      });

      /**
       * The restock event drives the back-in-stock mail. It used to be computed
       * as `prevTotal + dto.quantity`, which is NaN in set-to mode, so the
       * crossing test silently never fired.
       */
      it('emits restocked when a set-to lifts a zeroed variant', async () => {
        txWith({ $queryRaw: jest.fn().mockResolvedValue([{ onHand: 9 }]) });
        prisma.stockLevel.findMany.mockResolvedValue([]);

        await service.adjustInventory(
          {
            variantId: 'var-1',
            locationId: 'loc-1',
            setTo: 9,
            expectedOnHand: 0,
            reason: AdjustmentReason.RECOUNT,
          },
          'admin-1',
          'idem-set-6',
        );

        expect(events.emit).toHaveBeenCalledWith('inventory.restocked', expect.anything());
      });

      /**
       * These two assert the SQL TEXT, which is unusual and deliberate.
       *
       * The WHERE clause is the entire §3.4 correctness mechanism: it is what
       * makes the database refuse a losing write instead of a stale read
       * allowing it. A unit test mocks the tagged template, so it can never
       * observe whether the predicate is present by running it. Deleting the
       * guard therefore left every behavioural test in this file green, which
       * is a guard unable to fail. Pinning the text is the cheapest thing that
       * actually notices. The behaviour itself is proven against a real
       * database by the inventory e2e suite.
       */
      it('the negative-delta statement carries the underflow guard', async () => {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 20 })),
            upsert: jest.fn(),
            create: jest.fn(),
          },
          inventoryMovement: { create: jest.fn() },
          $executeRaw: jest.fn().mockResolvedValue(1),
        };
        prisma.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
          fn(tx),
        );

        await service.adjustInventory(
          {
            variantId: 'var-1',
            locationId: 'loc-1',
            quantity: -3,
            reason: AdjustmentReason.DAMAGE,
          },
          'admin-1',
          'idem-sql-1',
        );

        const sql = (tx.$executeRaw.mock.calls[0][0] as string[]).join('?');
        expect(sql).toContain('"onHand" +');
        expect(sql).toContain('>= 0');
      });

      it('the set-to statement compares the expected value and the reserved floor', async () => {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 20 })),
            upsert: jest.fn(),
            create: jest.fn(),
          },
          inventoryMovement: { create: jest.fn() },
          $queryRaw: jest.fn().mockResolvedValue([{ onHand: 25 }]),
        };
        prisma.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
          fn(tx),
        );

        await service.adjustInventory(
          {
            variantId: 'var-1',
            locationId: 'loc-1',
            setTo: 25,
            expectedOnHand: 20,
            reason: AdjustmentReason.RECOUNT,
          },
          'admin-1',
          'idem-sql-2',
        );

        const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
        // The compare half of the compare-and-set.
        expect(sql).toContain('"onHand" =');
        // The reserved floor, inside the WHERE so it cannot be raced.
        expect(sql).toContain('>= "reserved"');
        expect(sql).toContain('RETURNING');
      });
    });

    describe('mode exclusivity', () => {
      /**
       * `@ValidateIf` cannot express this: whitelisting strips only properties
       * with no validation metadata, and conditional metadata counts, so
       * `forbidNonWhitelisted` never fires on a body carrying both.
       */
      it('rejects a body sending both quantity and setTo', async () => {
        await expect(
          service.adjustInventory(
            {
              variantId: 'var-1',
              locationId: 'loc-1',
              quantity: 5,
              setTo: 25,
              expectedOnHand: 20,
              reason: AdjustmentReason.RECOUNT,
            },
            'admin-1',
            'idem-mode-1',
          ),
        ).rejects.toBeInstanceOf(InventoryAdjustModeException);
      });

      it('rejects a body sending neither', async () => {
        await expect(
          service.adjustInventory(
            { variantId: 'var-1', locationId: 'loc-1', reason: AdjustmentReason.RECOUNT },
            'admin-1',
            'idem-mode-2',
          ),
        ).rejects.toBeInstanceOf(InventoryAdjustModeException);
      });

      it('rejects setTo without expectedOnHand, which would make it a blind write', async () => {
        await expect(
          service.adjustInventory(
            {
              variantId: 'var-1',
              locationId: 'loc-1',
              setTo: 25,
              reason: AdjustmentReason.RECOUNT,
            },
            'admin-1',
            'idem-mode-3',
          ),
        ).rejects.toBeInstanceOf(InventoryAdjustModeException);
      });

      it('an unusable body does not consume the idempotency key', async () => {
        await service
          .adjustInventory(
            { variantId: 'var-1', locationId: 'loc-1', reason: AdjustmentReason.RECOUNT },
            'admin-1',
            'idem-mode-4',
          )
          .catch(() => undefined);

        expect(idempotency.beginRequest).not.toHaveBeenCalled();
      });
    });

    describe('negative delta', () => {
      it('is refused by the guarded UPDATE rather than a read-then-compare', async () => {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 5 })),
            upsert: jest.fn(),
            create: jest.fn(),
          },
          inventoryMovement: { create: jest.fn() },
          $executeRaw: jest.fn().mockResolvedValue(0),
        };
        prisma.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
          fn(tx),
        );

        await expect(
          service.adjustInventory(
            {
              variantId: 'var-1',
              locationId: 'loc-1',
              quantity: -10,
              reason: AdjustmentReason.DAMAGE,
            },
            'admin-1',
            'idem-neg-1',
          ),
        ).rejects.toThrow(BadRequestException);

        // The refusal must come from the statement, not from JavaScript.
        expect(tx.$executeRaw).toHaveBeenCalled();
        expect(tx.stockLevel.upsert).not.toHaveBeenCalled();
      });

      it('applies a legal negative delta through the same statement', async () => {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 20 })),
            upsert: jest.fn(),
            create: jest.fn(),
          },
          inventoryMovement: { create: jest.fn() },
          $executeRaw: jest.fn().mockResolvedValue(1),
        };
        prisma.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) =>
          fn(tx),
        );

        await service.adjustInventory(
          {
            variantId: 'var-1',
            locationId: 'loc-1',
            quantity: -3,
            reason: AdjustmentReason.DAMAGE,
          },
          'admin-1',
          'idem-neg-2',
        );

        expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ quantity: -3 }) }),
        );
      });
    });

    it('applies positive adjustment and logs movement', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 10 })),
            upsert: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 30 })),
          },
          inventoryMovement: { create: jest.fn().mockResolvedValue(makeMovement()) },
        };
        return fn(tx);
      });

      await service.adjustInventory(
        { variantId: 'var-1', locationId: 'loc-1', quantity: 20, reason: AdjustmentReason.RECOUNT },
        'admin-1',
        'idem-i2',
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(idempotency.completeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'inventory-adjust', key: 'idem-i2' }),
      );
    });

    it('throws NotFoundException when variant does not exist', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(null);
      await expect(
        service.adjustInventory(
          {
            variantId: 'bad-var',
            locationId: 'loc-1',
            quantity: 5,
            reason: AdjustmentReason.RECOUNT,
          },
          'admin-1',
          'idem-i3',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('short-circuits on cached idempotency hit — skips prisma + completeRequest', async () => {
      idempotency.beginRequest.mockResolvedValue({ state: 'cached', cachedResponse: null });
      await service.adjustInventory(
        { variantId: 'var-1', locationId: 'loc-1', quantity: 5, reason: AdjustmentReason.RECOUNT },
        'admin-1',
        'idem-cached',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(idempotency.completeRequest).not.toHaveBeenCalled();
    });
  });

  // ── transferInventory ──────────────────────────────────────────────────────

  describe('transferInventory', () => {
    beforeEach(() => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 'var-1' });
      prisma.inventoryLocation.findUnique.mockResolvedValue(makeLocation());
    });

    it('rejects transfer to the same location', async () => {
      await expect(
        service.transferInventory(
          { variantId: 'var-1', fromLocationId: 'loc-1', toLocationId: 'loc-1', quantity: 5 },
          'admin-1',
          'idem-t1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transfer when source has insufficient available stock (JS-side fast-fail)', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          $executeRaw: jest.fn(),
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 5, reserved: 3 })),
            update: jest.fn(),
            upsert: jest.fn(),
          },
          inventoryMovement: { createMany: jest.fn() },
        };
        return fn(tx);
      });

      await expect(
        service.transferInventory(
          { variantId: 'var-1', fromLocationId: 'loc-1', toLocationId: 'loc-2', quantity: 10 },
          'admin-1',
          'idem-t2',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws insufficient-stock when atomic UPDATE affects 0 rows (race-safe gate, E2 §1.11 BLOCKER)', async () => {
      // Simulates the race window: JS-side fast-fail passes (source.onHand looks sufficient
      // when read), but a concurrent decrement drained the stock before the raw-SQL UPDATE.
      // The WHERE on_hand >= qty guard serialises on the row; the loser sees rowsAffected = 0.
      const upsertMock = jest.fn();
      const createManyMock = jest.fn();
      const executeRawMock = jest.fn().mockResolvedValue(0);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          $executeRaw: executeRawMock,
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 50, reserved: 0 })),
            update: jest.fn(),
            upsert: upsertMock,
          },
          inventoryMovement: { createMany: createManyMock },
        };
        return fn(tx);
      });

      await expect(
        service.transferInventory(
          { variantId: 'var-1', fromLocationId: 'loc-1', toLocationId: 'loc-2', quantity: 20 },
          'admin-1',
          '11111111-1111-4111-8111-111111111111',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(executeRawMock).toHaveBeenCalled();
      expect(upsertMock).not.toHaveBeenCalled();
      expect(createManyMock).not.toHaveBeenCalled();
    });

    it('logs two TRANSFER movements (one negative, one positive)', async () => {
      const createMany = jest.fn().mockResolvedValue({ count: 2 });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          stockLevel: {
            findUnique: jest.fn().mockResolvedValue(makeStockLevel({ onHand: 50, reserved: 0 })),
            update: jest.fn().mockResolvedValue({}),
            upsert: jest.fn().mockResolvedValue({}),
          },
          inventoryMovement: { createMany },
        };
        return fn(tx);
      });

      await service.transferInventory(
        { variantId: 'var-1', fromLocationId: 'loc-1', toLocationId: 'loc-2', quantity: 20 },
        'admin-1',
        'idem-t3',
      );

      expect(createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ quantity: -20, type: MovementType.TRANSFER }),
            expect.objectContaining({ quantity: 20, type: MovementType.TRANSFER }),
          ]),
        }),
      );
    });
  });

  // ── Location CRUD ──────────────────────────────────────────────────────────

  describe('createLocation', () => {
    it('throws ConflictException when code already exists', async () => {
      prisma.inventoryLocation.findUnique.mockResolvedValue(makeLocation());
      await expect(service.createLocation({ name: 'Store B', code: 'WH-MAIN' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates location when code is unique', async () => {
      prisma.inventoryLocation.findUnique.mockResolvedValue(null);
      prisma.inventoryLocation.create.mockResolvedValue(makeLocation({ code: 'WH-NEW' }));

      await service.createLocation({ name: 'New WH', code: 'WH-NEW' });
      expect(prisma.inventoryLocation.create).toHaveBeenCalled();
    });
  });

  describe('deleteLocation', () => {
    it('throws BadRequestException when location holds stock', async () => {
      prisma.inventoryLocation.findUnique.mockResolvedValue(makeLocation());
      prisma.stockLevel.findFirst.mockResolvedValue(makeStockLevel({ onHand: 10 }));

      await expect(service.deleteLocation('loc-1')).rejects.toThrow(BadRequestException);
    });

    it('deletes when no stock is held', async () => {
      prisma.inventoryLocation.findUnique.mockResolvedValue(makeLocation());
      prisma.stockLevel.findFirst.mockResolvedValue(null);
      prisma.inventoryLocation.delete.mockResolvedValue(makeLocation());

      await service.deleteLocation('loc-1');
      expect(prisma.inventoryLocation.delete).toHaveBeenCalledWith({ where: { id: 'loc-1' } });
    });
  });

  // ── listMovements ──────────────────────────────────────────────────────────

  describe('listMovements', () => {
    it('returns paginated movement log', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([makeMovement()]);
      prisma.inventoryMovement.count.mockResolvedValue(1);

      const result = await service.listMovements({ page: 1, pageSize: 20 });
      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
      expect(result.data).toHaveLength(1);
    });

    it('filters by variantId and type', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);
      prisma.inventoryMovement.count.mockResolvedValue(0);

      await service.listMovements({ variantId: 'var-1', type: MovementType.SALE });

      expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ variantId: 'var-1', type: MovementType.SALE }),
        }),
      );
    });

    it('applies dateFrom / dateTo filters as createdAt bounds', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);
      prisma.inventoryMovement.count.mockResolvedValue(0);

      await service.listMovements({ dateFrom: '2026-01-01', dateTo: '2026-03-31' });

      expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-03-31'),
            },
          }),
        }),
      );
    });
  });

  // ── effectiveLowStockThreshold: the public surface sibling modules inject ──

  describe('effectiveLowStockThreshold', () => {
    it('is callable from outside the service and returns the store setting', async () => {
      await expect(service.effectiveLowStockThreshold()).resolves.toBe(5);
      expect(settings.get).toHaveBeenCalledWith('defaultLowStockThreshold');
    });

    it('coerces a numeric string setting', async () => {
      settings.get.mockResolvedValue('7');
      await expect(service.effectiveLowStockThreshold()).resolves.toBe(7);
    });

    it('falls back to the module constant when the setting is missing', async () => {
      settings.get.mockResolvedValue(undefined);
      await expect(service.effectiveLowStockThreshold()).resolves.toBe(LOW_STOCK_THRESHOLD);
    });

    it('falls back to the module constant when the setting is invalid', async () => {
      settings.get.mockResolvedValue('not-a-number');
      await expect(service.effectiveLowStockThreshold()).resolves.toBe(LOW_STOCK_THRESHOLD);
    });

    it('falls back to the module constant when the settings lookup throws', async () => {
      settings.get.mockRejectedValue(new Error('settings offline'));
      await expect(service.effectiveLowStockThreshold()).resolves.toBe(LOW_STOCK_THRESHOLD);
    });

    it('rejects a negative setting', async () => {
      settings.get.mockResolvedValue(-1);
      await expect(service.effectiveLowStockThreshold()).resolves.toBe(LOW_STOCK_THRESHOLD);
    });
  });

  // ── availabilityForVariants: the fresh grade sibling modules inject ───────
  //
  // The storefront product detail is cached for 5 minutes and nothing
  // invalidates that key when stock moves, so the grade must be produced here
  // on every read rather than cached alongside the payload.

  describe('availabilityForVariants', () => {
    function seedLevels(...rows: Array<{ variantId: string; onHand: number; reserved: number }>) {
      prisma.stockLevel.findMany.mockResolvedValue(rows);
    }

    it('grades IN_STOCK above the threshold', async () => {
      seedLevels({ variantId: 'var-1', onHand: 40, reserved: 0 });

      const graded = await service.availabilityForVariants(['var-1']);

      expect(graded.get('var-1')).toEqual({ stock: 40, availability: 'IN_STOCK' });
    });

    it('grades LOW_STOCK at the threshold boundary', async () => {
      seedLevels({ variantId: 'var-1', onHand: 5, reserved: 0 });

      const graded = await service.availabilityForVariants(['var-1']);

      expect(graded.get('var-1')).toEqual({ stock: 5, availability: 'LOW_STOCK' });
    });

    it('grades OUT_OF_STOCK on an empty shelf', async () => {
      seedLevels({ variantId: 'var-1', onHand: 0, reserved: 0 });

      const graded = await service.availabilityForVariants(['var-1']);

      expect(graded.get('var-1')).toEqual({ stock: 0, availability: 'OUT_OF_STOCK' });
    });

    it('grades OUT_OF_STOCK when reservations fully consume onHand', async () => {
      seedLevels({ variantId: 'var-1', onHand: 4, reserved: 4 });

      const graded = await service.availabilityForVariants(['var-1']);

      expect(graded.get('var-1')).toEqual({ stock: 0, availability: 'OUT_OF_STOCK' });
    });

    it('folds net available across a variant locations', async () => {
      seedLevels(
        { variantId: 'var-1', onHand: 12, reserved: 2 },
        { variantId: 'var-1', onHand: 5, reserved: 1 },
      );

      const graded = await service.availabilityForVariants(['var-1']);

      expect(graded.get('var-1')).toEqual({ stock: 14, availability: 'IN_STOCK' });
    });

    it('clamps a location whose reserved exceeds onHand instead of borrowing from another', async () => {
      seedLevels(
        { variantId: 'var-1', onHand: 2, reserved: 9 },
        { variantId: 'var-1', onHand: 6, reserved: 0 },
      );

      const graded = await service.availabilityForVariants(['var-1']);

      expect(graded.get('var-1')).toEqual({ stock: 6, availability: 'IN_STOCK' });
    });

    it('grades a variant with no stock row at all as OUT_OF_STOCK with stock 0', async () => {
      seedLevels();

      const graded = await service.availabilityForVariants(['var-missing']);

      expect(graded.get('var-missing')).toEqual({ stock: 0, availability: 'OUT_OF_STOCK' });
    });

    it('returns an entry for every id passed in', async () => {
      seedLevels({ variantId: 'var-2', onHand: 3, reserved: 0 });

      const graded = await service.availabilityForVariants(['var-1', 'var-2', 'var-3']);

      expect([...graded.keys()].sort()).toEqual(['var-1', 'var-2', 'var-3']);
      expect(graded.get('var-1')).toEqual({ stock: 0, availability: 'OUT_OF_STOCK' });
      expect(graded.get('var-2')).toEqual({ stock: 3, availability: 'LOW_STOCK' });
      expect(graded.get('var-3')).toEqual({ stock: 0, availability: 'OUT_OF_STOCK' });
    });

    it('queries StockLevel once for the whole batch', async () => {
      seedLevels();

      await service.availabilityForVariants(['var-1', 'var-2', 'var-3']);

      expect(prisma.stockLevel.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.stockLevel.findMany).toHaveBeenCalledWith({
        where: { variantId: { in: ['var-1', 'var-2', 'var-3'] } },
        select: { variantId: true, onHand: true, reserved: true },
      });
    });

    it('reads the threshold once per call, not once per variant', async () => {
      seedLevels(
        { variantId: 'var-1', onHand: 1, reserved: 0 },
        { variantId: 'var-2', onHand: 2, reserved: 0 },
        { variantId: 'var-3', onHand: 3, reserved: 0 },
      );

      await service.availabilityForVariants(['var-1', 'var-2', 'var-3']);

      expect(settings.get).toHaveBeenCalledTimes(1);
    });

    it('grades against the store threshold, falling back to the module constant', async () => {
      settings.get.mockResolvedValue(undefined);
      seedLevels({ variantId: 'var-1', onHand: LOW_STOCK_THRESHOLD, reserved: 0 });

      const graded = await service.availabilityForVariants(['var-1']);

      expect(graded.get('var-1')).toEqual({
        stock: LOW_STOCK_THRESHOLD,
        availability: 'LOW_STOCK',
      });
    });

    it('returns an empty map without querying or reading the threshold for an empty id list', async () => {
      const graded = await service.availabilityForVariants([]);

      expect(graded.size).toBe(0);
      expect(prisma.stockLevel.findMany).not.toHaveBeenCalled();
      expect(settings.get).not.toHaveBeenCalled();
    });
  });

  // ── listStockLevels: status + threshold (plan F, finding F1/F2) ────────────

  describe('listStockLevels', () => {
    function seedRows(...onHands: number[]) {
      prisma.stockLevel.findMany.mockResolvedValue(
        onHands.map((onHand, i) => makeStockLevel({ id: `sl-${i}`, onHand, reserved: 0 })),
      );
      prisma.stockLevel.count.mockResolvedValue(onHands.length);
    }

    it('derives status from onHand against the settings threshold', async () => {
      seedRows(0, 1, 5, 6);

      const result = await service.listStockLevels({});
      const rows = result.data as Array<{ status: string; lowStockThreshold: number }>;

      expect(rows.map((r) => r.status)).toEqual([
        'OUT_OF_STOCK',
        'LOW_STOCK',
        'LOW_STOCK',
        'IN_STOCK',
      ]);
      expect(rows.every((r) => r.lowStockThreshold === 5)).toBe(true);
      expect(settings.get).toHaveBeenCalledWith('defaultLowStockThreshold');
    });

    it('reads the threshold once per request, not once per row', async () => {
      seedRows(1, 2, 3);
      await service.listStockLevels({});
      expect(settings.get).toHaveBeenCalledTimes(1);
    });

    it('filters LOW_STOCK on the effective threshold', async () => {
      seedRows();
      await service.listStockLevels({ stockStatus: 'LOW_STOCK' });

      expect(prisma.stockLevel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ onHand: { gt: 0, lte: 5 } }) }),
      );
    });

    it('filters IN_STOCK above the effective threshold', async () => {
      seedRows();
      await service.listStockLevels({ stockStatus: 'IN_STOCK' });

      expect(prisma.stockLevel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ onHand: { gt: 5 } }) }),
      );
    });

    it('falls back to the module constant when the setting is missing', async () => {
      settings.get.mockResolvedValue(undefined);
      seedRows(6);

      const result = await service.listStockLevels({});
      const rows = result.data as Array<{ status: string; lowStockThreshold: number }>;

      expect(rows[0].status).toBe('LOW_STOCK');
      expect(rows[0].lowStockThreshold).toBe(10);
    });

    it('falls back to the module constant when the setting is invalid', async () => {
      settings.get.mockResolvedValue('not-a-number');
      seedRows();

      await service.listStockLevels({ stockStatus: 'LOW_STOCK' });

      expect(prisma.stockLevel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ onHand: { gt: 0, lte: 10 } }) }),
      );
    });

    it('falls back to the module constant when the settings lookup throws', async () => {
      settings.get.mockRejectedValue(new Error('settings offline'));
      seedRows(7);

      const result = await service.listStockLevels({});
      const rows = result.data as Array<{ status: string; lowStockThreshold: number }>;

      expect(rows[0].status).toBe('LOW_STOCK');
      expect(rows[0].lowStockThreshold).toBe(10);
    });
  });

  describe('listAlerts', () => {
    it('selects rows against the effective threshold and tags the alert type', async () => {
      prisma.stockLevel.findMany.mockResolvedValue([
        makeStockLevel({ id: 'sl-out', onHand: 0 }),
        makeStockLevel({ id: 'sl-low', onHand: 3 }),
      ]);
      prisma.stockLevel.count.mockResolvedValue(2);

      const result = await service.listAlerts(1, 20);
      const rows = result.data as Array<{ alertType: string; lowStockThreshold: number }>;

      expect(prisma.stockLevel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { onHand: { lte: 5 } } }),
      );
      expect(rows.map((r) => r.alertType)).toEqual(['OUT_OF_STOCK', 'LOW_STOCK']);
      expect(rows.every((r) => r.lowStockThreshold === 5)).toBe(true);
    });
  });
});
