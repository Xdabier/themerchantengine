import { z } from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

/**
 * Mirror of Prisma `enum CmsPageType` — keep in sync with prisma/schema.prisma.
 */
export const cmsPageTypeSchema = z.enum(['STATIC', 'POLICY', 'LANDING']);
export type CmsPageType = z.infer<typeof cmsPageTypeSchema>;

export const cmsPageSchema = z.object({
  id: entityIdSchema,
  slug: z.string(),
  type: cmsPageTypeSchema,
  title: translatableSchema,
  content: translatableSchema,
  isPublished: z.boolean(),
  metaTitle: translatableSchema.nullable().optional(),
  metaDescription: translatableSchema.nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
  showInNavigation: z.boolean(),
  template: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type CmsPage = z.infer<typeof cmsPageSchema>;

export const listPagesQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type ListPagesQuery = z.infer<typeof listPagesQuerySchema>;

export const listPagesResponseSchema = z.object({
  data: z.array(cmsPageSchema),
  meta: paginationMetaSchema,
});
export type ListPagesResponse = z.infer<typeof listPagesResponseSchema>;

export const createPageRequestSchema = z.object({
  slug: z
    .string()
    .regex(/^(?:\/[a-z0-9-]+)+$/, {
      message:
        'Slug must be one or more "/"-prefixed segments of lowercase letters, digits, and hyphens',
    })
    .max(200),
  type: cmsPageTypeSchema,
  title: translatableSchema,
  content: translatableSchema,
  isPublished: z.boolean().optional(),
  metaTitle: translatableSchema.optional(),
  metaDescription: translatableSchema.optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  showInNavigation: z.boolean().optional(),
  template: z.string().max(100).optional(),
});
export type CreatePageRequest = z.infer<typeof createPageRequestSchema>;

export const updatePageRequestSchema = createPageRequestSchema.omit({ slug: true }).partial();
export type UpdatePageRequest = z.infer<typeof updatePageRequestSchema>;
