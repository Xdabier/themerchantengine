import * as z from 'zod';

export const countryRowSchema = z.object({
  code: z.string().length(2),
  name: z.string(),
  region: z.string(),
  emoji: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
});
export type CountryRow = z.infer<typeof countryRowSchema>;

export const countriesResponseSchema = z.object({
  data: z.array(countryRowSchema),
  defaultCode: z.string().nullable(),
});
export type CountriesResponse = z.infer<typeof countriesResponseSchema>;

export const updateCountriesRequestSchema = z
  .object({
    enabled: z.array(z.string().length(2)).min(1),
    defaultCode: z.string().length(2).optional(),
  })
  .refine((v) => !v.defaultCode || v.enabled.includes(v.defaultCode), {
    message: 'defaultCode must be in the enabled list',
    path: ['defaultCode'],
  });
export type UpdateCountriesRequest = z.infer<typeof updateCountriesRequestSchema>;
