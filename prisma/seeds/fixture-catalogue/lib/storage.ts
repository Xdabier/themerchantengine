import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Visibility mirrors `apps/api/src/modules/assets/storage/storage-driver.interface.ts`.
 * Public writes go to the CDN-served root; private writes go to a sibling root
 * (local: `${uploadsRoot}-private/`; S3: `private/` key prefix, no public ACL).
 */
export type SeedStorageVisibility = 'public' | 'private';

const PRIVATE_PREFIX = 'private/';

/**
 * Minimal storage driver for the seed runner. Mirrors
 * `apps/api/src/modules/assets/storage/storage-driver.interface.ts` but
 * runs without Nest DI / Multer so the seed boots from a plain Node process.
 */
export interface SeedStorageDriver {
  save(
    buffer: Buffer,
    filename: string,
    options?: { visibility?: SeedStorageVisibility },
  ): Promise<{ storagePath: string; url: string }>;
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
  /** Public URL of a stored key under this driver's current base. */
  urlFor(storagePath: string): string;
}

export function createLocalStorageDriver(opts: {
  uploadsRoot: string;
  baseUrl: string;
  privateUploadsRoot?: string;
}): SeedStorageDriver {
  // Private root mirrors the production LocalStorageDriver shape — sibling
  // directory ending in `-private` so the API host can mount the public root
  // unchanged while keeping originals out of the public document tree.
  const privateRoot = opts.privateUploadsRoot ?? `${opts.uploadsRoot}-private`;
  const resolveDirs = (visibility: SeedStorageVisibility, filename: string) => {
    const cleanKey = filename.replace(/\\/g, '/').replace(/^\/+/, '');
    if (visibility === 'private') {
      const key = cleanKey.startsWith(PRIVATE_PREFIX) ? cleanKey : `${PRIVATE_PREFIX}${cleanKey}`;
      const stripped = key.slice(PRIVATE_PREFIX.length);
      return { dest: path.join(privateRoot, stripped), storagePath: key, url: '' };
    }
    return {
      dest: path.join(opts.uploadsRoot, cleanKey),
      storagePath: cleanKey,
      url: `${opts.baseUrl}/${cleanKey}`,
    };
  };
  const resolveDest = (storagePath: string) => {
    const cleanKey = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (cleanKey.startsWith(PRIVATE_PREFIX)) {
      return path.join(privateRoot, cleanKey.slice(PRIVATE_PREFIX.length));
    }
    return path.join(opts.uploadsRoot, cleanKey);
  };
  return {
    async save(buffer, filename, options) {
      const visibility: SeedStorageVisibility = options?.visibility ?? 'public';
      const { dest, storagePath, url } = resolveDirs(visibility, filename);
      // Skip the rewrite if the file already exists with a matching size — the
      // seed pipeline keys storage paths off a sha256 of the source buffer, so
      // a same-size hit is a content match. fs.stat is cheap (one syscall) vs
      // a 100KB+ writeFile that the OS would otherwise replay across 11 files
      // per ingested image (1 original + 5 variants × 2 formats).
      try {
        const stat = await fs.stat(dest);
        if (stat.isFile() && stat.size === buffer.byteLength) {
          return { storagePath, url };
        }
      } catch {
        // ENOENT or permission — fall through to write.
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buffer);
      return { storagePath, url };
    },
    async read(storagePath) {
      return fs.readFile(resolveDest(storagePath));
    },
    async delete(storagePath) {
      try {
        await fs.unlink(resolveDest(storagePath));
      } catch (err) {
        const e = err as { code?: string };
        if (e?.code === 'ENOENT') return;
        throw err;
      }
    },
    urlFor(storagePath) {
      return `${opts.baseUrl}/${storagePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
    },
  };
}

export interface S3DriverOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicUrl: string;
  forcePathStyle?: boolean;
}

export function createS3StorageDriver(opts: S3DriverOptions): SeedStorageDriver {
  // Bucket names with dots break virtual-host SNI on providers that use a
  // single-level wildcard cert. Default to path-style for those.
  const forcePathStyle = opts.forcePathStyle ?? opts.bucket.includes('.');
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: opts.region,
    credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
    forcePathStyle,
  });
  const publicUrl = opts.publicUrl.replace(/\/$/, '');

  const guessContentType = (key: string): string => {
    const ext = key.toLowerCase().split('.').pop() ?? '';
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
      svg: 'image/svg+xml',
      mp4: 'video/mp4',
      webm: 'video/webm',
      pdf: 'application/pdf',
    };
    return map[ext] ?? 'application/octet-stream';
  };

  const exists = async (key: string): Promise<boolean> => {
    try {
      await client.send(new HeadObjectCommand({ Bucket: opts.bucket, Key: key }));
      return true;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  };

  return {
    async save(buffer, filename, options) {
      const visibility: SeedStorageVisibility = options?.visibility ?? 'public';
      const cleanKey = filename.replace(/\\/g, '/').replace(/^\/+/, '');
      if (visibility === 'private') {
        const key = cleanKey.startsWith(PRIVATE_PREFIX) ? cleanKey : `${PRIVATE_PREFIX}${cleanKey}`;
        // No HEAD short-circuit on the private branch: the existing object's
        // ACL is unknowable from the client side (HeadObject doesn't return
        // ACL on path-style requests). Re-uploading guarantees the
        // requested visibility wins. The cost is one extra PUT per reseed —
        // acceptable for the safety guarantee. (Public branch retains the
        // short-circuit since stale-public is not a security regression.)
        await client.send(
          new PutObjectCommand({
            Bucket: opts.bucket,
            Key: key,
            Body: buffer,
            ContentType: guessContentType(key),
          }),
        );
        return { storagePath: key, url: '' };
      }
      // Skip upload if the object is already in the bucket — keeps reseeds
      // cheap once images have been uploaded once. Sharp variant generation
      // still happens upstream but the network PUT is the slow part.
      if (await exists(cleanKey)) {
        return { storagePath: cleanKey, url: `${publicUrl}/${cleanKey}` };
      }
      await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: cleanKey,
          Body: buffer,
          ContentType: guessContentType(cleanKey),
          ACL: 'public-read',
        }),
      );
      return { storagePath: cleanKey, url: `${publicUrl}/${cleanKey}` };
    },
    async read(storagePath) {
      const key = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
      const result = await client.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
      const body = result.Body as Readable | undefined;
      if (!body) throw new Error(`S3 object ${key} returned empty body`);
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },
    async delete(storagePath) {
      const key = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
      try {
        await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }));
      } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return;
        throw err;
      }
    },
    urlFor(storagePath) {
      return `${publicUrl}/${storagePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
    },
  };
}

export interface SeedStorageConfig {
  uploadsRoot: string;
  baseUrl: string;
}

/**
 * Resolve the seed runner's local-storage configuration from env. Defaults
 * match the production `LocalStorageDriver` so seed-written assets are
 * immediately served by the running API (`apps/api/src/main.ts` mounts
 * `/uploads`).
 */
export function resolveStorageConfig(env: NodeJS.ProcessEnv = process.env): SeedStorageConfig {
  return {
    uploadsRoot: path.resolve(process.cwd(), env.SEED_UPLOADS_ROOT ?? 'uploads'),
    baseUrl: env.UPLOADS_BASE_URL ?? 'http://localhost:53000/uploads',
  };
}

/**
 * Pick the right driver based on `STORAGE_DRIVER`:
 * STORAGE_DRIVER=s3 → createS3StorageDriver, reading S3_* env vars
 * anything else / unset → createLocalStorageDriver, reading SEED_UPLOADS_ROOT
 *
 * Mirrors the runtime factory in `apps/api/src/modules/assets/assets.module.ts`
 * so dev seed and dev API agree on where binaries live.
 */
export function resolveSeedStorageDriver(env: NodeJS.ProcessEnv = process.env): SeedStorageDriver {
  const driver = (env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (driver !== 's3') {
    return createLocalStorageDriver(resolveStorageConfig(env));
  }

  const required = (key: string): string => {
    const value = env[key];
    if (!value) throw new Error(`seed storage: STORAGE_DRIVER=s3 but ${key} is not set`);
    return value;
  };

  const explicitPathStyle = env.S3_FORCE_PATH_STYLE;
  return createS3StorageDriver({
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    accessKey: required('S3_ACCESS_KEY'),
    secretKey: required('S3_SECRET_KEY'),
    publicUrl: required('S3_PUBLIC_URL'),
    forcePathStyle: explicitPathStyle !== undefined ? explicitPathStyle === 'true' : undefined,
  });
}
