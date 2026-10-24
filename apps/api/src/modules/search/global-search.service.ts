import { storeLocales } from '@common/locale';
import { resolveTranslatable } from '@common/interceptors';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { GlobalSearchDto, GlobalSearchType } from './dto/global-search.dto';
import { GLOBAL_SEARCH_TYPES } from './dto/global-search.dto';

export interface GlobalSearchHit {
  id: string;
  title: string;
  subtitle?: string | null;
  /** Deep-link path inside the admin app (e.g. "/orders/123"). */
  url: string;
  thumbUrl?: string | null;
}

export interface GlobalSearchGroup {
  type: GlobalSearchType;
  items: GlobalSearchHit[];
  total: number;
}

export interface GlobalSearchResult {
  groups: GlobalSearchGroup[];
  query: string;
}

@Injectable()
export class GlobalSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fan out a search term to every enabled entity type. We return
   * whichever hits Prisma finds — each entity has its own ILIKE
   * criteria, kept local so entity-specific rules (JSONB resolution
   * for products, order-number prefix match, etc.) stay close to
   * the data.
   */
  async search(dto: GlobalSearchDto): Promise<GlobalSearchResult> {
    const q = dto.q.trim();
    const limit = dto.limit ?? 5;
    const types = dto.types && dto.types.length > 0 ? dto.types : [...GLOBAL_SEARCH_TYPES];

    const groups = await Promise.all(types.map((type) => this.searchGroup(type, q, limit)));
    return { groups, query: q };
  }

  private async searchGroup(
    type: GlobalSearchType,
    q: string,
    limit: number,
  ): Promise<GlobalSearchGroup> {
    switch (type) {
      case 'product':
        return this.searchProducts(q, limit);
      case 'order':
        return this.searchOrders(q, limit);
      case 'customer':
        return this.searchCustomers(q, limit);
      case 'cms':
        return this.searchCms(q, limit);
      default:
        return { type, items: [], total: 0 };
    }
  }

  private async searchProducts(q: string, limit: number): Promise<GlobalSearchGroup> {
    const where = {
      deletedAt: null,
      OR: [
        { slug: { contains: q, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
        // JSONB string_agg is awkward through Prisma — fall back to slug
        // + SKU lookup, which covers operator workflows.
      ],
    } as never;
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          // Operators recognise a product by its SKU, not by its slug. Only the
          // default variant is needed for the hit subtitle.
          variants: {
            where: { isDefault: true, deletedAt: null },
            select: { sku: true },
            take: 1,
          },
        },
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      type: 'product',
      total,
      items: rows.map((r) => ({
        id: r.id,
        title: this.pickTranslatable(r.name) ?? r.slug,
        subtitle: this.joinSubtitle(
          r.variants?.[0]?.sku ?? `/${r.slug}`,
          this.statusLabel(r.status),
        ),
        url: `/products/${r.id}`,
      })),
    };
  }

  private async searchOrders(q: string, limit: number): Promise<GlobalSearchGroup> {
    const where = {
      OR: [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ],
    } as never;
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          user: { select: { email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      type: 'order',
      total,
      items: rows.map((r) => ({
        id: r.id,
        title: r.orderNumber ?? r.id,
        subtitle: this.joinSubtitle(r.user?.email ?? '—', this.statusLabel(r.status)),
        url: `/orders/${r.id}`,
      })),
    };
  }

  private async searchCustomers(q: string, limit: number): Promise<GlobalSearchGroup> {
    const where = {
      deletedAt: null,
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ],
    } as never;
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, email: true, firstName: true, lastName: true },
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      type: 'customer',
      total,
      items: rows.map((r) => ({
        id: r.id,
        title: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email,
        subtitle: r.email,
        url: `/customers/${r.id}`,
      })),
    };
  }

  private async searchCms(q: string, limit: number): Promise<GlobalSearchGroup> {
    const where = {
      OR: [{ slug: { contains: q, mode: 'insensitive' } }],
    } as never;
    const [rows, total] = await Promise.all([
      this.prisma.cmsPage.findMany({
        where,
        select: { id: true, slug: true, title: true },
        take: limit,
      }),
      this.prisma.cmsPage.count({ where }),
    ]);
    return {
      type: 'cms',
      total,
      items: rows.map((r) => ({
        id: r.id,
        title: this.pickTranslatable(r.title) ?? r.slug,
        subtitle: `/${r.slug}`,
        url: `/cms/${r.id}`,
      })),
    };
  }

  /** Joins the parts of a hit subtitle, dropping the ones that are empty. */
  private joinSubtitle(...parts: Array<string | null | undefined>): string {
    return parts.filter((p): p is string => !!p).join(' · ');
  }

  /**
   * Subtitles are read by operators, so enum codes never travel raw:
   * `DELIVERED` becomes `Delivered`. The admin has richer label maps, but a
   * subtitle is a display string by contract, composed here.
   */
  private statusLabel(status: unknown): string | null {
    if (typeof status !== 'string' || !status) return null;
    return status
      .toLowerCase()
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private pickTranslatable(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      // The shared chain (store default, then `default`), then any value at
      // all: an admin search hit must show something even for a bare row.
      const resolved = resolveTranslatable(value, storeLocales.current().defaultLocale);
      if (resolved) return resolved;
      const obj = value as Record<string, string | undefined>;
      return Object.values(obj).find((v) => !!v) ?? null;
    }
    return null;
  }
}
