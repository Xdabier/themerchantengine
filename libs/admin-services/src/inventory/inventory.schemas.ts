import * as z from 'zod';
import { entityIdSchema, paginationMetaSchema, translatableSchema } from '@admin-types';

export const stockStatusSchema = z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']);
export type StockStatus = z.infer<typeof stockStatusSchema>;

export const adjustmentReasonSchema = z.enum([
  'RECOUNT',
  'DAMAGE',
  'SHRINKAGE',
  'RECEIVED',
  'RETURN_RESTOCK',
  'RETURN_DAMAGED',
  'CORRECTION',
  'OTHER',
]);
export type AdjustmentReason = z.infer<typeof adjustmentReasonSchema>;

export const movementTypeSchema = z.enum([
  'SALE',
  'RETURN',
  'ADJUSTMENT',
  'TRANSFER',
  'RESERVATION',
  'RESERVATION_RELEASE',
]);
export type MovementType = z.infer<typeof movementTypeSchema>;

export const stockLevelSchema = z
  .object({
    id: entityIdSchema,
    variantId: entityIdSchema,
    locationId: entityIdSchema,
    onHand: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative().optional(),
    available: z.number().int().optional(),
    lowStockThreshold: z.number().int().nonnegative().optional(),
    status: stockStatusSchema.optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
    location: z
      .object({
        id: entityIdSchema,
        name: z.string(),
        code: z.string(),
      })
      .optional(),
    variant: z
      .object({
        id: entityIdSchema,
        sku: z.string(),
        productId: entityIdSchema.optional(),
        // Lenient on the joined shape for the same reason `productSchema`'s
        // categories key is: this feeds a link, and a shape the parse does not
        // recognise should cost the link, not the whole screen.
        product: z
          .object({ id: entityIdSchema, name: translatableSchema })
          .nullable()
          .optional()
          .catch(undefined),
      })
      .optional(),
  })
  .passthrough();
export type StockLevel = z.infer<typeof stockLevelSchema>;

