import * as z from 'zod';

export const currencyRowSchema = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
  name: z.string(),
  symbol: z.string(),
  region: z.string(),
  decimalPlaces: z.number().int().min(0).max(4),
  enabled: z.boolean(),
  isDefault: z.boolean(),
});
export type CurrencyRow = z.infer<typeof currencyRowSchema>;

export const currenciesResponseSchema = z.object({
  data: z.array(currencyRowSchema),
  defaultCode: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
});
export type CurrenciesResponse = z.infer<typeof currenciesResponseSchema>;

/**
 * `GET /v1/admin/currencies/store` — the store display currency plus the enabled
 * set. Hydrates `CurrencyStore`; every money surface in the admin formats through
 * it. `code` is always a member of `enabled` (the backend derives it from the
 * validated default-currency row, see DR-26).
 */
export const storeCurrencySchema = z.object({
  code: z.string().regex(/^[A-Z]{3}$/),
  symbol: z.string(),
  decimalPlaces: z.number().int().min(0).max(4),
  enabled: z.array(z.string().regex(/^[A-Z]{3}$/)),
});
export type StoreCurrency = z.infer<typeof storeCurrencySchema>;

export const updateCurrenciesRequestSchema = z
  .object({
    enabled: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
    defaultCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .refine((v) => !v.defaultCode || v.enabled.includes(v.defaultCode), {
    message: 'defaultCode must be in the enabled list',
    path: ['defaultCode'],
  });
export type UpdateCurrenciesRequest = z.infer<typeof updateCurrenciesRequestSchema>;
