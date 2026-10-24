import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ANALYTICS_FUNNEL_STEPS,
  ANALYTICS_PIXELS_GROUP,
  ANALYTICS_PIXELS_KEY,
  ANALYTICS_SEARCH_FETCH_LIMIT,
  ANALYTICS_TOP_PRODUCTS_COUNT,
  ANALYTICS_TOP_QUERIES_COUNT,
} from './analytics.constants';
import type {
  AnalyticsDateQueryDto,
  IngestEventDto,
  TimeseriesGranularity,
  TimeseriesMetric,
  TimeseriesQueryDto,
  UpdatePixelsAdminDto,
} from './dto';
import { MetaCapiService } from './services/meta-capi.service';
import { GaMpService } from './services/ga-mp.service';
import { roundMoney, sumMoney } from '@common/money';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PixelConfig {
  googleAnalyticsId?: string;
  metaPixelId?: string;
  tiktokPixelId?: string;
  snapPixelId?: string;
}

export interface PeriodStats {
  orders: number;
  revenue: number;
  uniqueSessions: number;
  conversionRate: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaCapi: MetaCapiService,
    private readonly gaMp: GaMpService,
  ) {}

  // ── Event ingestion ───────────────────────────────────────────────────────

  /** Persist a storefront analytics event. Triggers server-side forwarding on purchase. */
  async ingestEvent(dto: IngestEventDto): Promise<void> {
    const event = await this.prisma.analyticsEvent.create({
      data: {
        eventType: dto.eventType,
        sessionId: dto.sessionId ?? null,
        userId: dto.userId ?? null,
        productId: dto.productId ?? null,
        orderId: dto.orderId ?? null,
        data: (dto.data as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        locale: dto.locale ?? null,
      },
    });

    if (dto.eventType === 'purchase') {
      // Fire-and-forget; forwarding errors must not fail the ingestion response
      this.forwardPurchaseEvent(event.id, event.orderId).catch((err: unknown) => {
        this.logger.error({ msg: 'Purchase forwarding failed', eventId: event.id, err });
      });
    }
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /** Returns order + session overview for today, this week, and this month. */
  async getDashboard(): Promise<{
    today: PeriodStats;
    thisWeek: PeriodStats;
    thisMonth: PeriodStats;
  }> {
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [today, thisWeek, thisMonth] = await Promise.all([
      this.getPeriodStats(todayStart, now),
      this.getPeriodStats(weekStart, now),
      this.getPeriodStats(monthStart, now),
    ]);

    return { today, thisWeek, thisMonth };
  }

  private async getPeriodStats(from: Date, to: Date): Promise<PeriodStats> {
    const dateFilter = { gte: from, lte: to };

    const [orderAgg, sessionGroups] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          createdAt: dateFilter,
          status: { notIn: [OrderStatus.CANCELLED] },
        },
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['sessionId'],
        where: { createdAt: dateFilter, sessionId: { not: null } },
      }),
    ]);

    const orders = orderAgg._count.id;
    const revenue = Number(orderAgg._sum.total ?? 0);
    const uniqueSessions = sessionGroups.length;
    const conversionRate = uniqueSessions > 0 ? +((orders / uniqueSessions) * 100).toFixed(2) : 0;

    return { orders, revenue, uniqueSessions, conversionRate };
  }

  // ── Funnel ────────────────────────────────────────────────────────────────

  /** Returns event counts and drop-off rates for each funnel step. */
  async getFunnel(dto: AnalyticsDateQueryDto): Promise<unknown[]> {
    const where = this.buildEventDateFilter(dto);

    const counts = await Promise.all(
      ANALYTICS_FUNNEL_STEPS.map((eventType) =>
        this.prisma.analyticsEvent.count({ where: { ...where, eventType } }),
      ),
    );

    const firstCount = counts[0] ?? 0;

    const data = ANALYTICS_FUNNEL_STEPS.map((step, i) => {
      const count = counts[i];
      const prev = i > 0 ? counts[i - 1] : count;
      const dropOffRate = prev > 0 ? +((1 - count / prev) * 100).toFixed(2) : 0;
      const overallConversionRate = firstCount > 0 ? +((count / firstCount) * 100).toFixed(2) : 0;
      return { step, count, dropOffRate, overallConversionRate };
    });

    return data;
  }

  // ── Product analytics ─────────────────────────────────────────────────────

  /** Returns per-product view/cart/purchase counts, rates, and revenue. */
  async getProductAnalytics(dto: AnalyticsDateQueryDto): Promise<unknown[]> {
    const where = this.buildEventDateFilter(dto);
    const orderDateFilter = this.buildOrderDateFilter(dto);

    const [views, carts, purchases, revenueItems] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ['productId'],
        where: { ...where, eventType: 'product_view', productId: { not: null } },
        _count: { id: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['productId'],
        where: { ...where, eventType: 'add_to_cart', productId: { not: null } },
        _count: { id: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['productId'],
        where: { ...where, eventType: 'purchase', productId: { not: null } },
        _count: { id: true },
      }),
      this.prisma.orderItem.findMany({
        where: {
          productId: { not: null },
          ...(orderDateFilter && { order: { createdAt: orderDateFilter } }),
        },
        select: { productId: true, total: true },
      }),
    ]);

    const viewMap = new Map(views.map((v) => [v.productId, v._count.id]));
    const cartMap = new Map(carts.map((v) => [v.productId, v._count.id]));
    const purchaseMap = new Map(purchases.map((v) => [v.productId, v._count.id]));

    const revenueMap = new Map<string, number>();
    revenueItems.forEach((item) => {
      if (item.productId) {
        revenueMap.set(item.productId, (revenueMap.get(item.productId) ?? 0) + Number(item.total));
      }
    });

    // Union of all productIds seen in events
    const productIds = [
      ...new Set([...viewMap.keys(), ...cartMap.keys(), ...purchaseMap.keys()]),
    ].filter(Boolean) as string[];

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds.slice(0, ANALYTICS_TOP_PRODUCTS_COUNT) } },
      select: { id: true, name: true, slug: true },
    });

    const data = products
      .map((p) => {
        const viewCount = viewMap.get(p.id) ?? 0;
        const cartCount = cartMap.get(p.id) ?? 0;
        const purchaseCount = purchaseMap.get(p.id) ?? 0;
        const revenue = revenueMap.get(p.id) ?? 0;
        return {
          productId: p.id,
          name: p.name,
          slug: p.slug,
          views: viewCount,
          carts: cartCount,
          purchases: purchaseCount,
          viewToCartRate: viewCount > 0 ? +((cartCount / viewCount) * 100).toFixed(2) : 0,
          conversionRate: viewCount > 0 ? +((purchaseCount / viewCount) * 100).toFixed(2) : 0,
          revenue,
        };
      })
      .sort((a, b) => b.views - a.views);

    return data;
  }

  // ── Revenue analytics ─────────────────────────────────────────────────────

  /** Returns gross/net revenue, AOV, revenue-per-visitor, and order count. */
  async getRevenueAnalytics(dto: AnalyticsDateQueryDto): Promise<unknown> {
    const orderDateFilter = this.buildOrderDateFilter(dto);
    const eventDateFilter = this.buildEventDateFilter(dto);

    const [orderAgg, refundAgg, sessionGroups] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          ...(orderDateFilter && { createdAt: orderDateFilter }),
          status: { notIn: [OrderStatus.CANCELLED] },
        },
        _count: { id: true },
        _sum: { total: true, discountAmount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          ...(orderDateFilter && { createdAt: orderDateFilter }),
          paymentStatus: { in: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] },
        },
        _sum: { total: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['sessionId'],
        where: { ...eventDateFilter, sessionId: { not: null } },
      }),
    ]);

    const grossRevenue = Number(orderAgg._sum.total ?? 0);
    const totalDiscounts = Number(orderAgg._sum.discountAmount ?? 0);
    const totalRefunds = Number(refundAgg._sum.total ?? 0);
    const netRevenue = roundMoney(grossRevenue - totalDiscounts - totalRefunds);
    const orderCount = orderAgg._count.id;
    const aov = orderCount > 0 ? roundMoney(grossRevenue / orderCount) : 0;
    const uniqueSessions = sessionGroups.length;
    const revenuePerVisitor = uniqueSessions > 0 ? roundMoney(grossRevenue / uniqueSessions) : 0;

    return {
      grossRevenue,
      netRevenue,
      totalDiscounts,
      totalRefunds,
      orderCount,
      aov,
      uniqueSessions,
      revenuePerVisitor,
    };
  }

  // ── Customer analytics ────────────────────────────────────────────────────

  /** Returns customer counts, new-vs-returning split, and average revenue. */
  async getCustomerAnalytics(dto: AnalyticsDateQueryDto): Promise<unknown> {
    const orderDateFilter = this.buildOrderDateFilter(dto);

    const orders = await this.prisma.order.findMany({
      where: {
        ...(orderDateFilter && { createdAt: orderDateFilter }),
        status: { notIn: [OrderStatus.CANCELLED] },
        userId: { not: null },
      },
      select: { userId: true, total: true },
    });

    const customerIds = [...new Set(orders.map((o) => o.userId!))];

    // Identify returning customers — those with at least one order BEFORE the
    // period start. If no `from` is provided we cannot distinguish, so all are
    // treated as returning to avoid false "new" counts.
    let returningSet = new Set<string>(customerIds);
    if (dto.from) {
      const periodStart = new Date(dto.from);
      const priorGroups = await this.prisma.order.groupBy({
        by: ['userId'],
        where: {
          userId: { in: customerIds, not: null },
          status: { notIn: [OrderStatus.CANCELLED] },
          createdAt: { lt: periodStart },
        },
      });
      returningSet = new Set(priorGroups.map((g) => g.userId!));
    }

    const totalCustomers = customerIds.length;
    const returningCustomers = [...returningSet].filter((id) => customerIds.includes(id)).length;
    const newCustomers = totalCustomers - returningCustomers;

    const totalRevenue = sumMoney(orders.map((o) => Number(o.total)));
    const avgCustomerRevenue = totalCustomers > 0 ? roundMoney(totalRevenue / totalCustomers) : 0;

    return {
      totalCustomers,
      newCustomers,
      returningCustomers,
      retentionRate:
        totalCustomers > 0 ? +((returningCustomers / totalCustomers) * 100).toFixed(2) : 0,
      avgCustomerRevenue,
    };
  }

  // ── Search analytics ──────────────────────────────────────────────────────

  /** Returns total search count and top query terms from search events. */
  async getSearchAnalytics(dto: AnalyticsDateQueryDto): Promise<unknown> {
    const where = this.buildEventDateFilter(dto);

    const events = await this.prisma.analyticsEvent.findMany({
      where: { ...where, eventType: 'search' },
      select: { data: true },
      orderBy: { createdAt: 'desc' },
      take: ANALYTICS_SEARCH_FETCH_LIMIT,
    });

    const queryCounts = new Map<string, number>();
    events.forEach((e) => {
      if (e.data && typeof e.data === 'object' && !Array.isArray(e.data)) {
        const query = (e.data as Record<string, unknown>)['query'];
        if (typeof query === 'string' && query.length > 0) {
          queryCounts.set(query, (queryCounts.get(query) ?? 0) + 1);
        }
      }
    });

    const topQueries = [...queryCounts.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, ANALYTICS_TOP_QUERIES_COUNT);

    return { totalSearches: events.length, topQueries };
  }

  // ── Pixel management ──────────────────────────────────────────────────────

  /** Returns the current pixel configuration from StoreSetting. */
  async getPixels(): Promise<PixelConfig> {
    const setting = await this.prisma.storeSetting.findUnique({
      where: { group_key: { group: ANALYTICS_PIXELS_GROUP, key: ANALYTICS_PIXELS_KEY } },
    });
    return (setting?.value as PixelConfig) ?? {};
  }

  /** Merges the provided pixel IDs into the stored configuration and persists. */
  async updatePixels(dto: UpdatePixelsAdminDto): Promise<PixelConfig> {
    const current = await this.getPixels();
    // Merge — omit keys explicitly set to empty string to allow clearing
    const updated: PixelConfig = { ...current };
    for (const key of Object.keys(dto) as (keyof UpdatePixelsAdminDto)[]) {
      const val = dto[key];
      if (val === '') {
        delete updated[key as keyof PixelConfig];
      } else if (val !== undefined) {
        (updated as Record<string, unknown>)[key] = val;
      }
    }

    await this.prisma.storeSetting.upsert({
      where: { group_key: { group: ANALYTICS_PIXELS_GROUP, key: ANALYTICS_PIXELS_KEY } },
      create: { group: ANALYTICS_PIXELS_GROUP, key: ANALYTICS_PIXELS_KEY, value: updated },
      update: { value: updated },
    });

    return updated;
  }

  // ── Time series ───────────────────────────────────────────────────────────

  /**
   * Bucketed time series for dashboard sparklines and trend charts.
   *
   * `from`/`to` default to the last 30 days. Granularity defaults to `day`
   * (`week` for windows > 90 days, `hour` for windows ≤ 48 hours). Every
   * bucket in the window is returned — zero-count buckets emit `value: 0`
   * so the client can render a continuous line without gap stitching.
   *
   * Aggregation is done in JS because the project bans raw SQL
   * (CLAUDE.md §Database). For < ~50k rows this is trivial; if windows
   * exceed that, push aggregation into a materialised view.
   */
  async getTimeseries(dto: TimeseriesQueryDto): Promise<{
    metric: TimeseriesMetric;
    granularity: TimeseriesGranularity;
    from: string;
    to: string;
    buckets: Array<{ bucket: string; value: number }>;
  }> {
    let to = dto.to ? new Date(dto.to) : new Date();
    let from = dto.from ? new Date(dto.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (from > to) {
      // Silently swap rather than 400 — consumer sparklines shouldn't crash
      // on date pickers that allow a reversed range.
      const tmp = from;
      from = to;
      to = tmp;
    }

    const granularity =
      dto.granularity ??
      (to.getTime() - from.getTime() <= 48 * 60 * 60 * 1000
        ? 'hour'
        : to.getTime() - from.getTime() <= 90 * 24 * 60 * 60 * 1000
          ? 'day'
          : 'week');

    const buckets = this.enumerateBuckets(from, to, granularity);
    const byBucket = new Map<string, number>(buckets.map((b) => [b, 0]));

    if (dto.metric === 'orders' || dto.metric === 'revenue') {
      const orders = await this.prisma.order.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          // Only count orders that represent real revenue.
          status: { notIn: [OrderStatus.CANCELLED] },
          paymentStatus: { notIn: [PaymentStatus.FAILED] },
        },
        select: { createdAt: true, total: true },
      });
      for (const order of orders) {
        const key = this.bucketKey(order.createdAt, granularity);
        if (!byBucket.has(key)) continue;
        const prev = byBucket.get(key) ?? 0;
        const next = dto.metric === 'orders' ? prev + 1 : prev + Number(order.total.toString());
        byBucket.set(key, next);
      }
    } else {
      // sessions: distinct sessionId per bucket. Pull (createdAt, sessionId)
      // and fold into a Set per bucket before counting cardinality.
      const events = await this.prisma.analyticsEvent.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          sessionId: { not: null },
        },
        select: { createdAt: true, sessionId: true },
      });
      const sessionsPerBucket = new Map<string, Set<string>>();
      for (const ev of events) {
        const key = this.bucketKey(ev.createdAt, granularity);
        if (!byBucket.has(key) || !ev.sessionId) continue;
        const set = sessionsPerBucket.get(key) ?? new Set<string>();
        set.add(ev.sessionId);
        sessionsPerBucket.set(key, set);
      }
      for (const [key, set] of sessionsPerBucket) {
        byBucket.set(key, set.size);
      }
    }

    return {
      metric: dto.metric,
      granularity,
      from: from.toISOString(),
      to: to.toISOString(),
      buckets: buckets.map((b) => ({ bucket: b, value: byBucket.get(b) ?? 0 })),
    };
  }

  /** UTC-midnight floor for `day`, UTC Sunday for `week`, :00:00 for `hour`. */
  private bucketKey(ts: Date, granularity: TimeseriesGranularity): string {
    const date = new Date(ts);
    if (granularity === 'hour') {
      date.setUTCMinutes(0, 0, 0);
    } else if (granularity === 'day') {
      date.setUTCHours(0, 0, 0, 0);
    } else {
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    }
    return date.toISOString();
  }

  private enumerateBuckets(from: Date, to: Date, granularity: TimeseriesGranularity): string[] {
    const step =
      granularity === 'hour'
        ? 60 * 60 * 1000
        : granularity === 'day'
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
    const cursor = new Date(this.bucketKey(from, granularity));
    const endKey = this.bucketKey(to, granularity);
    const keys: string[] = [];
    // Hard cap at ~2000 buckets to guard against pathological windows.
    for (let i = 0; i < 2000; i += 1) {
      const key = cursor.toISOString();
      keys.push(key);
      if (key === endKey) break;
      cursor.setTime(cursor.getTime() + step);
    }
    return keys;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private buildEventDateFilter(dto: AnalyticsDateQueryDto): Prisma.AnalyticsEventWhereInput {
    if (!dto.from && !dto.to) return {};
    return {
      createdAt: {
        ...(dto.from && { gte: new Date(dto.from) }),
        ...(dto.to && { lte: new Date(dto.to) }),
      },
    };
  }

  private buildOrderDateFilter(
    dto: AnalyticsDateQueryDto,
  ): Prisma.DateTimeFilter<'Order'> | undefined {
    if (!dto.from && !dto.to) return undefined;
    return {
      ...(dto.from && { gte: new Date(dto.from) }),
      ...(dto.to && { lte: new Date(dto.to) }),
    };
  }

  private async forwardPurchaseEvent(eventId: string, orderId: string | null): Promise<void> {
    const pixels = await this.getPixels();

    const event = await this.prisma.analyticsEvent.findUnique({ where: { id: eventId } });
    if (!event) return;

    if (pixels.metaPixelId) {
      await this.metaCapi.forwardPurchase(event, pixels.metaPixelId);
    }
    if (pixels.googleAnalyticsId) {
      await this.gaMp.forwardPurchase(event, pixels.googleAnalyticsId);
    }

    if (!pixels.metaPixelId && !pixels.googleAnalyticsId) {
      this.logger.debug({
        msg: 'Purchase event: no pixels configured, skipping forwarding',
        eventId,
        orderId,
      });
    }
  }
}
