import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CmsPageType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CmsService } from './cms.service';

// ── Factories ──────────────────────────────────────────────────────────────────

function makePage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'page-1',
    slug: '/about',
    type: CmsPageType.STATIC,
    title: { default: 'About Us', en: 'About Us' },
    content: { default: 'Learn more about our store.' },
    isPublished: true,
    metaTitle: { default: 'About' },
    metaDescription: { default: 'About our store' },
    sortOrder: 0,
    showInNavigation: true,
    template: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPrisma = {
  cmsPage: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};

// ─────────────────────────────────────────────────────────────────────────────

describe('CmsService', () => {
  let service: CmsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CmsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(CmsService);
  });

  // ── getPages ────────────────────────────────────────────────────────────────

  describe('getPages', () => {
    it('returns published pages ordered by sortOrder', async () => {
      const pages = [
        makePage({ slug: '/about', sortOrder: 0 }),
        makePage({ slug: '/contact', sortOrder: 1 }),
      ];
      mockPrisma.cmsPage.findMany.mockResolvedValueOnce(pages);

      const result = await service.getPages();

      expect(result).toEqual(pages);
      expect(mockPrisma.cmsPage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isPublished: true, deletedAt: null }),
          orderBy: { sortOrder: 'asc' },
        }),
      );
    });

    it('returns empty array when no published pages exist', async () => {
      mockPrisma.cmsPage.findMany.mockResolvedValueOnce([]);

      const result = await service.getPages();

      expect(result).toEqual([]);
    });
  });

  // ── getPageBySlug ──────────────────────────────────────────────────────────

  describe('getPageBySlug', () => {
    it('returns a published page by slug', async () => {
      const page = makePage();
      mockPrisma.cmsPage.findFirst.mockResolvedValueOnce(page);

      const result = await service.getPageBySlug('/about');

      expect(result).toEqual(page);
      expect(mockPrisma.cmsPage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ slug: '/about', isPublished: true }),
        }),
      );
    });

    it('throws NotFoundException for non-existent slug', async () => {
      mockPrisma.cmsPage.findFirst.mockResolvedValueOnce(null);

      await expect(service.getPageBySlug('/missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for unpublished page', async () => {
      mockPrisma.cmsPage.findFirst.mockResolvedValueOnce(null);

      await expect(service.getPageBySlug('/draft')).rejects.toThrow(NotFoundException);
    });
  });

  // ── adminGetPages ──────────────────────────────────────────────────────────

  describe('adminGetPages', () => {
    it('returns paginated pages (including unpublished)', async () => {
      const pages = [makePage(), makePage({ id: 'page-2', slug: '/contact' })];
      mockPrisma.cmsPage.count.mockResolvedValueOnce(2);
      mockPrisma.cmsPage.findMany.mockResolvedValueOnce(pages);

      const result = await service.adminGetPages(1, 20);

      expect(result.data).toEqual(pages);
      expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    });

    it('calculates skip correctly for pagination', async () => {
      mockPrisma.cmsPage.count.mockResolvedValueOnce(50);
      mockPrisma.cmsPage.findMany.mockResolvedValueOnce([]);

      await service.adminGetPages(3, 10);

      expect(mockPrisma.cmsPage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('excludes soft-deleted pages', async () => {
      mockPrisma.cmsPage.count.mockResolvedValueOnce(0);
      mockPrisma.cmsPage.findMany.mockResolvedValueOnce([]);

      await service.adminGetPages(1, 20);

      const call = mockPrisma.cmsPage.findMany.mock.calls[0][0];
      expect(call.where.deletedAt).toEqual(null);
    });
  });

  // ── createPage ─────────────────────────────────────────────────────────────

  describe('createPage', () => {
    it('creates a new page with provided fields', async () => {
      const page = makePage();
      mockPrisma.cmsPage.create.mockResolvedValueOnce(page);

      const result = await service.createPage({
        slug: '/about',
        type: CmsPageType.STATIC,
        title: { default: 'About Us' },
        content: { default: 'Learn more.' },
      });

      expect(result).toEqual(page);
      expect(mockPrisma.cmsPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: '/about',
            type: CmsPageType.STATIC,
          }),
        }),
      );
    });

    it('defaults isPublished to false and showInNavigation to false', async () => {
      const page = makePage({ isPublished: false, showInNavigation: false });
      mockPrisma.cmsPage.create.mockResolvedValueOnce(page);

      await service.createPage({
        slug: '/new',
        type: CmsPageType.STATIC,
        title: { default: 'New' },
        content: { default: 'Content' },
      });

      const data = mockPrisma.cmsPage.create.mock.calls[0][0].data;
      expect(data.isPublished).toBe(false);
      expect(data.showInNavigation).toBe(false);
    });

    it('defaults sortOrder to 0 and template to undefined', async () => {
      mockPrisma.cmsPage.create.mockResolvedValueOnce(makePage());

      await service.createPage({
        slug: '/test',
        type: CmsPageType.POLICY,
        title: { default: 'Test' },
        content: { default: 'Test content' },
      });

      const data = mockPrisma.cmsPage.create.mock.calls[0][0].data;
      expect(data.sortOrder).toBe(0);
      expect(data.template).toBeUndefined();
    });

    it('accepts optional metaTitle and metaDescription', async () => {
      mockPrisma.cmsPage.create.mockResolvedValueOnce(makePage());

      await service.createPage({
        slug: '/seo',
        type: CmsPageType.STATIC,
        title: { default: 'Title' },
        content: { default: 'Content' },
        metaTitle: { default: 'Meta Title' },
        metaDescription: { default: 'Meta Description' },
      });

      const data = mockPrisma.cmsPage.create.mock.calls[0][0].data;
      expect(data.metaTitle).toEqual({ default: 'Meta Title' });
      expect(data.metaDescription).toEqual({ default: 'Meta Description' });
    });
  });

  // ── updatePage ─────────────────────────────────────────────────────────────

  describe('updatePage', () => {
    it('throws NotFoundException when page does not exist', async () => {
      mockPrisma.cmsPage.findUnique.mockResolvedValueOnce(null);

      await expect(service.updatePage('missing', { title: { default: 'New' } })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates page fields', async () => {
      const page = makePage();
      const updated = makePage({ isPublished: true });
      mockPrisma.cmsPage.findUnique.mockResolvedValueOnce(page);
      mockPrisma.cmsPage.update.mockResolvedValueOnce(updated);

      const result = await service.updatePage('page-1', { isPublished: true });

      expect(result).toEqual(updated);
      expect(mockPrisma.cmsPage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'page-1' },
          data: expect.objectContaining({ isPublished: true }),
        }),
      );
    });

    it('only includes changed fields in update', async () => {
      mockPrisma.cmsPage.findUnique.mockResolvedValueOnce(makePage());
      mockPrisma.cmsPage.update.mockResolvedValueOnce(makePage());

      await service.updatePage('page-1', { sortOrder: 5 });

      const data = mockPrisma.cmsPage.update.mock.calls[0][0].data;
      expect(Object.keys(data)).toEqual(['sortOrder']);
    });

    it('clears metaDescription when set to undefined', async () => {
      mockPrisma.cmsPage.findUnique.mockResolvedValueOnce(makePage());
      mockPrisma.cmsPage.update.mockResolvedValueOnce(makePage());

      await service.updatePage('page-1', { metaDescription: undefined });

      // When undefined, the field should not be included
      const data = mockPrisma.cmsPage.update.mock.calls[0][0].data;
      expect('metaDescription' in data).toBe(false);
    });
  });

  // ── deletePage ─────────────────────────────────────────────────────────────

  describe('deletePage', () => {
    it('throws NotFoundException when page does not exist', async () => {
      mockPrisma.cmsPage.findUnique.mockResolvedValueOnce(null);

      await expect(service.deletePage('missing')).rejects.toThrow(NotFoundException);
    });

    it('soft-deletes by setting deletedAt', async () => {
      const page = makePage();
      mockPrisma.cmsPage.findUnique.mockResolvedValueOnce(page);
      mockPrisma.cmsPage.update.mockResolvedValueOnce({ ...page, deletedAt: new Date() });

      await service.deletePage('page-1');

      const data = mockPrisma.cmsPage.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
    });
  });
});
