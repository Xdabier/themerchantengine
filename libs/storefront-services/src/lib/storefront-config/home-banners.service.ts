import { Inject, Injectable } from '@angular/core';
import * as z from 'zod';
import { apiResponseSchema } from '@storefront-types';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

/**
 * Home-page banner config sourced from `GET /v1/storefront/home-banners`.
 * Server returns null fields when the seed hasn't run; consumers fall back
 * to the brand-token decorative panel in that case.
 */
const translatableSchema = z
  .object({ en: z.string().optional(), ar: z.string().optional() })
  .nullable()
  .optional();

const homeBannersSchema = z.object({
  hero: z.object({
    imageUrl: z.string().url().nullable(),
    altText: translatableSchema,
  }),
  midBanner: z.object({
    imageUrl: z.string().url().nullable(),
    altText: translatableSchema,
  }),
});

export type HomeBannersConfig = z.infer<typeof homeBannersSchema>;

@Injectable({ providedIn: 'root' })
export class HomeBannersService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async get(): Promise<HomeBannersConfig> {
    const envelope = await this.api.get<unknown>('/v1/storefront/home-banners');
    return apiResponseSchema(homeBannersSchema).parse(envelope).data;
  }
}
