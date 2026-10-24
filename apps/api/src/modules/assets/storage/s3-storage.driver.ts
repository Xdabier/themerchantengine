import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
import type {
  SaveOptions,
  SaveResult,
  StorageDriver,
  StorageVisibility,
} from './storage-driver.interface';

const PRIVATE_PREFIX = 'private/';

/**
 * S3-compatible storage driver for any provider that speaks the S3 API.
 * Switch via `STORAGE_DRIVER=s3` + `S3_*` env vars in `.env.production`.
 *
 * Endpoint format:   `https://<s3-endpoint>`
 * Public URL format: `https://<bucket>.<s3-endpoint>/<key>`
 *
 * AV0: visibility split (single bucket + `private/` prefix per
 * `specs/features/asset-variant-serving/clarifications.md` R5):
 * - `public`: `PutObjectCommand` carries `ACL: 'public-read'`. Key is the
 *             raw filename. URL is the public CDN URL. Status quo.
 * - `private`: `PutObjectCommand` carries no `ACL`. Key is `private/<filename>`.
 *               IAM bucket policy must deny anonymous `s3:GetObject` on
 *               `arn:aws:s3:::${BUCKET}/private/*`; CloudFront origin
 *               behaviour for `/private/*` returns 403 (or excludes the
 *               prefix from the distribution). URL is empty; admin reads
 *               via `signUrl()` (presigned GET, short TTL).
 */
@Injectable()
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.required('S3_ENDPOINT');
    const region = this.required('S3_REGION');
    const accessKeyId = this.required('S3_ACCESS_KEY');
    const secretAccessKey = this.required('S3_SECRET_KEY');

    this.bucket = this.required('S3_BUCKET');
    this.publicUrl = this.required('S3_PUBLIC_URL').replace(/\/$/, '');

    // Bucket names with dots break virtual-host SNI on providers that use a
    // single-level wildcard cert. Force path-style in that
    // case unless explicitly overridden.
    const explicit = this.config.get<string>('S3_FORCE_PATH_STYLE');
    const forcePathStyle = explicit !== undefined ? explicit === 'true' : this.bucket.includes('.');

    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle,
    });
  }

  async save(buffer: Buffer, filename: string, options: SaveOptions = {}): Promise<SaveResult> {
    const visibility: StorageVisibility = options.visibility ?? 'public';
    const cleanKey = filename.replace(/\\/g, '/').replace(/^\/+/, '');

    if (visibility === 'private') {
      // Defensive: caller may pass a path already prefixed with `private/`.
      const key = cleanKey.startsWith(PRIVATE_PREFIX) ? cleanKey : `${PRIVATE_PREFIX}${cleanKey}`;
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: this.guessContentType(key),
        }),
      );
      return { storagePath: key, url: '' };
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
        Body: buffer,
        ContentType: this.guessContentType(cleanKey),
        ACL: 'public-read',
      }),
    );
    return {
      storagePath: cleanKey,
      url: `${this.publicUrl}/${cleanKey}`,
    };
  }

  async read(storagePath: string): Promise<Buffer> {
    const key = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = result.Body as Readable | undefined;
    if (!body) {
      throw new Error(`S3 object ${key} returned empty body`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(storagePath: string): Promise<void> {
    const key = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signUrl(storagePath: string, ttlSeconds: number): Promise<string> {
    const key = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
    // Defensive-guard parity with `LocalStorageDriver.signUrl`. Public
    // artifacts are served unauthenticated; signing them is meaningless and
    // would mask a caller bug that asks for a signed URL on a public key.
    if (!key.startsWith(PRIVATE_PREFIX)) {
      throw new Error(
        `S3StorageDriver.signUrl: refusing to sign non-private path "${key}" — public artifacts are served unauthenticated`,
      );
    }
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`S3StorageDriver: missing required env var ${key}`);
    }
    return value;
  }

  private guessContentType(key: string): string {
    const ext = key.toLowerCase().split('.').pop() ?? '';
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      mp4: 'video/mp4',
      webm: 'video/webm',
      pdf: 'application/pdf',
    };
    return map[ext] ?? 'application/octet-stream';
  }
}
