import * as fs from 'fs/promises';
import * as path from 'path';
import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SaveOptions,
  SaveResult,
  StorageDriver,
  StorageVisibility,
} from './storage-driver.interface';

const PRIVATE_PREFIX = 'private/';

/**
 * Writes files to the local filesystem.
 *
 * Public visibility (AV0 default — backwards-compatible): writes go under
 * `${UPLOADS_ROOT:-uploads}/<filename>` and the returned URL points at
 * `${UPLOADS_BASE_URL}/<filename>`. Identical to pre-AV0 behaviour.
 *
 * Private visibility (AV0 new): writes go under `${PRIVATE_UPLOADS_DIR}/<filename>`
 * — a directory NOT served by the public uploads route. The returned
 * `storagePath` carries a `private/` prefix so `read()` and `signUrl()` can
 * route correctly. The returned `url` is empty: private artifacts have no
 * public URL.
 *
 * Used in development. Switch to `S3StorageDriver` in production.
 */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  private readonly uploadsRoot: string;
  private readonly privateRoot: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.uploadsRoot = path.resolve(
      process.cwd(),
      this.config.get<string>('UPLOADS_ROOT', 'uploads'),
    );
    this.privateRoot = this.config.get<string>(
      'PRIVATE_UPLOADS_DIR',
      path.resolve(process.cwd(), 'uploads-private'),
    );
    this.baseUrl = this.config.get<string>('UPLOADS_BASE_URL', 'http://localhost:53000/uploads');
  }

  async save(buffer: Buffer, filename: string, options: SaveOptions = {}): Promise<SaveResult> {
    const visibility: StorageVisibility = options.visibility ?? 'public';
    const cleanFilename = stripPrivatePrefix(filename).replace(/\\/g, '/');

    if (visibility === 'private') {
      const dest = path.join(this.privateRoot, cleanFilename);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buffer);
      return {
        storagePath: `${PRIVATE_PREFIX}${cleanFilename}`,
        url: '',
      };
    }

    const dest = path.join(this.uploadsRoot, cleanFilename);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buffer);
    return {
      storagePath: cleanFilename,
      url: `${this.baseUrl}/${cleanFilename}`,
    };
  }

  async read(storagePath: string): Promise<Buffer> {
    if (storagePath.startsWith(PRIVATE_PREFIX)) {
      const rel = storagePath.slice(PRIVATE_PREFIX.length);
      return fs.readFile(path.join(this.privateRoot, rel));
    }
    return fs.readFile(path.join(this.uploadsRoot, storagePath));
  }

  async delete(storagePath: string): Promise<void> {
    if (storagePath.startsWith(PRIVATE_PREFIX)) {
      const rel = storagePath.slice(PRIVATE_PREFIX.length);
      await fs.unlink(path.join(this.privateRoot, rel));
      return;
    }
    await fs.unlink(path.join(this.uploadsRoot, storagePath));
  }

  async signUrl(storagePath: string, ttlSeconds: number): Promise<string> {
    if (!storagePath.startsWith(PRIVATE_PREFIX)) {
      throw new Error(
        `LocalStorageDriver.signUrl: refusing to sign non-private path "${storagePath}" — public artifacts are served unauthenticated`,
      );
    }
    const secret = this.config.get<string>('SIGNED_URL_SECRET');
    if (!secret) {
      throw new Error(
        'LocalStorageDriver.signUrl: SIGNED_URL_SECRET env var is not configured — required to mint admin signed URLs',
      );
    }
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${storagePath}:${exp}`;
    const token = createHmac('sha256', secret).update(payload).digest('hex');
    const params = new URLSearchParams({ exp: String(exp), token });
    const rel = storagePath.slice(PRIVATE_PREFIX.length);
    return `${this.baseUrl}/private/${rel}?${params.toString()}`;
  }
}

function stripPrivatePrefix(filename: string): string {
  return filename.startsWith(PRIVATE_PREFIX) ? filename.slice(PRIVATE_PREFIX.length) : filename;
}
