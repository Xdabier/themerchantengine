import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ShippingMethodType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShippingService } from './shipping.service';
import { SHIPPING_REDIS_CLIENT } from './shipping.constants';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeZone(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'zone-1',
    name: { default: 'Domestic', en: 'Domestic', fr: 'National' },
    countries: ['AE'],
    states: [],
    postalCodeRanges: null,
    priority: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    methods: [],
    ...overrides,
  };
}

function makeMethod(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'method-1',
    zoneId: 'zone-1',
    name: { default: 'Standard', en: 'Standard', fr: 'Standard' },
    type: ShippingMethodType.FLAT_RATE,
    price: 20,
    weightRanges: null,
    priceRanges: null,
    freeAbove: null,
    estimatedDaysMin: 3,
    estimatedDaysMax: 5,
    isActive: true,
    isDefault: false,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

// ── Prisma mock ───────────────────────────────────────────────────────────────

function makePrismaMock() {
  const shippingZone = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };
  const shippingMethod = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  };
  const base = { shippingZone, shippingMethod };
  return {
    ...base,
    // Interactive transaction: run the callback with the same mock as `tx`.
    $transaction: jest.fn((cb: (tx: typeof base) => unknown) => cb(base)),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ShippingService', () => {
  let service: ShippingService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingService,
        { provide: PrismaService, useValue: prisma },
        { provide: SHIPPING_REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ShippingService);
  });

  // ── calculateRates ─────────────────────────────────────────────────────────

  describe('calculateRates', () => {
    it('returns empty array when no zone matches the country', async () => {
      prisma.shippingZone.findMany.mockResolvedValue([]);

      const result = await service.calculateRates({
        country: 'US',
        items: [{ weight: 1, quantity: 2 }],
        subtotal: 100,
      });

      expect(result).toEqual([]);
    });

    it('calculates FLAT_RATE correctly', async () => {
      const method = makeMethod({ type: ShippingMethodType.FLAT_RATE, price: 15 });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [method] })]);

      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 50,
      });

      expect(result).toHaveLength(1);
      expect(result[0].price).toBe(15);
      expect(result[0].methodId).toBe('method-1');
    });

    it('calculates WEIGHT_BASED using the matching kg range', async () => {
      const method = makeMethod({
        type: ShippingMethodType.WEIGHT_BASED,
        price: null,
        weightRanges: [
          { minKg: 0, maxKg: 5, price: 20 },
          { minKg: 5.01, maxKg: 15, price: 35 },
        ],
      });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [method] })]);

      // cartWeight = 2 * 2 = 4 kg → first range
      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 2, quantity: 2 }],
        subtotal: 80,
      });

      expect(result[0].price).toBe(20);
    });

    it('excludes WEIGHT_BASED method when no range matches cart weight', async () => {
      const method = makeMethod({
        type: ShippingMethodType.WEIGHT_BASED,
        price: null,
        weightRanges: [{ minKg: 0, maxKg: 5, price: 20 }],
      });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [method] })]);

      // cartWeight = 10 kg — outside the defined range
      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 10, quantity: 1 }],
        subtotal: 100,
      });

      expect(result).toHaveLength(0);
    });

    it('calculates PRICE_BASED using the matching subtotal range', async () => {
      const method = makeMethod({
        type: ShippingMethodType.PRICE_BASED,
        price: null,
        priceRanges: [
          { minAmount: 0, maxAmount: 200, price: 15 },
          { minAmount: 200.01, maxAmount: 500, price: 10 },
        ],
      });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [method] })]);

      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 150,
      });

      expect(result[0].price).toBe(15);
    });

    it('returns price 0 for FREE type', async () => {
      const method = makeMethod({ type: ShippingMethodType.FREE, price: null });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [method] })]);

      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 50,
      });

      expect(result[0].price).toBe(0);
    });

    it('overrides price to 0 when subtotal meets freeAbove threshold', async () => {
      const method = makeMethod({
        type: ShippingMethodType.FLAT_RATE,
        price: 25,
        freeAbove: 200,
      });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [method] })]);

      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 250, // above freeAbove threshold
      });

      expect(result[0].price).toBe(0);
    });

    it('does NOT apply freeAbove when subtotal is below threshold', async () => {
      const method = makeMethod({
        type: ShippingMethodType.FLAT_RATE,
        price: 25,
        freeAbove: 200,
      });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [method] })]);

      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 100, // below threshold
      });

      expect(result[0].price).toBe(25);
    });

    it('uses the first (lowest priority) matching zone — zone priority resolution §9.9', async () => {
      const methodA = makeMethod({ id: 'method-A', price: 5 });
      const methodB = makeMethod({ id: 'method-B', price: 30 });

      // Prisma returns them already ordered by priority asc
      prisma.shippingZone.findMany.mockResolvedValue([
        makeZone({ id: 'zone-high', priority: 1, methods: [methodA] }),
        makeZone({ id: 'zone-low', priority: 5, methods: [methodB] }),
      ]);

      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 50,
      });

      // Should only have methods from the higher-priority (lower number) zone
      expect(result).toHaveLength(1);
      expect(result[0].methodId).toBe('method-A');
    });

    it('skips a zone when postalCode falls outside its postalCodeRanges', async () => {
      const zoneTight = makeZone({
        id: 'zone-tight',
        priority: 1,
        postalCodeRanges: [{ from: '10000', to: '19999' }],
        methods: [makeMethod({ id: 'method-tight', price: 5 })],
      });
      const zoneWide = makeZone({
        id: 'zone-wide',
        priority: 2,
        postalCodeRanges: null,
        methods: [makeMethod({ id: 'method-wide', price: 20 })],
      });

      prisma.shippingZone.findMany.mockResolvedValue([zoneTight, zoneWide]);

      // postalCode 90210 is outside zone-tight's range → falls through to zone-wide
      const result = await service.calculateRates({
        country: 'QA',
        postalCode: '90210',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 50,
      });

      expect(result[0].methodId).toBe('method-wide');
    });

    it('accumulates weight correctly from multiple items', async () => {
      // 2×3kg + 1×4kg = 10kg — should NOT match a 0-5kg range
      const method = makeMethod({
        type: ShippingMethodType.WEIGHT_BASED,
        weightRanges: [{ minKg: 0, maxKg: 5, price: 20 }],
      });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [method] })]);

      const result = await service.calculateRates({
        country: 'QA',
        items: [
          { weight: 3, quantity: 2 },
          { weight: 4, quantity: 1 },
        ],
        subtotal: 100,
      });

      expect(result).toHaveLength(0);
    });
  });

  // ── createZone ─────────────────────────────────────────────────────────────

  describe('createZone', () => {
    it('creates and returns the new zone', async () => {
      const zone = makeZone();
      prisma.shippingZone.create.mockResolvedValue(zone);

      const result = await service.createZone({
        name: { default: 'Domestic' },
        countries: ['AE'],
      });

      expect(prisma.shippingZone.create).toHaveBeenCalled();
      expect(result).toEqual(zone);
    });
  });

  // ── updateZone ─────────────────────────────────────────────────────────────

  describe('updateZone', () => {
    it('throws NotFoundException when zone does not exist', async () => {
      prisma.shippingZone.findUnique.mockResolvedValue(null);

      await expect(service.updateZone('bad-id', { priority: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates zone when found', async () => {
      prisma.shippingZone.findUnique.mockResolvedValue(makeZone());
      prisma.shippingZone.update.mockResolvedValue(makeZone({ priority: 5 }));

      const result = await service.updateZone('zone-1', { priority: 5 });
      expect(prisma.shippingZone.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'zone-1' } }),
      );
      expect(result).toMatchObject({ priority: 5 });
    });
  });

  // ── createMethod ───────────────────────────────────────────────────────────

  describe('createMethod', () => {
    it('throws NotFoundException when zoneId does not exist', async () => {
      prisma.shippingZone.findUnique.mockResolvedValue(null);

      await expect(
        service.createMethod({
          zoneId: 'bad-zone',
          name: { default: 'Standard' },
          type: ShippingMethodType.FLAT_RATE,
          price: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates method when zone exists', async () => {
      prisma.shippingZone.findUnique.mockResolvedValue(makeZone());
      prisma.shippingMethod.create.mockResolvedValue(makeMethod());

      await service.createMethod({
        zoneId: 'zone-1',
        name: { default: 'Standard' },
        type: ShippingMethodType.FLAT_RATE,
        price: 20,
      });

      expect(prisma.shippingMethod.create).toHaveBeenCalled();
    });

    it('clears sibling defaults before creating a default method', async () => {
      prisma.shippingZone.findUnique.mockResolvedValue(makeZone());
      prisma.shippingMethod.create.mockResolvedValue(makeMethod({ isDefault: true }));

      await service.createMethod({
        zoneId: 'zone-1',
        name: { default: 'Standard' },
        type: ShippingMethodType.FLAT_RATE,
        price: 10,
        isDefault: true,
      });

      expect(prisma.shippingMethod.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ zoneId: 'zone-1', isDefault: true, deletedAt: null }),
          data: { isDefault: false },
        }),
      );
      expect(prisma.shippingMethod.create).toHaveBeenCalled();
    });

    it('does not clear siblings when the new method is not a default', async () => {
      prisma.shippingZone.findUnique.mockResolvedValue(makeZone());
      prisma.shippingMethod.create.mockResolvedValue(makeMethod());

      await service.createMethod({
        zoneId: 'zone-1',
        name: { default: 'Standard' },
        type: ShippingMethodType.FLAT_RATE,
        price: 20,
      });

      expect(prisma.shippingMethod.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── updateMethod (default handling) ──────────────────────────────────────────

  describe('updateMethod', () => {
    it('clears sibling defaults (excluding self) when promoting to default', async () => {
      prisma.shippingMethod.findUnique.mockResolvedValue(
        makeMethod({ id: 'method-1', zoneId: 'zone-1' }),
      );
      prisma.shippingMethod.update.mockResolvedValue(makeMethod({ isDefault: true }));

      await service.updateMethod('method-1', { isDefault: true });

      expect(prisma.shippingMethod.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            zoneId: 'zone-1',
            isDefault: true,
            deletedAt: null,
            id: { not: 'method-1' },
          }),
          data: { isDefault: false },
        }),
      );
    });

    it('does not clear siblings when isDefault is not being set true', async () => {
      prisma.shippingMethod.findUnique.mockResolvedValue(makeMethod());
      prisma.shippingMethod.update.mockResolvedValue(makeMethod({ price: 12 }));

      await service.updateMethod('method-1', { price: 12 });

      expect(prisma.shippingMethod.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── default-method resolution helpers ────────────────────────────────────────

  describe('resolveDefaultRate', () => {
    const rate = (id: string, isDefault: boolean) => ({
      methodId: id,
      name: { default: id },
      price: 10,
      isDefault,
      estimatedDaysMin: null,
      estimatedDaysMax: null,
    });

    it('returns the isDefault rate over earlier non-default rates', () => {
      expect(service.resolveDefaultRate([rate('a', false), rate('b', true)])?.methodId).toBe('b');
    });

    it('falls back to the first rate when none is flagged default', () => {
      expect(service.resolveDefaultRate([rate('a', false), rate('b', false)])?.methodId).toBe('a');
    });

    it('returns null for an empty rate list', () => {
      expect(service.resolveDefaultRate([])).toBeNull();
    });
  });

  describe('calculateRates default flag', () => {
    it('flags the default method and orders the methods query default-first', async () => {
      const def = makeMethod({ id: 'm-def', price: 10, isDefault: true });
      prisma.shippingZone.findMany.mockResolvedValue([makeZone({ methods: [def] })]);

      const result = await service.calculateRates({
        country: 'QA',
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 50,
      });

      expect(result[0].isDefault).toBe(true);
      expect(prisma.shippingZone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            methods: expect.objectContaining({
              orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
            }),
          },
        }),
      );
    });
  });

  describe('getStoreDefaultRate', () => {
    it('resolves the single store-wide default method rate', async () => {
      prisma.shippingMethod.findMany.mockResolvedValue([
        makeMethod({ id: 'm-def', price: 10, isDefault: true }),
      ]);

      const result = await service.getStoreDefaultRate({
        items: [{ weight: 1, quantity: 1 }],
        subtotal: 50,
      });

      expect(result).toMatchObject({ methodId: 'm-def', price: 10, isDefault: true });
    });

    it('returns null when there is no default method', async () => {
      prisma.shippingMethod.findMany.mockResolvedValue([]);
      expect(await service.getStoreDefaultRate({ items: [], subtotal: 0 })).toBeNull();
    });

    it('returns null when defaults are ambiguous across zones', async () => {
      prisma.shippingMethod.findMany.mockResolvedValue([
        makeMethod({ id: 'a', isDefault: true }),
        makeMethod({ id: 'b', isDefault: true }),
      ]);
      expect(await service.getStoreDefaultRate({ items: [], subtotal: 0 })).toBeNull();
    });
  });

  describe('hasActiveZones', () => {
    it('returns true when at least one active zone exists', async () => {
      prisma.shippingZone.count.mockResolvedValue(1);
      expect(await service.hasActiveZones()).toBe(true);
    });

    it('returns false when no active zones exist', async () => {
      prisma.shippingZone.count.mockResolvedValue(0);
      expect(await service.hasActiveZones()).toBe(false);
    });
  });

  // ── deleteMethod ───────────────────────────────────────────────────────────

  describe('deleteMethod', () => {
    it('throws NotFoundException for unknown method', async () => {
      prisma.shippingMethod.findUnique.mockResolvedValue(null);

      await expect(service.deleteMethod('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('sets isActive = false (soft disable)', async () => {
      prisma.shippingMethod.findUnique.mockResolvedValue(makeMethod());
      prisma.shippingMethod.update.mockResolvedValue(makeMethod({ isActive: false }));

      await service.deleteMethod('method-1');

      expect(prisma.shippingMethod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'method-1' },
          data: { isActive: false },
        }),
      );
    });
  });

  // ── listZones ──────────────────────────────────────────────────────────────

  describe('listZones', () => {
    it('returns paginated zones', async () => {
      prisma.shippingZone.findMany.mockResolvedValue([makeZone()]);
      prisma.shippingZone.count.mockResolvedValue(1);

      const result = await service.listZones({ page: 1, pageSize: 20 });
      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
      expect(result.data).toHaveLength(1);
    });
  });

  // ── listMethods ────────────────────────────────────────────────────────────

  describe('listMethods', () => {
    it('filters by zoneId when provided', async () => {
      prisma.shippingMethod.findMany.mockResolvedValue([makeMethod()]);
      prisma.shippingMethod.count.mockResolvedValue(1);

      await service.listMethods({ zoneId: 'zone-1' });

      expect(prisma.shippingMethod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { zoneId: 'zone-1' } }),
      );
    });
  });
});
