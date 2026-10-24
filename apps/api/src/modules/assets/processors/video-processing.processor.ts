import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { assetVariantsSchema, type VideoAssetVariants } from '@common/asset-variants';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  IMAGE_VARIANTS,
  STORAGE_DRIVER,
  VIDEO_POSTER_FRAME_FRACTION,
  VIDEO_PROCESSING_QUEUE,
  VIDEO_RENDITIONS,
  type VideoRendition,
} from '../assets.constants';
import type { StorageDriver } from '../storage/storage-driver.interface';
import type { VideoProcessingJobPayload } from '../interfaces/asset-job.interface';
import { extractFrame, probeVideo, transcodeVideo } from './ffmpeg-wrapper';

interface RenditionResult {
  url: string;
  storagePath: string;
  width: number;
  height: number;
  size: number;
  container: 'mp4' | 'webm';
  codec: string;
  bitrate: string;
}

interface PosterArtefact {
  url: string;
  storagePath: string;
  width: number;
  height: number;
  size: number;
}

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobPayload>): Promise<void> {
    const { assetId, storagePath: originalStoragePath } = job.data;
    this.logger.log(`Processing video asset ${assetId}`);

    // Mirror AV1 image-processor idempotency: a re-delivered job for an asset
    // already at READY must short-circuit to avoid the read-from-deleted-
    // original throw flipping the row back to FAILED. Two retry shapes:
    // (a) deletion phase already ran, originalStoragePath is null;
    // (b) deletion phase crashed mid-flight, the path is still set.
    const current = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { status: true, originalStoragePath: true },
    });
    if (!current) {
      this.logger.warn(`Skipping video processing — asset ${assetId} no longer exists`);
      return;
    }
    if (current.status === 'READY') {
      if (current.originalStoragePath !== null) {
        await this.maybeDeleteOriginal(assetId, current.originalStoragePath);
      }
      this.logger.log(`Skipping video processing — asset ${assetId} already READY`);
      return;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `asset-${assetId}-`));
    const tempInputPath = path.join(tempDir, 'input');

    try {
      const rawBuffer = await this.storage.read(originalStoragePath);
      await fs.writeFile(tempInputPath, rawBuffer);

      const probe = await probeVideo(tempInputPath);

      const renditions: Record<string, RenditionResult> = {};
      for (const r of VIDEO_RENDITIONS) {
        renditions[r.name] = await this.transcodeOne(tempInputPath, tempDir, assetId, r);
      }

      const posterAt = probe.durationSeconds * VIDEO_POSTER_FRAME_FRACTION;
      const posterRawPath = path.join(tempDir, 'poster.png');
      await extractFrame(tempInputPath, posterRawPath, posterAt);
      const posterBuffer = await fs.readFile(posterRawPath);

      const posters: Record<string, { webp: PosterArtefact; avif: PosterArtefact }> = {};
      for (const variant of IMAGE_VARIANTS) {
        const resized = sharp(posterBuffer)
          .rotate()
          .resize(variant.width, undefined, { withoutEnlargement: true });
        const [webp, avif] = await Promise.all([
          this.encodePoster(resized.clone(), 'webp', assetId, variant.name),
          this.encodePoster(resized.clone(), 'avif', assetId, variant.name),
        ]);
        posters[variant.name] = { webp, avif };
      }

      const payload = {
        ...posters,
        renditions,
      } as unknown as VideoAssetVariants;

      const parsed = assetVariantsSchema.parse(payload);
      // The union always returns the union type, but at this point we know
      // we built a video payload — narrow via the renditions presence check.
      if (!('renditions' in parsed)) {
        throw new Error('Video payload assembled without renditions — invariant violation');
      }
      const desktop = parsed.renditions.desktop;

      await this.prisma.asset.update({
        where: { id: assetId },
        data: {
          status: 'READY',
          url: desktop.url,
          storagePath: desktop.storagePath,
          width: desktop.width,
          height: desktop.height,
          variants: parsed as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(`Video asset ${assetId} processed successfully`);
    } catch (err) {
      this.logger.error(`Video processing failed for asset ${assetId}`, err);
      await this.prisma.asset.update({
        where: { id: assetId },
        data: { status: 'FAILED' },
      });
      throw err;
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }

    // AV2 nit #1 / AV3 — original deletion sits OUTSIDE the try/catch so a
    // post-READY storage delete failure does NOT propagate to the catch
    // block (which would demote a successfully-flipped row back to FAILED).
    // Mirrors the image-processor pattern.
    try {
      await this.maybeDeleteOriginal(assetId, originalStoragePath);
    } catch (err) {
      this.logger.warn(
        `Video asset ${assetId} READY but original deletion failed (row stays READY)`,
        err,
      );
      throw err;
    }
  }

  private async transcodeOne(
    inputPath: string,
    tempDir: string,
    assetId: string,
    rendition: VideoRendition,
  ): Promise<RenditionResult> {
    const outputPath = path.join(tempDir, `${rendition.name}.${rendition.container}`);
    const { videoCodec, videoProfile } = mapVideoCodec(rendition.codec);
    const { audioCodec, audioBitrate } = mapAudioCodec(rendition.audio);

    await transcodeVideo(inputPath, outputPath, {
      videoCodec,
      videoProfile,
      videoBitrate: rendition.bitrate.replace(/M$/i, '000k').replace(/K$/i, 'k'),
      audioCodec,
      audioBitrate,
      capHeight: rendition.cap,
      format: rendition.container,
    });

    const buffer = await fs.readFile(outputPath);
    const filename = `assets/${assetId}/${rendition.name}.${rendition.container}`;
    const { url, storagePath } = await this.storage.save(buffer, filename, {
      visibility: 'public',
    });

    // Probe the output for the rendered dimensions — width is auto-computed
    // by the encoder, so we ask ffprobe for the actual values rather than
    // estimating from the source.
    const out = await probeVideo(outputPath);

    return {
      url,
      storagePath,
      width: out.width,
      height: out.height,
      size: buffer.length,
      container: rendition.container,
      codec: rendition.codec,
      bitrate: rendition.bitrate,
    };
  }

  private async encodePoster(
    pipeline: sharp.Sharp,
    format: 'webp' | 'avif',
    assetId: string,
    variantName: string,
  ): Promise<PosterArtefact> {
    const { data, info } = await pipeline
      .toFormat(format, { quality: 80 })
      .toBuffer({ resolveWithObject: true });

    const filename = `assets/${assetId}/poster-${variantName}.${format}`;
    const { url, storagePath } = await this.storage.save(data, filename, {
      visibility: 'public',
    });
    return { url, storagePath, width: info.width, height: info.height, size: info.size };
  }

  /**
   * Original deletion — env-gated per R6 (false in production).
   * Idempotent on retry: storage `not-found` is treated as success.
   * Mirrors AV1 image processor; intentionally duplicated until a third
   * processor lands and an extraction is warranted.
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
}

function mapVideoCodec(codec: string): { videoCodec: string; videoProfile?: string } {
  switch (codec) {
    case 'h264-baseline':
      return { videoCodec: 'libx264', videoProfile: 'baseline' };
    case 'h264-main':
      return { videoCodec: 'libx264', videoProfile: 'main' };
    case 'h264-high':
      return { videoCodec: 'libx264', videoProfile: 'high' };
    case 'vp9':
      return { videoCodec: 'libvpx-vp9' };
    default:
      throw new Error(`Unknown video codec: ${codec}`);
  }
}

function mapAudioCodec(audio: string): { audioCodec: string; audioBitrate: string } {
  // Format: '{codec}-{bitrate}k', e.g. 'aac-128k', 'opus-128k'.
  const [codecKey, bitrate] = audio.split('-');
  if (!codecKey || !bitrate) throw new Error(`Unknown audio spec: ${audio}`);
  const audioCodec = codecKey === 'opus' ? 'libopus' : codecKey;
  return { audioCodec, audioBitrate: bitrate };
}

function isStorageNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  if (code === 'ENOENT' || code === 'NoSuchKey') return true;
  const name = (err as { name?: string }).name;
  return name === 'NoSuchKey';
}
