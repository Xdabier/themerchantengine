import { z } from 'zod';

export const globalSearchTypeSchema = z.enum(['product', 'order', 'customer', 'cms']);
export type GlobalSearchType = z.infer<typeof globalSearchTypeSchema>;

export const globalSearchHitSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  url: z.string(),
  thumbUrl: z.string().nullable().optional(),
});
export type GlobalSearchHit = z.infer<typeof globalSearchHitSchema>;

export const globalSearchGroupSchema = z.object({
  type: globalSearchTypeSchema,
  items: z.array(globalSearchHitSchema),
  total: z.number().int().nonnegative(),
});
export type GlobalSearchGroup = z.infer<typeof globalSearchGroupSchema>;

export const globalSearchResultSchema = z.object({
  groups: z.array(globalSearchGroupSchema),
  query: z.string(),
});
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

export const globalSearchQuerySchema = z.object({
  q: z.string().min(2),
  types: z.array(globalSearchTypeSchema).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;
