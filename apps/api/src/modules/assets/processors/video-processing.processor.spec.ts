jest.mock('./ffmpeg-wrapper');
jest.mock('fs/promises');
jest.mock('sharp');

import * as fs from 'fs/promises';
import sharp from 'sharp';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { STORAGE_DRIVER, VIDEO_RENDITIONS } from '../assets.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import type { VideoProcessingJobPayload } from '../interfaces/asset-job.interface';
import { extractFrame, probeVideo, transcodeVideo } from './ffmpeg-wrapper';
import { VideoProcessingProcessor } from './video-processing.processor';

const mockedProbeVideo = probeVideo as jest.MockedFunction<typeof probeVideo>;
const mockedTranscodeVideo = transcodeVideo as jest.MockedFunction<typeof transcodeVideo>;
const mockedExtractFrame = extractFrame as jest.MockedFunction<typeof extractFrame>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedSharp = sharp as unknown as jest.Mock;

function makeJob(
  assetId = 'video-asset-1',
  storagePath = 'private/assets/video-asset-1/original.mp4',
): Job<VideoProcessingJobPayload> {
  return {
    data: { assetId, storagePath, mimeType: 'video/mp4' },
  } as Job<VideoProcessingJobPayload>;
}

function buildSharpMock() {
  // Chainable mock that returns an object exposing the methods the processor
  // calls — rotate, resize, clone, toFormat, toBuffer. toBuffer resolves to
  // { data, info } with a synthetic-but-positive shape that matches sharp's
  // resolveWithObject contract.
  const chain: Record<string, unknown> = {};
  chain.rotate = jest.fn(() => chain);
  chain.resize = jest.fn(() => chain);
  chain.clone = jest.fn(() => chain);
  chain.toFormat = jest.fn(() => chain);
  chain.toBuffer = jest.fn(async () => ({
    data: Buffer.from('encoded-poster'),
    info: { width: 150, height: 100, size: 14 },
  }));
  return chain;
}

