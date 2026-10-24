import { HttpClient, HttpEventType, HttpParams, HttpProgressEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import {
  type AssetIntent,
  type PublicVariantUrl,
  pickVariantUrl,
  tryPickVariantUrl,
} from '@common/asset-variants';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  type Asset,
  assetSchema,
  type AssetReferences,
  assetReferencesSchema,
  type AssetWithUsage,
  assetWithUsageSchema,
  type GetAssetReferencesQuery,
  getAssetReferencesQuerySchema,
  type ListAssetsQuery,
  listAssetsQuerySchema,
  type ListAssetsResponse,
  listAssetsResponseSchema,
} from './assets.schemas';
import { type AssetOriginalUrlResponse, assetOriginalUrlResponseSchema } from '@admin-types';

const ASSETS = ADMIN_API_ROUTES.assets;

export interface UploadProgress {
  loaded: number;
  total: number | null;
  /** 0..1. `null` when total is unknown. */
  ratio: number | null;
}

export type AssetUploadEvent =
  | { kind: 'progress'; progress: UploadProgress }
  | { kind: 'done'; asset: Asset };

/**
 * `/v1/admin/assets/upload` — multipart.
 * Processing (resize, blurhash) runs async; the caller should poll the
 * returned asset until `status === 'READY'`. Client-side MIME + size
 * validation live in the UI layer per docs/clarifications.md Q5.
 */
@Injectable({ providedIn: 'root' })
export class AssetsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  list(query: ListAssetsQuery = {}): Observable<ListAssetsResponse> {
    const parsed = listAssetsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(ASSETS.base, ASSETS.list)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listAssetsResponseSchema.parse(raw)));
  }

  get(id: string): Observable<AssetWithUsage> {
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(ASSETS.base, fillRoute(ASSETS.byId, { id }))}`, {
        withCredentials: true,
      })
      .pipe(map((raw) => assetWithUsageSchema.parse(envelope(raw))));
  }

  delete(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiBase}/${adminRoute(ASSETS.base, fillRoute(ASSETS.byId, { id }))}`, {
        withCredentials: true,
      })
      .pipe(map(() => undefined));
  }

  /**
   * `GET /v1/admin/assets/:id/references` — DR-07 / S18 references endpoint.
   * Returns the list of entities (products, variants, reviews, returns,
   * categories, sections) that point at this asset. Used by the references
   * dialog and by the asset-detail destructive flow to gate hard-delete.
   */
  getReferences(id: string, filters: GetAssetReferencesQuery = {}): Observable<AssetReferences> {
    const parsed = getAssetReferencesQuerySchema.parse(filters);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(ASSETS.base, fillRoute(ASSETS.references, { id }))}`,
        {
          params,
          withCredentials: true,
        },
      )
      .pipe(map((raw) => assetReferencesSchema.parse(envelope(raw))));
  }

  /**
   * `GET /v1/admin/assets/:id/original-url` — asset-variant-serving (AV1).
   * Returns a short-TTL signed URL (5 min) for admin access to the private
   * original. 404 when `originalStoragePath` is NULL (post-deletion cutover)
   * or when the asset row is missing.
   */
  getOriginalUrl(id: string): Observable<AssetOriginalUrlResponse> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(ASSETS.base, fillRoute(ASSETS.originalUrl, { id }))}`,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => assetOriginalUrlResponseSchema.parse(envelope(raw))));
  }

  /**
   * Pure resolver shim — picks the canonical variant URL for the given intent.
   * Delegates to the canonical `pickVariantUrl` (`libs/shared/common/src/asset-variants/resolver.ts`)
   * so admin and backend share exactly one implementation. Throws on
   * non-READY assets or malformed `variants` payloads — callers that need a
   * graceful fallback (e.g. blurhash placeholder) use `tryPublicVariantUrl`.
   *
   * AV3 — see `specs/features/asset-variant-serving/plan.md` § AV3.
   */
  publicVariantUrl(
    asset: Pick<Asset, 'id' | 'status' | 'variants'>,
    intent: AssetIntent,
  ): PublicVariantUrl {
    return pickVariantUrl({ id: asset.id, status: asset.status, variants: asset.variants }, intent);
  }

  /**
   * Soft variant — returns null instead of throwing. Used by admin previews
   * that should fall back to a type-label or blurhash block when the asset
   * is still PROCESSING / FAILED or its variants payload is missing.
   */
  tryPublicVariantUrl(
    asset: Pick<Asset, 'id' | 'status' | 'variants'> | null | undefined,
    intent: AssetIntent,
  ): PublicVariantUrl | null {
    if (!asset) return null;
    return tryPickVariantUrl(
      { id: asset.id, status: asset.status, variants: asset.variants },
      intent,
    );
  }

  /** Simple one-shot upload, resolves with the created asset record. */
  upload(file: File): Observable<Asset> {
    const body = new FormData();
    body.append('file', file);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(ASSETS.base, ASSETS.upload)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => assetSchema.parse(envelope(raw))));
  }

  /**
   * Upload with progress events. Consumers should subscribe and render a
   * progress bar until the `done` event arrives with the final asset.
   */
  uploadWithProgress(file: File): Observable<AssetUploadEvent> {
    const body = new FormData();
    body.append('file', file);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(ASSETS.base, ASSETS.upload)}`, body, {
        withCredentials: true,
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        map((event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const pev = event as HttpProgressEvent;
            return {
              kind: 'progress' as const,
              progress: {
                loaded: pev.loaded,
                total: pev.total ?? null,
                ratio: pev.total ? pev.loaded / pev.total : null,
              },
            };
          }
          if (event.type === HttpEventType.Response) {
            return {
              kind: 'done' as const,
              asset: assetSchema.parse(envelope(event.body as unknown)),
            };
          }
          return null;
        }),
        // drop intermediate events we don't care about
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        (source) =>
          new Observable<AssetUploadEvent>((subscriber) => {
            const sub = source.subscribe({
              next: (e) => {
                if (e) subscriber.next(e);
              },
              error: (err) => subscriber.error(err),
              complete: () => subscriber.complete(),
            });
            return () => sub.unsubscribe();
          }),
      );
  }
}
