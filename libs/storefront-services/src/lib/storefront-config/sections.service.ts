import { Inject, Injectable } from '@angular/core';
import {
  storefrontSectionsResponseSchema,
  type StorefrontSectionsResponse,
} from '@storefront-types';
import { z } from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

/**
 * SSG ISR window for the storefront home page (10 min, mirrors the API's
 * Redis cache TTL on `STOREFRONT_SECTIONS_CACHE_PREFIX`). Exported so the
 * page route loader can hint downstream caches with the same window.
 */
export const STOREFRONT_SECTIONS_STALE_TIME_MS = 10 * 60 * 1000;

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(SLUG_PATTERN, 'pageSlug must be lowercase kebab');

/**
 * Storefront sections client. Mirrors the back-end's per-page cache window
 * (10 minutes) so the SSG layer can revalidate via the
 * `storefront.section_updated` webhook the API emits on every section
 * mutation. The page route loader passes `staleTime` to its caching layer
 * (Analog `defineRouteLoader` cache or TanStack Query when wired).
 */
@Injectable({ providedIn: 'root' })
export class SectionsService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  /** Fetch + Zod-validate the visible sections for a page slug. */
  async getByPageSlug(pageSlug: string): Promise<StorefrontSectionsResponse> {
    const safeSlug = slugSchema.parse(pageSlug);
    const envelope = await this.api.get<unknown>(
      `/v1/storefront/sections/${encodeURIComponent(safeSlug)}`,
    );
    return storefrontSectionsResponseSchema.parse(envelope);
  }
}