describe('VideoProcessingProcessor (AV2)', () => {
  let processor: VideoProcessingProcessor;
  let prisma: { asset: { findUnique: jest.Mock; update: jest.Mock } };
  let storage: {
    save: jest.Mock;
    read: jest.Mock;
    delete: jest.Mock;
    signUrl: jest.Mock;
  };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma = {
      asset: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    storage = {
      save: jest.fn(async (_buf: Buffer, name: string) => ({
        url: `https://cdn.test/${name}`,
        storagePath: `assets/${name}`,
      })),
      read: jest.fn(async () => Buffer.from('original-bytes')),
      delete: jest.fn(async () => undefined),
      signUrl: jest.fn(async () => 'https://cdn.test/signed'),
    };
    config = { get: jest.fn((key: string, defaultVal?: unknown) => defaultVal) };

    mockedFs.mkdtemp.mockResolvedValue('/tmp/asset-fixture');
    mockedFs.writeFile.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(Buffer.from('rendition-bytes'));
    mockedFs.rm.mockResolvedValue(undefined);

    mockedProbeVideo.mockImplementation(async (input: string) => {
      // The processor calls probe twice per rendition pass + once at the top.
      // Return canonical desktop-resolution metadata for the input probe and
      // rendition probes alike — the test only asserts shape, not exact values.
      if (input.endsWith('input')) {
        return { durationSeconds: 60, width: 1920, height: 1080 };
      }
      // Rendition outputs — return the cap height in the filename.
      const cap = /\.mp4$|\.webm$/.test(input)
        ? input.includes('mobile')
          ? 480
          : input.includes('tablet')
            ? 720
            : 1080
        : 1080;
      return {
        durationSeconds: 60,
        width: Math.round((cap * 16) / 9),
        height: cap,
      };
    });
    mockedTranscodeVideo.mockResolvedValue(undefined);
    mockedExtractFrame.mockResolvedValue(undefined);

    mockedSharp.mockImplementation(() => buildSharpMock());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: STORAGE_DRIVER, useValue: storage },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    processor = module.get(VideoProcessingProcessor);
  });

  // ── Idempotency short-circuit ───────────────────────────────────────────────

  describe('idempotency on retry', () => {
    it('skips entirely when the asset row is gone', async () => {
      prisma.asset.findUnique.mockResolvedValue(null);
      await processor.process(makeJob());
      expect(storage.read).not.toHaveBeenCalled();
      expect(mockedTranscodeVideo).not.toHaveBeenCalled();
      expect(prisma.asset.update).not.toHaveBeenCalled();
    });

    it('skips transcoding when status is already READY and origin already deleted', async () => {
      prisma.asset.findUnique.mockResolvedValue({
        status: 'READY',
        originalStoragePath: null,
      });
      await processor.process(makeJob());
      expect(storage.read).not.toHaveBeenCalled();
      expect(mockedTranscodeVideo).not.toHaveBeenCalled();
      // No delete attempt — originalStoragePath is null already.
      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.asset.update).not.toHaveBeenCalled();
    });

    it('re-attempts the env-gated deletion when status is READY but originalStoragePath is still set', async () => {
      prisma.asset.findUnique.mockResolvedValue({
        status: 'READY',
        originalStoragePath: 'private/assets/x/original.mp4',
      });
      await processor.process(makeJob());
      expect(mockedTranscodeVideo).not.toHaveBeenCalled();
      expect(storage.delete).toHaveBeenCalledWith('private/assets/x/original.mp4');
      expect(prisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'video-asset-1' },
        data: { originalStoragePath: null },
      });
    });
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  describe('happy path', () => {
    beforeEach(() => {
      prisma.asset.findUnique.mockResolvedValue({
        status: 'PROCESSING',
        originalStoragePath: 'private/assets/video-asset-1/original.mp4',
      });
    });

    it('transcodes every rendition in VIDEO_RENDITIONS', async () => {
      await processor.process(makeJob());
      expect(mockedTranscodeVideo).toHaveBeenCalledTimes(VIDEO_RENDITIONS.length);
      // Each rendition output uses the rendition name + container in the path.
      for (const r of VIDEO_RENDITIONS) {
        expect(mockedTranscodeVideo).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining(`${r.name}.${r.container}`),
          expect.objectContaining({
            capHeight: r.cap,
            format: r.container,
          }),
        );
      }
    });

    it('extracts a poster frame at 25% of duration', async () => {
      await processor.process(makeJob());
      // probe returns durationSeconds=60 → poster at 15s.
      expect(mockedExtractFrame).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('poster.png'),
        15,
      );
    });

    it('writes 4 renditions + 8 poster pairs to public storage', async () => {
      await processor.process(makeJob());
      // 4 renditions + 4 widths × {webp, avif} = 12 saves, all visibility:public.
      expect(storage.save).toHaveBeenCalledTimes(12);
      const visibilities = storage.save.mock.calls.map((args) => args[2]?.visibility);
      expect(visibilities.every((v) => v === 'public')).toBe(true);
    });

    it('flips the asset to READY in a single atomic update with the desktop URL as canonical', async () => {
      await processor.process(makeJob());

      // Two updates: (a) status flip, (b) originalStoragePath nulling after delete.
      expect(prisma.asset.update).toHaveBeenCalledTimes(2);
      const flip = prisma.asset.update.mock.calls[0][0];
      expect(flip.where).toEqual({ id: 'video-asset-1' });
      expect(flip.data).toMatchObject({
        status: 'READY',
        url: expect.stringContaining('desktop.mp4'),
        storagePath: expect.stringContaining('desktop.mp4'),
      });
      // Variants payload contains both image-pair top level and renditions.
      expect(flip.data.variants).toHaveProperty('renditions');
      expect(flip.data.variants).toHaveProperty('large');
      expect(flip.data.variants.renditions).toHaveProperty('mobile');
      expect(flip.data.variants.renditions).toHaveProperty('desktop-webm');
    });

    it('deletes the original after the atomic update when RETAIN_ORIGINALS is false', async () => {
      config.get.mockImplementation((key: string, def?: unknown) =>
        key === 'RETAIN_ORIGINALS' ? 'false' : def,
      );
      await processor.process(makeJob());
      expect(storage.delete).toHaveBeenCalledWith('private/assets/video-asset-1/original.mp4');
      const nullify = prisma.asset.update.mock.calls[1][0];
      expect(nullify.data).toEqual({ originalStoragePath: null });
    });

    it('retains the original when RETAIN_ORIGINALS=true', async () => {
      config.get.mockImplementation((key: string, def?: unknown) =>
        key === 'RETAIN_ORIGINALS' ? 'true' : def,
      );
      await processor.process(makeJob());
      expect(storage.delete).not.toHaveBeenCalled();
      // Only the READY-flip update fires; no second update for nullification.
      expect(prisma.asset.update).toHaveBeenCalledTimes(1);
    });
  });

  // ── Failure paths ───────────────────────────────────────────────────────────

  describe('failure paths', () => {
    beforeEach(() => {
      prisma.asset.findUnique.mockResolvedValue({
        status: 'PROCESSING',
        originalStoragePath: 'private/assets/video-asset-1/original.mp4',
      });
    });

    it('flips status to FAILED when storage.read throws', async () => {
      storage.read.mockRejectedValue(new Error('storage offline'));
      await expect(processor.process(makeJob())).rejects.toThrow('storage offline');
      const failedUpdate = prisma.asset.update.mock.calls.find(
        ([call]) => call.data?.status === 'FAILED',
      );
      expect(failedUpdate).toBeDefined();
    });

    it('flips status to FAILED when transcodeVideo throws', async () => {
      mockedTranscodeVideo.mockRejectedValue(new Error('ffmpeg crash'));
      await expect(processor.process(makeJob())).rejects.toThrow('ffmpeg crash');
      const failedUpdate = prisma.asset.update.mock.calls.find(
        ([call]) => call.data?.status === 'FAILED',
      );
      expect(failedUpdate).toBeDefined();
    });

    it('cleans up the temp dir even on failure', async () => {
      storage.read.mockRejectedValue(new Error('read fail'));
      await expect(processor.process(makeJob())).rejects.toThrow();
      expect(mockedFs.rm).toHaveBeenCalledWith(
        '/tmp/asset-fixture',
        expect.objectContaining({ recursive: true, force: true }),
      );
    });
  });

  // ── Deletion idempotency ────────────────────────────────────────────────────

  describe('maybeDeleteOriginal — idempotent on retry', () => {
    beforeEach(() => {
      prisma.asset.findUnique.mockResolvedValue({
        status: 'PROCESSING',
        originalStoragePath: 'private/assets/video-asset-1/original.mp4',
      });
    });

    it('treats ENOENT (local) as success — second-pass retry safe', async () => {
      const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
      storage.delete.mockRejectedValueOnce(enoent);
      await expect(processor.process(makeJob())).resolves.toBeUndefined();
      // Second update still nullifies the path.
      const nullify = prisma.asset.update.mock.calls[1][0];
      expect(nullify.data).toEqual({ originalStoragePath: null });
    });

    it('treats NoSuchKey (S3) as success', async () => {
      const noSuchKey = Object.assign(new Error('not found'), { code: 'NoSuchKey' });
      storage.delete.mockRejectedValueOnce(noSuchKey);
      await expect(processor.process(makeJob())).resolves.toBeUndefined();
    });

    it('rethrows on any other storage error', async () => {
      storage.delete.mockRejectedValueOnce(
        Object.assign(new Error('access denied'), { code: 'AccessDenied' }),
      );
      await expect(processor.process(makeJob())).rejects.toThrow('access denied');
    });

    // AV2 nit #1 / AV3 — `maybeDeleteOriginal` runs OUTSIDE the outer
    // try/catch. A non-not-found delete error after a successful READY flip
    // must NOT demote the row back to FAILED.
    it('keeps the row READY when storage.delete fails AFTER the READY flip', async () => {
      storage.delete.mockRejectedValueOnce(
        Object.assign(new Error('access denied'), { code: 'AccessDenied' }),
      );
      await expect(processor.process(makeJob())).rejects.toThrow('access denied');
      const failedUpdate = prisma.asset.update.mock.calls.find(
        ([call]) => call.data?.status === 'FAILED',
      );
      expect(failedUpdate).toBeUndefined();
      const readyUpdate = prisma.asset.update.mock.calls.find(
        ([call]) => call.data?.status === 'READY',
      );
      expect(readyUpdate).toBeDefined();
    });
  });
});