export const locationSchema = z
  .object({
    id: entityIdSchema,
    name: z.string(),
    code: z.string(),
    isActive: z.boolean().optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .passthrough();
export type InventoryLocation = z.infer<typeof locationSchema>;

export const movementSchema = z
  .object({
    id: entityIdSchema,
    variantId: entityIdSchema,
    locationId: entityIdSchema,
    type: movementTypeSchema,
    quantity: z.number().int(),
    reason: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    referenceType: z.string().nullable().optional(),
    referenceId: z.string().nullable().optional(),
    performedBy: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
    location: z
      .object({
        id: entityIdSchema,
        name: z.string(),
        code: z.string(),
      })
      .optional(),
    variant: z
      .object({
        id: entityIdSchema,
        sku: z.string(),
        productId: entityIdSchema.optional(),
        // Lenient on the joined shape for the same reason `productSchema`'s
        // categories key is: this feeds a link, and a shape the parse does not
        // recognise should cost the link, not the whole screen.
        product: z
          .object({ id: entityIdSchema, name: translatableSchema })
          .nullable()
          .optional()
          .catch(undefined),
      })
      .optional(),
  })
  .passthrough();
export type StockMovement = z.infer<typeof movementSchema>;

export const listStockLevelsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  variantId: entityIdSchema.optional(),
  locationId: entityIdSchema.optional(),
  stockStatus: stockStatusSchema.optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type ListStockLevelsQuery = z.infer<typeof listStockLevelsQuerySchema>;

export const listStockLevelsResponseSchema = z.object({
  data: z.array(stockLevelSchema),
  meta: paginationMetaSchema,
});
export type ListStockLevelsResponse = z.infer<typeof listStockLevelsResponseSchema>;

export const listMovementsQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  variantId: entityIdSchema.optional(),
  locationId: entityIdSchema.optional(),
  type: movementTypeSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

export const listMovementsResponseSchema = z.object({
  data: z.array(movementSchema),
  meta: paginationMetaSchema,
});
export type ListMovementsResponse = z.infer<typeof listMovementsResponseSchema>;

export const listLocationsResponseSchema = z.object({
  data: z.array(locationSchema),
  meta: paginationMetaSchema,
});
export type ListLocationsResponse = z.infer<typeof listLocationsResponseSchema>;

/**
 * Adjust accepts exactly one of two modes.
 *
 * DELTA (`quantity`) is the original signed change. SET (`setTo` plus
 * `expectedOnHand`) is a compare-and-set for an operator who counted a shelf
 * and thinks in totals: computing the delta on the client would be a lost
 * update, since two operators both reading 20 and both setting 25 would each
 * send +5 and land at 30.
 *
 * The refinement mirrors the server rule rather than trusting it, so an
 * impossible body fails before the request leaves the browser.
 */
export const adjustInventoryRequestSchema = z
  .object({
    variantId: entityIdSchema,
    locationId: entityIdSchema,
    quantity: z.number().int().optional(),
    setTo: z.number().int().nonnegative().optional(),
    expectedOnHand: z.number().int().nonnegative().optional(),
    reason: adjustmentReasonSchema,
    notes: z.string().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const isSet = value.setTo !== undefined;
    if (isSet && value.quantity !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Send either quantity or setTo, not both' });
    }
    if (!isSet && value.quantity === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Send either quantity or setTo' });
    }
    if (isSet && value.expectedOnHand === undefined) {
      ctx.addIssue({ code: 'custom', message: 'setTo requires expectedOnHand' });
    }
  });
export type AdjustInventoryRequest = z.infer<typeof adjustInventoryRequestSchema>;

/**
 * Adjust / Transfer endpoints return `204 No Content` effectively (service
 * returns `void`, global interceptor wraps as `{ data: null }`). Kept as an
 * empty object schema so the service can expose a typed Observable<void> but
 * callers that opt into the raw envelope still validate.
 */
export const adjustInventoryResponseSchema = z.object({}).passthrough();
export type AdjustInventoryResponse = z.infer<typeof adjustInventoryResponseSchema>;

export const transferInventoryRequestSchema = z.object({
  variantId: entityIdSchema,
  fromLocationId: entityIdSchema,
  toLocationId: entityIdSchema,
  quantity: z.number().int().positive(),
  notes: z.string().max(500).optional(),
});
export type TransferInventoryRequest = z.infer<typeof transferInventoryRequestSchema>;

export const transferInventoryResponseSchema = z.object({}).passthrough();
export type TransferInventoryResponse = z.infer<typeof transferInventoryResponseSchema>;

/**
 * The backend returns a plain array of StockLevel rows with the owning
 * `location` included and `available = onHand - reserved` already computed.
 * Shape mirrored from the `levels` entries of
 * `apps/api/src/modules/inventory/inventory.service.ts:getVariantStockDetail`.
 */
export const variantStockBreakdownEntrySchema = z.object({
  id: entityIdSchema,
  variantId: entityIdSchema,
  locationId: entityIdSchema,
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  location: z.object({
    id: entityIdSchema,
    name: z.string(),
    code: z.string(),
    isActive: z.boolean(),
  }),
  // Joined variant SKU + product (name is Translatable) so the variant-detail
  // page can title itself "Product name · SKU" instead of the raw variant UUID.
  variant: z
    .object({
      sku: z.string(),
      product: z.object({ id: entityIdSchema, name: translatableSchema }).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type VariantStockBreakdownEntry = z.infer<typeof variantStockBreakdownEntrySchema>;

export const variantStockBreakdownSchema = z.array(variantStockBreakdownEntrySchema);
export type VariantStockBreakdown = z.infer<typeof variantStockBreakdownSchema>;

/**
 * The admin variant-stock detail response.
 *
 * An envelope rather than a bare array, because the array could not answer the
 * screen's first question: a variant with no StockLevel rows returned `[]`, so
 * the page had no product to name and no product to link to, and printed the
 * raw variant id instead. That is exactly the variant an operator goes looking
 * for when stock is missing.
 */
export const variantStockDetailSchema = z.object({
  variant: z
    .object({
      id: entityIdSchema,
      sku: z.string(),
      product: z
        .object({ id: entityIdSchema, name: translatableSchema, slug: z.string().optional() })
        .nullable()
        .optional(),
    })
    .nullable(),
  levels: z.array(variantStockBreakdownEntrySchema),
});
export type VariantStockDetail = z.infer<typeof variantStockDetailSchema>;

export const alertTypeSchema = z.enum(['LOW_STOCK', 'OUT_OF_STOCK']);
export type AlertType = z.infer<typeof alertTypeSchema>;

/**
 * Alert rows are StockLevel entries enriched with `alertType` (the backend
 * computes it from `onHand === 0` vs `onHand <= LOW_STOCK_THRESHOLD`).
 * Variant + location includes are present per the controller's service call.
 */
export const inventoryAlertSchema = z.object({
  id: entityIdSchema,
  variantId: entityIdSchema,
  locationId: entityIdSchema,
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  alertType: alertTypeSchema,
  updatedAt: z.string().datetime().optional(),
  variant: z
    .object({
      id: entityIdSchema,
      sku: z.string(),
      product: z
        .object({
          id: entityIdSchema,
          name: translatableSchema,
          slug: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  location: z
    .object({
      id: entityIdSchema,
      name: z.string(),
      code: z.string(),
    })
    .optional(),
});
export type InventoryAlert = z.infer<typeof inventoryAlertSchema>;

export const listAlertsResponseSchema = z.object({
  data: z.array(inventoryAlertSchema),
  meta: paginationMetaSchema,
});
export type ListAlertsResponse = z.infer<typeof listAlertsResponseSchema>;

export const paginationQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const createLocationRequestSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  isActive: z.boolean().optional(),
});
export type CreateLocationRequest = z.infer<typeof createLocationRequestSchema>;

export const updateLocationRequestSchema = createLocationRequestSchema.partial();
export type UpdateLocationRequest = z.infer<typeof updateLocationRequestSchema>;

/* ── Product-scoped stock (the product pages' read) ───────────────── */

export const productStockLevelSchema = z.object({
  stockLevelId: entityIdSchema,
  locationId: entityIdSchema,
  location: z.object({
    id: entityIdSchema,
    name: z.string(),
    code: z.string(),
    isActive: z.boolean(),
  }),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  updatedAt: z.string().datetime().optional(),
});
export type ProductStockLevel = z.infer<typeof productStockLevelSchema>;

/**
 * One variant's stock. `levels` is empty for a variant that has no StockLevel
 * row anywhere, which is a state the screen must render rather than hide: it is
 * the variant an operator needs to find in order to give it stock.
 */
export const productStockVariantSchema = z.object({
  variantId: entityIdSchema,
  sku: z.string(),
  isDefault: z.boolean(),
  totals: z.object({
    onHand: z.number().int(),
    reserved: z.number().int(),
    available: z.number().int(),
  }),
  status: stockStatusSchema,
  levels: z.array(productStockLevelSchema),
});
export type ProductStockVariant = z.infer<typeof productStockVariantSchema>;

export const productStockSchema = z.object({
  lowStockThreshold: z.number().int(),
  locations: z.array(
    z.object({
      id: entityIdSchema,
      name: z.string(),
      code: z.string(),
      isActive: z.boolean(),
    }),
  ),
  variants: z.array(productStockVariantSchema),
});
export type ProductStock = z.infer<typeof productStockSchema>;
