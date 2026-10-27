import * as z from 'zod';
import { categorySchema, productSummarySchema } from '../shared/entities';

/**
 * Storefront categories schemas — list, detail by slug, paginated products
 * under a slug. The list endpoint returns a nested tree (categories with
 * `children`); detail returns the same shape without children. Mirrors
 * `apps/api/src/modules/categories/categories.controller.ts` storefront
 * routes.
 */

export const listCategoriesResponseSchema = z.array(categorySchema);

export const categoryDetailSchema = categorySchema;

export const listCategoryProductsQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).optional(),
});
export type ListCategoryProductsQuery = z.infer<typeof listCategoryProductsQuerySchema>;

export const listCategoryProductsResponseSchema = z.array(productSummarySchema);

export { categorySchema };
export type { Category } from '../shared/entities';
