import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { encode as encodeBlurhash } from 'blurhash';
import { assetVariantsSchema } from '@common/asset-variants';
import { PrismaService } from '../../../prisma/prisma.service';
import { IMAGE_PROCESSING_QUEUE, IMAGE_VARIANTS, STORAGE_DRIVER } from '../assets.constants';
import type { StorageDriver } from '../storage/storage-driver.interface';
import type { ImageProcessingJobPayload } from '../interfaces/asset-job.interface';

interface VariantResult {
  url: string;
  storagePath: string;
  width: number;
  height: number;
  size: number;
}

@Processor(IMAGE_PROCESSING_QUEUE)
export class ImageProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<ImageProcessingJobPayload>): Promise<void> {
    const { assetId, storagePath: originalStoragePath } = job.data;
    this.logger.log(`Processing image asset ${assetId}`);

    // Idempotency on BullMQ retry: a re-delivered job for an asset that has
    // already flipped to READY must short-circuit. Without this guard, the
    // `storage.read` below would throw not-found on the deleted original and
    // the outer catch would silently flip a READY asset back to FAILED.
    const current = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { status: true, originalStoragePath: true },
    });
    if (!current) {
      this.logger.warn(`Skipping image processing — asset ${assetId} no longer exists`);
      return;
    }
    if (current.status === 'READY') {
      // Two retry shapes: (a) deletion phase already ran, originalStoragePath
      // is null, nothing to do; (b) deletion phase crashed mid-flight, the
      // path is still set — re-attempt the env-gated delete only.
      if (current.originalStoragePath !== null) {
        await this.maybeDeleteOriginal(assetId, current.originalStoragePath);
      }
      this.logger.log(`Skipping image processing — asset ${assetId} already READY`);
      return;
    }

    try {
      const rawBuffer = await this.storage.read(originalStoragePath);

      const originalMeta = await sharp(rawBuffer).metadata();
      const originalWidth = originalMeta.width ?? 0;
      const originalHeight = originalMeta.height ?? 0;
      const blurhash = await this.generateBlurhash(rawBuffer);

      const variants: Record<string, { webp: VariantResult; avif: VariantResult }> = {};
      for (const variant of IMAGE_VARIANTS) {
        const resized = sharp(rawBuffer)
          .rotate()
          .resize(variant.width, undefined, { withoutEnlargement: true });
        const [webpResult, avifResult] = await Promise.all([
          this.processFormat(resized.clone(), 'webp', assetId, variant.name),
          this.processFormat(resized.clone(), 'avif', assetId, variant.name),
        ]);
        variants[variant.name] = { webp: webpResult, avif: avifResult };
      }

      // Validate the JSONB shape before persisting — single source of truth
      // per clarifications R7.
      const parsed = assetVariantsSchema.parse(variants);
      const canonical = parsed.large.webp;

      // AV1 — single update flips the row to READY with both the canonical
      // url + storagePath and the full variant set.
      await this.prisma.asset.update({
        where: { id: assetId },
        data: {
          status: 'READY',
          url: canonical.url,
          storagePath: canonical.storagePath,
          width: originalWidth,
          height: originalHeight,
          blurhash,
          variants: parsed as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(`Image asset ${assetId} processed successfully`);
    } catch (err) {
      this.logger.error(`Image processing failed for asset ${assetId}`, err);
      await this.prisma.asset.update({
        where: { id: assetId },
        data: { status: 'FAILED' },
      });
      throw err;
    }

    // AV2 nit #1 / AV3 — original deletion sits OUTSIDE the try/catch so a
    // post-READY storage delete failure does NOT propagate to the catch
    // block (which would demote a successfully-flipped row back to FAILED).
    // Storage not-found is already swallowed inside `maybeDeleteOriginal`;
    // any other error here logs + propagates so BullMQ surfaces the
    // partially-completed state in the dashboard, but the asset row stays
    // READY and the variant URLs keep working.
    try {
      await this.maybeDeleteOriginal(assetId, originalStoragePath);
    } catch (err) {
      this.logger.warn(
        `Image asset ${assetId} READY but original deletion failed (row stays READY)`,
        err,
      );
      throw err;
    }
  }

  private async processFormat(
    pipeline: sharp.Sharp,
    format: 'webp' | 'avif',
    assetId: string,
    variantName: string,
  ): Promise<VariantResult> {
    const { data, info } = await pipeline
      .toFormat(format, { quality: 80 })
      .toBuffer({ resolveWithObject: true });

    const filename = `assets/${assetId}/${variantName}.${format}`;
    const { url, storagePath } = await this.storage.save(data, filename, { visibility: 'public' });

    return { url, storagePath, width: info.width, height: info.height, size: info.size };
  }

  /**
   * Original deletion — env-gated per R6 (false in production).
   * Idempotent on retry: storage `not-found` is treated as success.
   */
  private async maybeDeleteOriginal(assetId: string, originalStoragePath: string): Promise<void> {
    const retain = this.config.get<string>('RETAIN_ORIGINALS', 'false');
    if (retain === 'true') return;
    try {
      await this.storage.delete(originalStoragePath);
    } catch (err) {
      if (!isStorageNotFound(err)) throw err;
    }
    await this.prisma.asset.update({
      where: { id: assetId },
      data: { originalStoragePath: null },
    });
  }

  private async generateBlurhash(buffer: Buffer): Promise<string> {
    const { data, info } = await sharp(buffer)
      .resize(32, 32, { fit: 'inside' })
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    return encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  }
}

function isStorageNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === 'ENOENT' || code === 'NoSuchKey') return true;
  const name = (err as { name?: string }).name;
  return name === 'NoSuchKey';
}
