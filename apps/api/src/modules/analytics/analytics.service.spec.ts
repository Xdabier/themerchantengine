import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';
import { MetaCapiService } from './services/meta-capi.service';
import { GaMpService } from './services/ga-mp.service';
import { ANALYTICS_EVENT_TYPES, ANALYTICS_FUNNEL_STEPS } from './analytics.constants';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  analyticsEvent: {
    create: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
  },
  order: {
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
  },
  orderItem: {
    findMany: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
  },
  storeSetting: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

const mockMetaCapi = { forwardPurchase: jest.fn() };
const mockGaMp = { forwardPurchase: jest.fn() };

// ── Factories ─────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-1',
    eventType: 'product_view',
    sessionId: 'sess-abc',
    userId: null,
    productId: 'prod-1',
    orderId: null,
    data: null,
    locale: 'en',
    createdAt: new Date('2026-03-01'),
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'user-1',
    total: new Prisma.Decimal('99.99'),
    status: OrderStatus.CONFIRMED,
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MetaCapiService, useValue: mockMetaCapi },
        { provide: GaMpService, useValue: mockGaMp },
      ],
    }).compile();

    service = module.get(AnalyticsService);
  });

  // ── ingestEvent ───────────────────────────────────────────────────────────

  describe('ingestEvent', () => {
    it('accepts page_view, which the storefront emits on every navigation', async () => {
      // Not in the enum before plan I phase I7, so the storefront's first
      // event of every session was a 400. The funnel constant is deliberately
      // left alone: a page view is not a funnel step.
      mockPrisma.analyticsEvent.create.mockResolvedValue({ id: 'evt-1', orderId: null } as never);

      await service.ingestEvent({ eventType: 'page_view', locale: 'fr' });

      expect(mockPrisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'page_view', locale: 'fr' }),
        }),
      );
    });

    it('keeps page_view out of the funnel, which measures intent to buy', () => {
      expect(ANALYTICS_FUNNEL_STEPS).not.toContain('page_view' as never);
      expect(ANALYTICS_EVENT_TYPES).toContain('page_view' as never);
    });

    it('persists a product_view event', async () => {
      mockPrisma.analyticsEvent.create.mockResolvedValue(makeEvent());

      await service.ingestEvent({
        eventType: 'product_view',
        sessionId: 'sess-abc',
        productId: 'prod-1',
        locale: 'en',
      });

      expect(mockPrisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'product_view', sessionId: 'sess-abc' }),
        }),
      );
    });

    it('does not call forwardPurchaseEvent for non-purchase events', async () => {
      mockPrisma.analyticsEvent.create.mockResolvedValue(makeEvent({ eventType: 'add_to_cart' }));

      await service.ingestEvent({ eventType: 'add_to_cart' });

      expect(mockPrisma.analyticsEvent.findUnique).not.toHaveBeenCalled();
    });

    it('triggers pixel forwarding on purchase event', async () => {
      const purchaseEvent = makeEvent({ eventType: 'purchase', orderId: 'ord-1' });
      mockPrisma.analyticsEvent.create.mockResolvedValue(purchaseEvent);
      mockPrisma.storeSetting.findUnique.mockResolvedValue({
        value: { metaPixelId: '123456' },
      });
      mockPrisma.analyticsEvent.findUnique.mockResolvedValue(purchaseEvent);
      mockMetaCapi.forwardPurchase.mockResolvedValue(undefined);

      await service.ingestEvent({ eventType: 'purchase', orderId: 'ord-1' });

      // Give the fire-and-forget microtask a tick to run
      await Promise.resolve();
      await Promise.resolve();

      expect(mockMetaCapi.forwardPurchase).toHaveBeenCalledWith(purchaseEvent, '123456');
    });
  });

  // ── getDashboard ──────────────────────────────────────────────────────────

  describe('getDashboard', () => {
    it('returns stats for today, thisWeek, and thisMonth', async () => {
      mockPrisma.order.aggregate.mockResolvedValue({
        _count: { id: 5 },
        _sum: { total: new Prisma.Decimal('500') },
      });
      mockPrisma.analyticsEvent.groupBy.mockResolvedValue([{ sessionId: 'a' }, { sessionId: 'b' }]);

      const result = await service.getDashboard();

      expect(result).toHaveProperty('today');
      expect(result).toHaveProperty('thisWeek');
      expect(result).toHaveProperty('thisMonth');
      expect(result.today.orders).toBe(5);
      expect(result.today.revenue).toBe(500);
      expect(result.today.uniqueSessions).toBe(2);
      expect(result.today.conversionRate).toBe(250);
    });

    it('returns zero conversionRate when there are no sessions', async () => {
      mockPrisma.order.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: { total: null },
      });
      mockPrisma.analyticsEvent.groupBy.mockResolvedValue([]);

      const result = await service.getDashboard();

      expect(result.today.conversionRate).toBe(0);
    });
  });

  // ── getFunnel ─────────────────────────────────────────────────────────────

  describe('getFunnel', () => {
    it('returns all 6 funnel steps with drop-off rates', async () => {
      // product_view=1000, add_to_cart=400, begin_checkout=200,
      // add_shipping_info=150, add_payment_info=120, purchase=100
      mockPrisma.analyticsEvent.count
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(400)
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(150)
        .mockResolvedValueOnce(120)
        .mockResolvedValueOnce(100);

      const result = await service.getFunnel({});

      expect((result as unknown[]).length).toBe(6);

      const steps = result as Array<{
        step: string;
        count: number;
        dropOffRate: number;
        overallConversionRate: number;
      }>;
      expect(steps[0]).toMatchObject({
        step: 'product_view',
        count: 1000,
        dropOffRate: 0,
        overallConversionRate: 100,
      });
      expect(steps[1]).toMatchObject({ step: 'add_to_cart', count: 400, dropOffRate: 60 });
      expect(steps[5]).toMatchObject({ step: 'purchase', count: 100, overallConversionRate: 10 });
    });

    it('applies date filter when from/to are provided', async () => {
      mockPrisma.analyticsEvent.count.mockResolvedValue(0);

      await service.getFunnel({ from: '2026-01-01', to: '2026-01-31' });

      expect(mockPrisma.analyticsEvent.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
          }),
        }),
      );
    });
  });

  // ── getProductAnalytics ───────────────────────────────────────────────────

  describe('getProductAnalytics', () => {
    it('returns product metrics with computed rates', async () => {
      mockPrisma.analyticsEvent.groupBy
        .mockResolvedValueOnce([{ productId: 'prod-1', _count: { id: 100 } }]) // views
        .mockResolvedValueOnce([{ productId: 'prod-1', _count: { id: 40 } }]) // carts
        .mockResolvedValueOnce([{ productId: 'prod-1', _count: { id: 10 } }]); // purchases
      mockPrisma.orderItem.findMany.mockResolvedValue([
        { productId: 'prod-1', total: new Prisma.Decimal('999.00') },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'prod-1', name: { default: 'Widget' }, slug: 'widget' },
      ]);

      const result = await service.getProductAnalytics({});

      const data = result as Array<Record<string, unknown>>;
      expect(data.length).toBe(1);
      expect(data[0]).toMatchObject({
        productId: 'prod-1',
        views: 100,
        carts: 40,
        purchases: 10,
        viewToCartRate: 40,
        conversionRate: 10,
        revenue: 999,
      });
    });

    it('returns empty array when no events exist', async () => {
      mockPrisma.analyticsEvent.groupBy.mockResolvedValue([]);
      mockPrisma.orderItem.findMany.mockResolvedValue([]);
      mockPrisma.product.findMany.mockResolvedValue([]);

      const result = await service.getProductAnalytics({});

      expect(result).toEqual([]);
    });
  });

  // ── getRevenueAnalytics ───────────────────────────────────────────────────

  describe('getRevenueAnalytics', () => {
    it('computes gross/net revenue and AOV', async () => {
      mockPrisma.order.aggregate
        .mockResolvedValueOnce({
          _count: { id: 4 },
          _sum: { total: new Prisma.Decimal('400'), discountAmount: new Prisma.Decimal('40') },
        })
        .mockResolvedValueOnce({ _sum: { total: new Prisma.Decimal('20') } });
      mockPrisma.analyticsEvent.groupBy.mockResolvedValue([
        { sessionId: 'a' },
        { sessionId: 'b' },
        { sessionId: 'c' },
        { sessionId: 'd' },
      ]);

      const result = await service.getRevenueAnalytics({});

      const data = result as Record<string, unknown>;
      expect(data.grossRevenue).toBe(400);
      expect(data.totalDiscounts).toBe(40);
      expect(data.totalRefunds).toBe(20);
      expect(data.netRevenue).toBe(340);
      expect(data.aov).toBe(100);
      expect(data.orderCount).toBe(4);
      expect(data.uniqueSessions).toBe(4);
      expect(data.revenuePerVisitor).toBe(100);
    });

    it('returns zeros when no orders exist', async () => {
      mockPrisma.order.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: { total: null, discountAmount: null },
      });
      mockPrisma.analyticsEvent.groupBy.mockResolvedValue([]);

      const result = await service.getRevenueAnalytics({});

      const data = result as Record<string, unknown>;
      expect(data.grossRevenue).toBe(0);
      expect(data.aov).toBe(0);
      expect(data.revenuePerVisitor).toBe(0);
    });
  });

  // ── getCustomerAnalytics ──────────────────────────────────────────────────

  describe('getCustomerAnalytics', () => {
    it('correctly splits new vs returning customers when from is provided', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makeOrder({ userId: 'u1' }),
        makeOrder({ userId: 'u2' }),
        makeOrder({ userId: 'u3' }),
      ]);
      // Only u2 had a prior order
      mockPrisma.order.groupBy.mockResolvedValue([{ userId: 'u2' }]);

      const result = await service.getCustomerAnalytics({ from: '2026-01-01' });

      const data = result as Record<string, unknown>;
      expect(data.totalCustomers).toBe(3);
      expect(data.returningCustomers).toBe(1);
      expect(data.newCustomers).toBe(2);
      expect(data.retentionRate).toBeCloseTo(33.33, 1);
    });

    it('treats all customers as returning when from is absent (no prior-order check)', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        makeOrder({ userId: 'u1' }),
        makeOrder({ userId: 'u2' }),
      ]);

      const result = await service.getCustomerAnalytics({});

      const data = result as Record<string, unknown>;
      expect(data.totalCustomers).toBe(2);
      expect(data.newCustomers).toBe(0);
      expect(data.returningCustomers).toBe(2);
    });
  });

  // ── getSearchAnalytics ────────────────────────────────────────────────────

  describe('getSearchAnalytics', () => {
    it('aggregates top search queries from events', async () => {
      mockPrisma.analyticsEvent.findMany.mockResolvedValue([
        { data: { query: 'shoes' } },
        { data: { query: 'shoes' } },
        { data: { query: 'hats' } },
        { data: { query: '' } }, // empty query — ignored
        { data: null }, // no data — ignored
      ]);

      const result = await service.getSearchAnalytics({});

      const data = result as Record<string, unknown>;
      expect(data.totalSearches).toBe(5);
      const topQueries = data.topQueries as Array<{ query: string; count: number }>;
      expect(topQueries[0]).toEqual({ query: 'shoes', count: 2 });
      expect(topQueries[1]).toEqual({ query: 'hats', count: 1 });
    });
  });

  // ── getPixels ─────────────────────────────────────────────────────────────

  describe('getPixels', () => {
    it('returns pixel config from StoreSetting', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue({
        value: { googleAnalyticsId: 'G-ABC123', metaPixelId: '9876' },
      });

      const result = await service.getPixels();

      expect(result).toEqual({ googleAnalyticsId: 'G-ABC123', metaPixelId: '9876' });
    });

    it('returns empty object when no setting exists', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue(null);

      const result = await service.getPixels();

      expect(result).toEqual({});
    });
  });

  // ── updatePixels ──────────────────────────────────────────────────────────

  describe('updatePixels', () => {
    it('merges new pixel values into existing config', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue({
        value: { googleAnalyticsId: 'G-OLD', metaPixelId: '9876' },
      });
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      const result = await service.updatePixels({ googleAnalyticsId: 'G-NEW' });

      expect(result.googleAnalyticsId).toBe('G-NEW');
      expect(result.metaPixelId).toBe('9876');
      expect(mockPrisma.storeSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { value: expect.objectContaining({ googleAnalyticsId: 'G-NEW' }) },
        }),
      );
    });

    it('removes a pixel when empty string is supplied', async () => {
      mockPrisma.storeSetting.findUnique.mockResolvedValue({
        value: { googleAnalyticsId: 'G-OLD', metaPixelId: '9876' },
      });
      mockPrisma.storeSetting.upsert.mockResolvedValue({});

      const result = await service.updatePixels({ metaPixelId: '' });

      expect(result).not.toHaveProperty('metaPixelId');
      expect(result.googleAnalyticsId).toBe('G-OLD');
    });
  });
});
