import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalSearchService } from './global-search.service';

function makePrismaMock() {
  return {
    product: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    cmsPage: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

describe('GlobalSearchService', () => {
  let service: GlobalSearchService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalSearchService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(GlobalSearchService);
  });

  it('fans out to all entity types by default', async () => {
    const res = await service.search({ q: 'shoe' });
    expect(res.groups.map((g) => g.type)).toEqual(['product', 'order', 'customer', 'cms']);
    expect(prisma.product.findMany).toHaveBeenCalled();
    expect(prisma.order.findMany).toHaveBeenCalled();
    expect(prisma.user.findMany).toHaveBeenCalled();
    expect(prisma.cmsPage.findMany).toHaveBeenCalled();
  });

  it('restricts to selected types when `types` passed', async () => {
    await service.search({ q: 'ada', types: ['customer'] });
    expect(prisma.user.findMany).toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('returns hits shaped for the admin overlay', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      { id: 'p1', slug: 'sneaker', name: { en: 'Sneaker', default: 'Sneaker' } },
    ]);
    prisma.product.count.mockResolvedValueOnce(1);
    const res = await service.search({ q: 'sneak', types: ['product'] });
    expect(res.groups[0].items[0]).toEqual({
      id: 'p1',
      title: 'Sneaker',
      subtitle: '/sneaker',
      url: '/products/p1',
    });
  });

  it('subtitles a product with its default SKU and a readable status', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        slug: 'sneaker',
        name: { en: 'Sneaker' },
        status: 'ACTIVE',
        variants: [{ sku: 'SHOE-URB-42' }],
      },
    ]);
    prisma.product.count.mockResolvedValueOnce(1);
    const res = await service.search({ q: 'sneak', types: ['product'] });
    expect(res.groups[0].items[0].subtitle).toBe('SHOE-URB-42 · Active');
  });

  it('falls back to the slug when a product has no default variant', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      { id: 'p1', slug: 'sneaker', name: { en: 'Sneaker' }, status: 'DRAFT', variants: [] },
    ]);
    prisma.product.count.mockResolvedValueOnce(1);
    const res = await service.search({ q: 'sneak', types: ['product'] });
    expect(res.groups[0].items[0].subtitle).toBe('/sneaker · Draft');
  });

  it('humanizes the order status in the order subtitle', async () => {
    prisma.order.findMany.mockResolvedValueOnce([
      {
        id: 'o1',
        orderNumber: 'ORD-1',
        status: 'DELIVERED',
        user: { email: 'ada@example.com' },
      },
    ]);
    prisma.order.count.mockResolvedValueOnce(1);
    const res = await service.search({ q: 'ord', types: ['order'] });
    expect(res.groups[0].items[0].subtitle).toBe('ada@example.com · Delivered');
    expect(res.groups[0].items[0].subtitle).not.toContain('DELIVERED');
  });

  it('falls back to slug when Translatable name is empty', async () => {
    prisma.product.findMany.mockResolvedValueOnce([{ id: 'p1', slug: 'sneaker', name: {} }]);
    prisma.product.count.mockResolvedValueOnce(1);
    const res = await service.search({ q: 'sneak', types: ['product'] });
    expect(res.groups[0].items[0].title).toBe('sneaker');
  });

  it('customer hit falls back to email when name is empty', async () => {
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'u1', email: 'ada@example.com', firstName: null, lastName: null },
    ]);
    prisma.user.count.mockResolvedValueOnce(1);
    const res = await service.search({ q: 'ada', types: ['customer'] });
    expect(res.groups[0].items[0].title).toBe('ada@example.com');
  });
});
