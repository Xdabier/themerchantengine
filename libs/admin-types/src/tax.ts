import { z } from 'zod';
import { translatableSchema } from './translatable';

/**
 * Tax entity shapes — admin-side responses for `GET /v1/admin/tax/zones` and
 * `GET /v1/admin/tax/classes` after the E5 Translatable migration.
 *
 * Translatable scope:
 *  - `TaxZone.name` migrated to `Json` Translatable (`prisma/schema.prisma:1366`).
 *  - `TaxClass.name` stays plain `String` per **DR-22** — the field is a
 *    functional type-tag used by `isZeroRated(name)` and the zone-level
 *    uniqueness lookup at `tax.service.ts:31,79,89`.
 *
 * Living in `libs/admin-types/` per constitution §3.14 + DR-21.
 *
 * Rate is stored as a Postgres Decimal(5,4); Prisma serialises it to a string at
 * the wire boundary, so the Zod shape accepts `string` (the JSON wire form) or
 * a coerced `number` for tolerant client parsing.
 */

const decimalRateSchema = z.union([
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform((s) => Number(s))
    .refine((n) => n >= 0 && n <= 1, { message: 'rate must be between 0 and 1' }),
  z.number().min(0).max(1),
]);

export const taxZoneSchema = z.object({
  id: z.string(),
  /** Translatable per DR-21 / §02: admin operators edit a `{ default, fr, en }` object. */
  name: translatableSchema,
  countries: z.array(z.string()),
  rate: decimalRateSchema,
  isDefault: z.boolean(),
  isCompound: z.boolean(),
  priority: z.number().int().min(0),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type TaxZone = z.infer<typeof taxZoneSchema>;

export const taxClassSchema = z.object({
  id: z.string(),
  zoneId: z.string(),
  /**
   * Plain string per DR-22 — the value is a functional type-tag
   * (`"Standard" | "Reduced" | "Zero-Rated" | "Exempt"`) consumed by
   * `isZeroRated` at `apps/api/src/modules/tax/tax.service.ts:31`, not a
   * display-only label.
   */
  name: z.string(),
  rate: decimalRateSchema,
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaxClass = z.infer<typeof taxClassSchema>;
