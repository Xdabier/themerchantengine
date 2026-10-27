import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxService } from './tax.service';
import { TAX_REDIS_CLIENT } from './tax.constants';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeZone(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'zone-1',
    name: 'Libye',
    countries: ['LY'],
    rate: 0.19, // a standard rate with three-decimal money
    isDefault: false,
    isCompound: false,
    priority: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeTaxClass(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'class-1',
    zoneId: 'zone-1',
    name: 'Standard',
    rate: 0.19,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Prisma mock ───────────────────────────────────────────────────────────────

function makePrismaMock() {
  return {
    taxZone: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    taxClass: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('TaxService', () => {
  let service: TaxService;
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
        TaxService,
        { provide: PrismaService, useValue: prisma },
        { provide: TAX_REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(TaxService);
  });

  // ── calculateTax ───────────────────────────────────────────────────────────

  describe('calculateTax', () => {
    it('applies zone base rate when no taxClassId is given', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0.05 }));

      const result = await service.calculateTax('LY', null, 200);

      expect(result.rate).toBe(0.05);
      expect(result.amount).toBeCloseTo(10); // 200 × 0.05
      expect(result.zone?.name).toBe('Libye');
    });

    it('applies the standard rate and quantises to the thousandth', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone());

      const result = await service.calculateTax('LY', null, 1000);

      expect(result.rate).toBe(0.19);
      // Exact, not `toBeCloseTo`. Every rate and base pair this suite carried
      // was chosen so the product lands exactly on two decimals, which is why
      // it could not see a rounding defect: 200 × 0.05 is 10 under any policy.
      expect(result.amount).toBe(190);
    });

    it('returns 0 tax when no zone matches and no isDefault zone', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(null);

      const result = await service.calculateTax('US', null, 100);

      expect(result.rate).toBe(0);
      expect(result.amount).toBe(0);
      expect(result.zone).toBeNull();
    });

    it('falls back to isDefault zone when country is not matched', async () => {
      // First call (country match) → null; second call (isDefault) → default zone
      prisma.taxZone.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeZone({ id: 'zone-default', name: 'World Default', rate: 0.1, isDefault: true }),
        );

      const result = await service.calculateTax('US', null, 100);

      expect(result.rate).toBe(0.1);
      expect(result.amount).toBeCloseTo(10);
      expect(result.zone?.name).toBe('World Default');
    });

    it('charges nothing on a destination the store does not model, given the seeded zones', async () => {
      // The behaviour the store-config seed exists to produce, asserted here
      // rather than as a flag in the seed spec. An earlier seed gave the domestic
      // zone both its country AND `isDefault: true`, which made the zero-rated
      // catch-all unreachable and quoted the domestic VAT on France and every
      // other unmatched destination.
      //
      // `resolveZone` matches on `countries: { has: country }` first, so a
      // French address misses; the fallback then returns whichever zone holds
      // `isDefault`, which must be the catch-all at rate 0.
      prisma.taxZone.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeZone({ id: 'taxzone-default', name: 'Elsewhere', rate: 0, isDefault: true }),
        );

      const result = await service.calculateTax('FR', null, 100);

      expect(result.rate).toBe(0);
      expect(result.amount).toBe(0);
    });

    it('uses zone-specific TaxClass rate when found in matched zone', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0.05 }));
      prisma.taxClass.findUnique.mockResolvedValue(makeTaxClass({ name: 'Reduced', rate: 0.03 }));
      prisma.taxClass.findFirst.mockResolvedValue(makeTaxClass({ name: 'Reduced', rate: 0.03 }));

      const result = await service.calculateTax('LY', 'class-1', 200);

      expect(result.rate).toBe(0.03);
      expect(result.amount).toBeCloseTo(6); // 200 × 0.03
    });

    it('falls back to zone base rate when taxClass name not found in matched zone', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0.05 }));
      prisma.taxClass.findUnique.mockResolvedValue(makeTaxClass({ name: 'Reduced', rate: 0.03 }));
      // Class not found in matched zone
      prisma.taxClass.findFirst.mockResolvedValue(null);

      const result = await service.calculateTax('LY', 'class-1', 200);

      expect(result.rate).toBe(0.05); // zone base rate
      expect(result.amount).toBeCloseTo(10);
    });

    it('returns 0% for Zero-Rated class', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0.05 }));
      prisma.taxClass.findUnique.mockResolvedValue(
        makeTaxClass({ id: 'class-zero', name: 'Zero-Rated', rate: 0 }),
      );

      const result = await service.calculateTax('LY', 'class-zero', 300);

      expect(result.rate).toBe(0);
      expect(result.amount).toBe(0);
      expect(result.zone?.id).toBe('zone-1'); // zone is still resolved
    });

    it('returns 0% for Exempt class', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0.05 }));
      prisma.taxClass.findUnique.mockResolvedValue(
        makeTaxClass({ id: 'class-exempt', name: 'Exempt', rate: 0 }),
      );

      const result = await service.calculateTax('LY', 'class-exempt', 500);

      expect(result.rate).toBe(0);
      expect(result.amount).toBe(0);
    });

    it('prefers priority-1 zone over priority-5 zone for same country', async () => {
      // Prisma returns the first match (lowest priority number) — mock that behaviour
      prisma.taxZone.findFirst.mockResolvedValue(
        makeZone({ id: 'zone-high', name: 'Metro', rate: 0.08, priority: 1 }),
      );

      const result = await service.calculateTax('LY', null, 100);

      expect(result.zone?.id).toBe('zone-high');
      expect(result.rate).toBe(0.08);
    });

    it('uses isDefault zone when no country match exists (§9.9 fallback)', async () => {
      prisma.taxZone.findFirst
        .mockResolvedValueOnce(null) // country match fails
        .mockResolvedValueOnce(makeZone({ id: 'zone-def', isDefault: true, rate: 0.15 }));

      const result = await service.calculateTax('ZZ', null, 200);

      // Verify that the second query used isDefault: true
      expect(prisma.taxZone.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.taxZone.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: expect.objectContaining({ isDefault: true }) }),
      );
      expect(result.rate).toBe(0.15);
    });

    it('treats unknown taxClassId gracefully — uses zone base rate', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0.05 }));
      prisma.taxClass.findUnique.mockResolvedValue(null); // class not found

      const result = await service.calculateTax('LY', 'nonexistent-class', 100);

      expect(result.rate).toBe(0.05);
      expect(result.amount).toBeCloseTo(5);
    });

    it('calculates correctly with isCompound = true (flag is surfaced in result)', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0.05, isCompound: true }));

      const result = await service.calculateTax('LY', null, 100);

      expect(result.zone?.isCompound).toBe(true);
      expect(result.amount).toBeCloseTo(5);
    });
  });

  /**
   * Rounding, which had no coverage at all and no implementation either.
   *
   * `taxAmount` was one unrounded IEEE-754 multiplication whose result
   * travelled straight into the order total. It was invisible because the
   * seeded zone was rated 0.0, so the product was always exactly zero.
   * 19 per cent makes half-millime ties systematic: any base ending in a
   * 50-millime step lands on one, because 0.19 × 0.050 = 0.0095.
   *
   * The rule is round-half-away-from-zero, matching what Postgres `numeric`
   * does on write, so the value the customer is shown and the value stored
   * are the same number rather than two numbers within half a millime.
   */
  describe('calculateTax rounding', () => {
    it('quantises to three decimals rather than returning a raw float', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone());

      const result = await service.calculateTax('LY', null, 1240.567);

      // 1240.567 × 0.19 = 235.70773 exactly; the millime is 235.708.
      expect(result.amount).toBe(235.708);
      expect(result.amount.toString()).not.toMatch(/\.\d{4}/);
    });

    it('rounds a half-millime tie away from zero, as Postgres numeric does', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0.5 }));

      // 0.001 × 0.5 = 0.0005, an exact tie at the millime.
      const result = await service.calculateTax('LY', null, 0.001);

      expect(result.amount).toBe(0.001);
    });

    it('does not accumulate binary float error across a realistic base', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone());

      const result = await service.calculateTax('LY', null, 0.1 + 0.2);

      // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754. Quantised, the tax on
      // it is the tax on 0.3, which is 0.057.
      expect(result.amount).toBe(0.057);
    });

    it('returns exactly zero rather than a signed or fractional zero', async () => {
      prisma.taxZone.findFirst.mockResolvedValue(makeZone({ rate: 0 }));

      const result = await service.calculateTax('LY', null, 1240.567);

      expect(result.amount).toBe(0);
      expect(Object.is(result.amount, -0)).toBe(false);
    });
  });

  // ── createZone ─────────────────────────────────────────────────────────────

  describe('createZone', () => {
    it('creates and returns the new zone', async () => {
      const zone = makeZone();
      prisma.taxZone.create.mockResolvedValue(zone);

      const result = await service.createZone({
        name: { default: 'Gulf', en: 'Gulf', fr: 'Golfe' },
        countries: ['AE'],
        rate: 0.05,
      });

      expect(prisma.taxZone.create).toHaveBeenCalled();
      expect(result).toEqual(zone);
    });
  });

  // ── updateZone ─────────────────────────────────────────────────────────────

  describe('updateZone', () => {
    it('throws NotFoundException when zone does not exist', async () => {
      prisma.taxZone.findUnique.mockResolvedValue(null);

      await expect(service.updateZone('bad-id', { rate: 0.1 })).rejects.toThrow(NotFoundException);
    });

    it('updates zone fields when found', async () => {
      prisma.taxZone.findUnique.mockResolvedValue(makeZone());
      prisma.taxZone.update.mockResolvedValue(makeZone({ rate: 0.1 }));

      const result = await service.updateZone('zone-1', { rate: 0.1 });

      expect(prisma.taxZone.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'zone-1' } }),
      );
      expect(result).toMatchObject({ rate: 0.1 });
    });
  });

  // ── createClass ────────────────────────────────────────────────────────────

  describe('createClass', () => {
    it('throws NotFoundException when zoneId does not exist', async () => {
      prisma.taxZone.findUnique.mockResolvedValue(null);

      await expect(
        service.createClass({ zoneId: 'bad-zone', name: 'Standard', rate: 0.05 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates class when zone exists', async () => {
      prisma.taxZone.findUnique.mockResolvedValue(makeZone());
      prisma.taxClass.create.mockResolvedValue(makeTaxClass());

      await service.createClass({ zoneId: 'zone-1', name: 'Standard', rate: 0.05 });

      expect(prisma.taxClass.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ zoneId: 'zone-1', name: 'Standard' }),
        }),
      );
    });
  });

  // ── listZones ──────────────────────────────────────────────────────────────

  describe('listZones', () => {
    it('returns paginated zones ordered by priority', async () => {
      prisma.taxZone.findMany.mockResolvedValue([makeZone()]);
      prisma.taxZone.count.mockResolvedValue(1);

      const result = await service.listZones({ page: 1, pageSize: 20 });

      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
      expect(result.data).toHaveLength(1);
      expect(prisma.taxZone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { priority: 'asc' } }),
      );
    });
  });

  // ── listClasses ────────────────────────────────────────────────────────────

  describe('listClasses', () => {
    it('filters by zoneId when provided', async () => {
      prisma.taxClass.findMany.mockResolvedValue([makeTaxClass()]);
      prisma.taxClass.count.mockResolvedValue(1);

      await service.listClasses({ zoneId: 'zone-1' });

      expect(prisma.taxClass.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { zoneId: 'zone-1' } }),
      );
    });

    it('returns all classes when no zoneId filter', async () => {
      prisma.taxClass.findMany.mockResolvedValue([makeTaxClass()]);
      prisma.taxClass.count.mockResolvedValue(1);

      await service.listClasses({});

      expect(prisma.taxClass.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });
});
