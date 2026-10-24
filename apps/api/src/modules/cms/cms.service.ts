import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CmsPage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import { sanitizeTranslatableHtml } from '@common/utils';
import type { CreatePageAdminDto } from './dto/create-page.dto';
import type { UpdatePageAdminDto } from './dto/update-page.dto';

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CmsService {
  private readonly logger = new Logger(CmsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Storefront ──────────────────────────────────────────────────────────────

  /**
   * Returns all published pages, ordered by sortOrder.
   */
  async getPages(): Promise<CmsPage[]> {
    return this.prisma.cmsPage.findMany({
      where: { isPublished: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Returns a published page by slug.
   */
  async getPageBySlug(slug: string): Promise<CmsPage> {
    const page = await this.prisma.cmsPage.findFirst({
      where: { slug, isPublished: true, deletedAt: null },
    });

    if (!page) throw new NotFoundException(`CMS page "${slug}" not found`);
    return page;
  }

  // ── Admin ───────────────────────────────────────────────────────────────────

  /**
   * Returns all pages (including unpublished) for admin view.
   */
  async adminGetPages(page = 1, pageSize = 20): Promise<PaginatedResult<CmsPage>> {
    const skip = (page - 1) * pageSize;

    const [total, pages] = await Promise.all([
      this.prisma.cmsPage.count({ where: { deletedAt: null } }),
      this.prisma.cmsPage.findMany({
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        skip,
        take: pageSize,
      }),
    ]);

    return {
      data: pages,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /**
   * Creates a new CMS page.
   */
  async createPage(dto: CreatePageAdminDto): Promise<CmsPage> {
    return this.prisma.cmsPage.create({
      data: {
        slug: dto.slug,
        type: dto.type,
        title: dto.title as object,
        content: sanitizeTranslatableHtml(
          dto.content as unknown as Record<string, string>,
        ) as object,
        isPublished: dto.isPublished ?? false,
        metaTitle: dto.metaTitle ? (dto.metaTitle as object) : undefined,
        metaDescription: dto.metaDescription ? (dto.metaDescription as object) : undefined,
        sortOrder: dto.sortOrder ?? 0,
        showInNavigation: dto.showInNavigation ?? false,
        template: dto.template,
      },
    });
  }

  /**
   * Updates a CMS page. slug cannot be changed.
   */
  async updatePage(id: string, dto: UpdatePageAdminDto): Promise<CmsPage> {
    await this.findOrThrow(id);

    const updateData: Parameters<typeof this.prisma.cmsPage.update>[0]['data'] = {};

    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.title !== undefined) updateData.title = dto.title as object;
    if (dto.content !== undefined)
      updateData.content = sanitizeTranslatableHtml(
        dto.content as unknown as Record<string, string>,
      ) as object;
    if (dto.isPublished !== undefined) updateData.isPublished = dto.isPublished;
    if (dto.metaTitle !== undefined)
      updateData.metaTitle = dto.metaTitle ? (dto.metaTitle as object) : undefined;
    if (dto.metaDescription !== undefined)
      updateData.metaDescription = dto.metaDescription
        ? (dto.metaDescription as object)
        : undefined;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.showInNavigation !== undefined) updateData.showInNavigation = dto.showInNavigation;
    if (dto.template !== undefined) updateData.template = dto.template;

    return this.prisma.cmsPage.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Soft-deletes a CMS page.
   */
  async deletePage(id: string): Promise<void> {
    await this.findOrThrow(id);

    await this.prisma.cmsPage.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async findOrThrow(id: string): Promise<CmsPage> {
    const page = await this.prisma.cmsPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException(`CmsPage "${id}" not found`);
    return page;
  }
}
