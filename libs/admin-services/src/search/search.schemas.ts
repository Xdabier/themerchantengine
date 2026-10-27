import * as z from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const MERCHANDISING_RULE_TYPES = ['BOOST', 'BURY', 'PIN', 'REDIRECT'] as const;
export type MerchandisingRuleType = (typeof MERCHANDISING_RULE_TYPES)[number];

export const analyticsQuerySchema = z.object({
  period: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type SearchAnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const paginationQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const synonymGroupSchema = z.object({
  id: entityIdSchema,
  terms: z.array(z.string()).min(2),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SynonymGroup = z.infer<typeof synonymGroupSchema>;

export const createSynonymRequestSchema = z.object({
  terms: z.array(z.string().max(100)).min(2),
});
export type CreateSynonymRequest = z.infer<typeof createSynonymRequestSchema>;

export const listSynonymsResponseSchema = z.object({
  data: z.array(synonymGroupSchema),
  meta: paginationMetaSchema,
});
export type ListSynonymsResponse = z.infer<typeof listSynonymsResponseSchema>;

export const merchandisingRuleSchema = z.object({
  id: entityIdSchema,
  type: z.enum(MERCHANDISING_RULE_TYPES),
  query: z.string().nullable(),
  productId: entityIdSchema.nullable(),
  // Readable target product resolved server-side (name is Translatable; admin
  // reads send X-Resolve-Locale:false so it arrives as the raw object). null
  // when the rule has no productId or the product was deleted.
  product: z
    .object({
      id: entityIdSchema,
      name: z.union([z.string(), translatableSchema]),
    })
    .nullable()
    .optional(),
  position: z.number().int().nonnegative().nullable(),
  priority: z.number().int().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MerchandisingRule = z.infer<typeof merchandisingRuleSchema>;

export const createMerchandisingRuleRequestSchema = z
  .object({
    type: z.enum(MERCHANDISING_RULE_TYPES),
    query: z.string().max(200).optional(),
    productId: entityIdSchema.optional(),
    position: z.number().int().nonnegative().optional(),
    priority: z.number().int().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((r) => r.type !== 'PIN' || r.position !== undefined, {
    message: 'PIN rules require a position',
    path: ['position'],
  })
  .refine(
    (r) => !(['BOOST', 'BURY', 'PIN'] as const).includes(r.type as never) || Boolean(r.productId),
    {
      message: 'Rule requires a productId',
      path: ['productId'],
    },
  );
export type CreateMerchandisingRuleRequest = z.infer<typeof createMerchandisingRuleRequestSchema>;

export const listMerchandisingResponseSchema = z.object({
  data: z.array(merchandisingRuleSchema),
  meta: paginationMetaSchema,
});
export type ListMerchandisingResponse = z.infer<typeof listMerchandisingResponseSchema>;

export const topQuerySchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  avgResults: z.number().int().nonnegative(),
});
export type TopQuery = z.infer<typeof topQuerySchema>;

export const zeroResultQuerySchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
});
export type ZeroResultQuery = z.infer<typeof zeroResultQuerySchema>;

export const searchOpsAnalyticsResponseSchema = z.object({
  topQueries: z.array(topQuerySchema),
  zeroResultQueries: z.array(zeroResultQuerySchema),
  conversionRate: z.number(),
  totalSearches: z.number().int().nonnegative(),
  period: z.number().int().positive(),
});
export type SearchOpsAnalyticsResponse = z.infer<typeof searchOpsAnalyticsResponseSchema>;

export const listZeroResultsResponseSchema = z.object({
  data: z.array(zeroResultQuerySchema),
  meta: paginationMetaSchema.extend({
    period: z.number().int().positive(),
  }),
});
export type ListZeroResultsResponse = z.infer<typeof listZeroResultsResponseSchema>;

export const reindexResultSchema = z.object({
  message: z.string(),
  reindexed: z.number().int().nonnegative(),
});
export type ReindexResult = z.infer<typeof reindexResultSchema>;
