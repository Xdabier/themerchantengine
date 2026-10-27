import * as z from 'zod';
import { entityIdSchema, translatableSchema, type Translatable } from '@admin-types';

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export interface Category {
  id: string;
  name: Translatable;
  slug: string;
  description?: Translatable | null;
  parentId?: string | null;
  imageId?: string | null;
  sortOrder?: number;
  isVisible?: boolean;
  metaTitle?: Translatable | null;
  metaDescription?: Translatable | null;
  productCount?: number;
  children?: Category[];
}

export const categorySchema: z.ZodType<Category> = z.lazy(() =>
  z.object({
    id: entityIdSchema,
    name: translatableSchema,
    slug: slugSchema,
    description: translatableSchema.nullable().optional(),
    parentId: entityIdSchema.nullable().optional(),
    imageId: entityIdSchema.nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    isVisible: z.boolean().optional(),
    metaTitle: translatableSchema.nullable().optional(),
    metaDescription: translatableSchema.nullable().optional(),
    productCount: z.number().int().nonnegative().optional(),
    children: z.array(categorySchema).optional(),
  }),
);

export const createCategoryRequestSchema = z.object({
  name: translatableSchema,
  slug: slugSchema,
  description: translatableSchema.optional(),
  parentId: entityIdSchema.optional(),
  imageId: entityIdSchema.optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isVisible: z.boolean().optional(),
  metaTitle: translatableSchema.optional(),
  metaDescription: translatableSchema.optional(),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = createCategoryRequestSchema.partial();
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const reorderCategoriesRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: entityIdSchema,
        sortOrder: z.number().int().nonnegative(),
      }),
    )
    .nonempty(),
});
export type ReorderCategoriesRequest = z.infer<typeof reorderCategoriesRequestSchema>;
