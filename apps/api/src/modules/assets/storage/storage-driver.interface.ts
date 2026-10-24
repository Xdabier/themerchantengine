/**
 * Storage visibility per `agent_docs/assets-pipeline.md` §3.
 *
 * - `public`  — written to the public-served root. URL is unauthenticated,
 *               cacheable, CDN-friendly. Variants and only variants live here.
 * - `private` — written to a private root. Local: `${UPLOADS_BASE_DIR}/private/`.
 *               S3: `private/` key prefix in the same bucket with no
 *               `public-read` ACL. No public URL is ever published; admin
 *               reads via the new admin signed-URL endpoint with a short TTL.
 */
export type StorageVisibility = 'public' | 'private';

export interface SaveOptions {
  /**
   * Visibility of the persisted artifact. Defaults to `'public'` so existing
   * call sites continue to work unchanged through the AV0 transition; AV1
   * flips `AssetsService.upload` to pass `'private'` for originals.
   */
  visibility?: StorageVisibility;
}

export interface SaveResult {
  /** Relative path used to retrieve the file later (e.g. "assets/abc123/original.jpg"). */
  storagePath: string;
  /**
   * Public-facing URL when the artifact is `'public'` (e.g.
   * "http://localhost:53000/uploads/public/assets/abc123/original.jpg").
   *
   * For `'private'` artifacts the public URL is intentionally absent — readers
   * obtain a short-TTL signed URL via `signUrl(storagePath, ttlSeconds)`. The
   * field is set to an empty string for private writes so consumers that
   * unconditionally bind `[src]` get a visibly broken URL rather than a
   * silently leaked private path.
   */
  url: string;
}

export interface StorageDriver {
  /** Persist a buffer and return its storage path + (when public) URL. */
  save(buffer: Buffer, filename: string, options?: SaveOptions): Promise<SaveResult>;
  /** Read a previously saved file back into memory. */
  read(storagePath: string): Promise<Buffer>;
  /**
   * Generate a short-TTL signed URL for an existing storage path. Used by the
   * admin signed-URL endpoint (lands in AV1) to expose private originals to
   * authenticated admin operators on demand. Local driver returns an
   * HMAC-signed token URL; S3 driver returns an `@aws-sdk/s3-request-presigner`
   * presigned GET URL. TTL is enforced server-side on local; S3 enforces TTL
   * via the presigner's `expiresIn`.
   */
  signUrl(storagePath: string, ttlSeconds: number): Promise<string>;
  /**
   * Removes a previously saved artifact. Used by the image / video processors
   * to delete originals after variant verification (env-gated by
   * `RETAIN_ORIGINALS`). Implementations MUST surface a recognisable
   * not-found signal (`ENOENT` for local, `NoSuchKey` for S3) so the worker
   * can treat repeated invocations as idempotent.
   */
  delete(storagePath: string): Promise<void>;
}
