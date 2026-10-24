import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { AssetStatus, AssetType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetFailedError, AssetNotReadyError, AssetVariantMissingError } from './errors';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ReturnsService } from '../returns/returns.service';
import { StorefrontConfigService } from '../storefront-config/storefront-config.service';
import { AssetsService } from './assets.service';
import { IMAGE_PROCESSING_QUEUE, STORAGE_DRIVER, VIDEO_PROCESSING_QUEUE } from './assets.constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal valid JPEG buffer (FF D8 FF + padding). */
function makeJpegBuffer(size = 1024): Buffer {
  const buf = Buffer.alloc(size, 0x00);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

/** Minimal valid PNG buffer. */
function makePngBuffer(size = 1024): Buffer {
  const buf = Buffer.alloc(size, 0x00);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  return buf;
}

/** WebM magic bytes. */
function makeWebmBuffer(size = 1024): Buffer {
  const buf = Buffer.alloc(size, 0x00);
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

function multerFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'test.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    buffer: makeJpegBuffer(),
    size: 1024,
    destination: '',
    filename: '',
    path: '',
    stream: null as any,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AssetsService', () => {
  let service: AssetsService;
  let prisma: {
    asset: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
    };
    productAsset: { count: jest.Mock };
    reviewAsset: { count: jest.Mock };
    returnAsset: { count: jest.Mock };
    category: { count: jest.Mock };
  };
  let storageDriver: { save: jest.Mock; read: jest.Mock; signUrl: jest.Mock };
  let imageQueue: { add: jest.Mock };
  let videoQueue: { add: jest.Mock };
  let products: { findByAssetId: jest.Mock; findVariantsByDownloadAssetId: jest.Mock };
  let categories: { findByImageId: jest.Mock };
  let reviews: { findByAssetId: jest.Mock };
  let returns: { findByAssetId: jest.Mock };
  let storefrontConfig: { findSectionsByAssetId: jest.Mock };

  const createdAsset = {
    id: 'uuid-1',
    type: AssetType.IMAGE,
    mimeType: 'image/jpeg',
    fileSize: 1024,
    status: AssetStatus.PROCESSING,
    storagePath: '',
    url: '',
    originalStoragePath: 'private/assets/uuid-1/original.jpg',
    blurhash: null,
    variants: null,
    width: null,
    height: null,
    duration: null,
    alt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      asset: {
        create: jest.fn().mockResolvedValue(createdAsset),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
      productAsset: { count: jest.fn() },
      reviewAsset: { count: jest.fn() },
      returnAsset: { count: jest.fn() },
      category: { count: jest.fn() },
    };
    storageDriver = {
      // AV1: save returns the private path + empty url for `visibility: 'private'`
      // and the public path + url for `'public'`. The default in the suite is
      // private (AV1's upload flow); individual tests override as needed.
      save: jest
        .fn()
        .mockImplementation(
          (_buf: Buffer, name: string, opts?: { visibility?: 'public' | 'private' }) => {
            const visibility = opts?.visibility ?? 'public';
            if (visibility === 'private') {
              return Promise.resolve({ storagePath: `private/${name}`, url: '' });
            }
            return Promise.resolve({
              storagePath: name,
              url: `http://localhost:53000/uploads/${name}`,
            });
          },
        ),
      read: jest.fn(),
      signUrl: jest.fn(),
    };
    imageQueue = { add: jest.fn().mockResolvedValue(undefined) };
    videoQueue = { add: jest.fn().mockResolvedValue(undefined) };
    products = {
      findByAssetId: jest.fn().mockResolvedValue([]),
      findVariantsByDownloadAssetId: jest.fn().mockResolvedValue([]),
    };
    categories = { findByImageId: jest.fn().mockResolvedValue([]) };
    reviews = { findByAssetId: jest.fn().mockResolvedValue([]) };
    returns = { findByAssetId: jest.fn().mockResolvedValue([]) };
    storefrontConfig = { findSectionsByAssetId: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn((key, def) => def) } },
        { provide: STORAGE_DRIVER, useValue: storageDriver },
        { provide: getQueueToken(IMAGE_PROCESSING_QUEUE), useValue: imageQueue },
        { provide: getQueueToken(VIDEO_PROCESSING_QUEUE), useValue: videoQueue },
        { provide: ProductsService, useValue: products },
        { provide: CategoriesService, useValue: categories },
        { provide: ReviewsService, useValue: reviews },
        { provide: ReturnsService, useValue: returns },
        { provide: StorefrontConfigService, useValue: storefrontConfig },
      ],
    }).compile();

    service = module.get(AssetsService);
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  describe('upload — image', () => {
    it('saves the raw file to private storage (AV1 flip)', async () => {
      await service.upload(multerFile());
      expect(storageDriver.save).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/^assets\/[^/]+\/original\.jpg$/),
        { visibility: 'private' },
      );
    });

    it('persists originalStoragePath as the private storage path; url + storagePath blank until processor flip (AV1)', async () => {
      await service.upload(multerFile());
      const call = prisma.asset.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.originalStoragePath).toMatch(/^private\/assets\/[^/]+\/original\.jpg$/);
      expect(call.data.url).toBe('');
      expect(call.data.storagePath).toBe('');
    });

    it('creates an asset record with PROCESSING status', async () => {
      await service.upload(multerFile());
      expect(prisma.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AssetStatus.PROCESSING,
            type: AssetType.IMAGE,
            mimeType: 'image/jpeg',
          }),
        }),
      );
    });

    it('enqueues an image processing job', async () => {
      await service.upload(multerFile());
      expect(imageQueue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ assetId: expect.any(String) }),
      );
      expect(videoQueue.add).not.toHaveBeenCalled();
    });

    it('returns the asset record immediately', async () => {
      const result = await service.upload(multerFile());
      expect(result).toEqual(createdAsset);
    });
  });

  describe('upload — video (AV2 — FFmpeg pipeline lifts AV1 rejection)', () => {
    const createdVideoAsset = {
      ...createdAsset,
      id: 'uuid-video-1',
      type: AssetType.VIDEO,
      mimeType: 'video/webm',
      originalStoragePath: 'private/assets/uuid-video-1/original.webm',
    };

    beforeEach(() => {
      prisma.asset.create.mockResolvedValue(createdVideoAsset);
    });

    it('saves the raw video to private storage', async () => {
      await service.upload(
        multerFile({
          mimetype: 'video/webm',
          buffer: makeWebmBuffer(),
          originalname: 'clip.webm',
        }),
      );
      expect(storageDriver.save).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/^assets\/[^/]+\/original\.webm$/),
        { visibility: 'private' },
      );
    });

    it('creates the asset row with VIDEO type and PROCESSING status', async () => {
      await service.upload(
        multerFile({
          mimetype: 'video/webm',
          buffer: makeWebmBuffer(),
          originalname: 'clip.webm',
        }),
      );
      expect(prisma.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AssetStatus.PROCESSING,
            type: AssetType.VIDEO,
            mimeType: 'video/webm',
            url: '',
            storagePath: '',
          }),
        }),
      );
    });

    it('enqueues a video processing job (and NOT an image job)', async () => {
      await service.upload(
        multerFile({
          mimetype: 'video/webm',
          buffer: makeWebmBuffer(),
          originalname: 'clip.webm',
        }),
      );
      expect(videoQueue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({
          assetId: expect.any(String),
          mimeType: 'video/webm',
          storagePath: expect.stringMatching(/^private\/assets\/[^/]+\/original\.webm$/),
        }),
      );
      expect(imageQueue.add).not.toHaveBeenCalled();
    });

    it('accepts video/mp4 too', async () => {
      const mp4 = Buffer.alloc(32, 0x00);
      // ftyp box at offset 4
      mp4[4] = 0x66;
      mp4[5] = 0x74;
      mp4[6] = 0x79;
      mp4[7] = 0x70;
      // brand "isom"
      mp4[8] = 0x69;
      mp4[9] = 0x73;
      mp4[10] = 0x6f;
      mp4[11] = 0x6d;
      await expect(
        service.upload(
          multerFile({ mimetype: 'video/mp4', buffer: mp4, originalname: 'clip.mp4' }),
        ),
      ).resolves.toBeDefined();
      expect(videoQueue.add).toHaveBeenCalled();
    });

    it('returns the asset record immediately (no wait for transcode)', async () => {
      const result = await service.upload(
        multerFile({
          mimetype: 'video/webm',
          buffer: makeWebmBuffer(),
          originalname: 'clip.webm',
        }),
      );
      expect(result).toEqual(createdVideoAsset);
    });
  });

  describe('upload — PNG', () => {
    it('accepts a valid PNG file', async () => {
      await expect(
        service.upload(
          multerFile({ mimetype: 'image/png', buffer: makePngBuffer(), originalname: 'img.png' }),
        ),
      ).resolves.not.toThrow();
    });
  });

  // ── Validation failures ──────────────────────────────────────────────────────

  describe('validateFile', () => {
    it('throws when no buffer is present', async () => {
      await expect(
        service.upload(multerFile({ buffer: Buffer.alloc(0), size: 0 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when MIME type is not on the allowlist', async () => {
      const gif = Buffer.alloc(16, 0x47); // not a real GIF, but MIME matters first
      await expect(
        service.upload(multerFile({ mimetype: 'image/gif', buffer: gif })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when magic bytes do not match declared MIME type', async () => {
      // Declare JPEG but supply PNG bytes.
      await expect(
        service.upload(multerFile({ mimetype: 'image/jpeg', buffer: makePngBuffer() })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when file exceeds max size', async () => {
      const oversized = Buffer.alloc(11 * 1024 * 1024, 0x00);
      oversized[0] = 0xff;
      oversized[1] = 0xd8;
      oversized[2] = 0xff;
      await expect(
        service.upload(multerFile({ buffer: oversized, size: oversized.length })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when buffer is too short for magic byte detection', async () => {
      const tinyBuf = Buffer.from([0xff, 0xd8]); // only 2 bytes
      await expect(service.upload(multerFile({ buffer: tinyBuf, size: 2 }))).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── UUID filename — never user-supplied ─────────────────────────────────────

  it('stores the file under a UUID path, ignoring originalname', async () => {
    await service.upload(multerFile({ originalname: '../../evil.jpg' }));
    const [, savedFilename] = storageDriver.save.mock.calls[0] as [Buffer, string];
    expect(savedFilename).not.toContain('..');
    expect(savedFilename).toMatch(/^assets\/[0-9a-f-]{36}\/original\.\w+$/);
  });

  // ── Admin reads ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns paginated rows with applied filters', async () => {
      prisma.asset.findMany.mockResolvedValue([createdAsset]);
      prisma.asset.count.mockResolvedValue(1);
      const res = await service.list({
        page: 1,
        pageSize: 10,
        type: AssetType.IMAGE,
        status: AssetStatus.READY,
      });
      expect(res.meta).toEqual({ page: 1, pageSize: 10, total: 1 });
      expect(prisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: AssetType.IMAGE, status: AssetStatus.READY }),
        }),
      );
    });

    it('applies date range when from/to supplied', async () => {
      prisma.asset.findMany.mockResolvedValue([]);
      prisma.asset.count.mockResolvedValue(0);
      await service.list({
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-15T00:00:00.000Z',
      });
      const call = prisma.asset.findMany.mock.calls[0][0];
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
      expect(call.where.createdAt.lte).toBeInstanceOf(Date);
    });
  });

  describe('findOne', () => {
    it('404s when the asset is missing', async () => {
      prisma.asset.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns the asset with usage counts', async () => {
      prisma.asset.findUnique.mockResolvedValue(createdAsset);
      prisma.productAsset.count.mockResolvedValue(2);
      prisma.reviewAsset.count.mockResolvedValue(1);
      prisma.returnAsset.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(1);
      const res = await service.findOne('uuid-1');
      expect(res.usage).toEqual({
        products: 2,
        reviews: 1,
        returns: 0,
        categories: 1,
        total: 4,
      });
    });
  });

  describe('remove', () => {
    it('404s when the asset is missing', async () => {
      prisma.asset.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hard-deletes the row by id when no references exist (DR-07)', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'uuid-1' });
      prisma.asset.delete.mockResolvedValue(createdAsset);
      await service.remove('uuid-1');
      expect(prisma.asset.delete).toHaveBeenCalledWith({ where: { id: 'uuid-1' } });
    });

    it('throws ConflictException when references > 0 (DR-07)', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'uuid-1' });
      products.findByAssetId.mockResolvedValue([
        { id: 'prod-1', name: { default: 'Tee' }, slug: 'classic-tee' },
      ]);

      await expect(service.remove('uuid-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.asset.delete).not.toHaveBeenCalled();
    });

    it('exposes the references payload via the conflict response', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'uuid-1' });
      categories.findByImageId.mockResolvedValue([
        { id: 'cat-1', name: { default: 'Cat' }, slug: 'cat' },
      ]);

      try {
        await service.remove('uuid-1');
        fail('Expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse() as {
          error: {
            code: string;
            details: { references: { total: number; categories: unknown[] } };
          };
        };
        expect(response.error.code).toBe('ASSET_REFERENCED');
        expect(response.error.details.references.total).toBe(1);
        expect(response.error.details.references.categories).toHaveLength(1);
      }
    });
  });

  // ── getReferences (S18 — DR-07) ─────────────────────────────────────────────

  describe('getReferences', () => {
    it('aggregates reference rows from the five owning services', async () => {
      products.findByAssetId.mockResolvedValue([
        { id: 'prod-1', name: { default: 'Tee' }, slug: 'classic-tee' },
      ]);
      products.findVariantsByDownloadAssetId.mockResolvedValue([
        { id: 'var-1', productId: 'prod-1', productSlug: 'digital-album', sku: 'SKU-1' },
      ]);
      reviews.findByAssetId.mockResolvedValue([
        { id: 'rev-1', productSlug: 'mug', customerName: 'Layla Saab' },
      ]);
      returns.findByAssetId.mockResolvedValue([
        { id: 'ret-1', returnNumber: 'RET-2026-000001', customerName: 'Mariam Hashim' },
      ]);
      categories.findByImageId.mockResolvedValue([
        { id: 'cat-1', name: { default: 'Cat' }, slug: 'electronics' },
      ]);

      const refs = await service.getReferences('uuid-1');

      expect(refs.products[0]).toEqual({
        kind: 'product',
        id: 'prod-1',
        label: 'classic-tee',
        route: '/products/prod-1/edit',
      });
      expect(refs.variants[0]).toEqual({
        kind: 'variant',
        id: 'var-1',
        label: 'digital-album · SKU-1',
        route: '/products/prod-1/edit',
      });
      expect(refs.reviews[0]).toEqual({
        kind: 'review',
        id: 'rev-1',
        label: 'mug · Layla Saab',
        route: '/reviews/rev-1',
      });
      expect(refs.returns[0]).toEqual({
        kind: 'return',
        id: 'ret-1',
        label: 'RET-2026-000001 · Mariam Hashim',
        route: '/returns/ret-1',
      });
      expect(refs.categories[0]).toEqual({
        kind: 'category',
        id: 'cat-1',
        label: 'electronics',
        route: '/categories/cat-1',
      });
      expect(refs.sections).toEqual([]);
      expect(refs.total).toBe(5);
    });

    it('honours the type filter — only that kind is queried', async () => {
      products.findByAssetId.mockResolvedValue([
        { id: 'prod-1', name: { default: 'Tee' }, slug: 'classic-tee' },
      ]);

      const refs = await service.getReferences('uuid-1', { type: 'product' });

      expect(products.findByAssetId).toHaveBeenCalledWith('uuid-1');
      expect(products.findVariantsByDownloadAssetId).not.toHaveBeenCalled();
      expect(reviews.findByAssetId).not.toHaveBeenCalled();
      expect(returns.findByAssetId).not.toHaveBeenCalled();
      expect(categories.findByImageId).not.toHaveBeenCalled();
      expect(refs.products).toHaveLength(1);
      expect(refs.variants).toEqual([]);
      expect(refs.reviews).toEqual([]);
      expect(refs.returns).toEqual([]);
      expect(refs.categories).toEqual([]);
      expect(refs.sections).toEqual([]);
      expect(refs.total).toBe(1);
    });

    it('returns an empty payload when nothing references the asset', async () => {
      const refs = await service.getReferences('uuid-1');
      expect(refs.total).toBe(0);
      expect(refs.products).toEqual([]);
      expect(refs.sections).toEqual([]);
    });

    it('falls back to id label when review payload is missing slug + name', async () => {
      reviews.findByAssetId.mockResolvedValue([{ id: 'rev-2', productSlug: '', customerName: '' }]);
      const refs = await service.getReferences('uuid-1');
      expect(refs.reviews[0]?.label).toBe('rev-2');
    });

    it('populates JSONB section references via StorefrontConfigService', async () => {
      storefrontConfig.findSectionsByAssetId.mockResolvedValue([
        { id: 'sec-hero', pageSlug: 'home', type: 'HERO', sortOrder: 0 },
        {
          id: 'sec-promo',
          pageSlug: 'collections/summer',
          type: 'PROMOTIONAL_BANNER',
          sortOrder: 2,
        },
      ]);

      const refs = await service.getReferences('uuid-1');

      expect(storefrontConfig.findSectionsByAssetId).toHaveBeenCalledWith('uuid-1');
      expect(refs.sections).toHaveLength(2);
      expect(refs.sections[0]).toEqual({
        kind: 'section',
        id: 'sec-hero',
        label: 'home · hero',
        route: '/storefront/sections/sec-hero/edit',
      });
      expect(refs.sections[1]).toEqual({
        kind: 'section',
        id: 'sec-promo',
        label: 'collections/summer · promotional banner',
        route: '/storefront/sections/sec-promo/edit',
      });
      expect(refs.total).toBe(2);
    });

    it('honours the type=section filter and skips other discovery calls', async () => {
      storefrontConfig.findSectionsByAssetId.mockResolvedValue([
        { id: 'sec-hero', pageSlug: 'home', type: 'HERO', sortOrder: 0 },
      ]);

      const refs = await service.getReferences('uuid-1', { type: 'section' });

      expect(products.findByAssetId).not.toHaveBeenCalled();
      expect(reviews.findByAssetId).not.toHaveBeenCalled();
      expect(returns.findByAssetId).not.toHaveBeenCalled();
      expect(categories.findByImageId).not.toHaveBeenCalled();
      expect(storefrontConfig.findSectionsByAssetId).toHaveBeenCalledWith('uuid-1');
      expect(refs.sections).toHaveLength(1);
      expect(refs.total).toBe(1);
    });

    it('blocks hard-delete when only a section references the asset', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'uuid-1' });
      storefrontConfig.findSectionsByAssetId.mockResolvedValue([
        { id: 'sec-hero', pageSlug: 'home', type: 'HERO', sortOrder: 0 },
      ]);

      await expect(service.remove('uuid-1')).rejects.toThrow(ConflictException);
      expect(prisma.asset.delete).not.toHaveBeenCalled();
    });
  });

  // ── publicVariantUrl + publicProjection (AV1) ──────────────────────────────

  describe('publicVariantUrl', () => {
    function makeArtefact(name: string, format: 'webp' | 'avif', width: number) {
      return {
        url: `https://cdn.example.com/${name}.${format}`,
        storagePath: `assets/uuid-1/${name}.${format}`,
        width,
        height: Math.round(width * 0.66),
        size: 12345,
      };
    }

    function readyAsset(overrides: Record<string, unknown> = {}) {
      return {
        id: 'uuid-1',
        type: AssetType.IMAGE,
        status: AssetStatus.READY,
        mimeType: 'image/webp',
        url: 'https://cdn.example.com/large.webp',
        storagePath: 'assets/uuid-1/large.webp',
        originalStoragePath: null,
        variants: {
          thumbnail: {
            webp: makeArtefact('thumbnail', 'webp', 150),
            avif: makeArtefact('thumbnail', 'avif', 150),
          },
          small: {
            webp: makeArtefact('small', 'webp', 400),
            avif: makeArtefact('small', 'avif', 400),
          },
          medium: {
            webp: makeArtefact('medium', 'webp', 800),
            avif: makeArtefact('medium', 'avif', 800),
          },
          large: {
            webp: makeArtefact('large', 'webp', 1200),
            avif: makeArtefact('large', 'avif', 1200),
          },
        },
        ...overrides,
      };
    }

    it('thumbnail intent returns thumbnail webp variant', () => {
      const result = service.publicVariantUrl(readyAsset(), 'thumbnail');
      expect(result.url).toBe('https://cdn.example.com/thumbnail.webp');
      expect(result.width).toBe(150);
      expect(result.format).toBe('webp');
    });

    it('card intent returns small variant', () => {
      const result = service.publicVariantUrl(readyAsset(), 'card');
      expect(result.url).toBe('https://cdn.example.com/small.webp');
      expect(result.width).toBe(400);
    });

    it('banner intent returns medium variant', () => {
      const result = service.publicVariantUrl(readyAsset(), 'banner');
      expect(result.url).toBe('https://cdn.example.com/medium.webp');
      expect(result.width).toBe(800);
    });

    it('hero intent returns large variant', () => {
      const result = service.publicVariantUrl(readyAsset(), 'hero');
      expect(result.url).toBe('https://cdn.example.com/large.webp');
      expect(result.width).toBe(1200);
    });

    it('detail intent returns large variant', () => {
      const result = service.publicVariantUrl(readyAsset(), 'detail');
      expect(result.url).toBe('https://cdn.example.com/large.webp');
      expect(result.width).toBe(1200);
    });

    it('exposes the full variant set via srcset', () => {
      const result = service.publicVariantUrl(readyAsset(), 'hero');
      expect(result.srcset).toBeDefined();
      expect(result.srcset!.length).toBe(8);
      expect(result.srcset).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: expect.stringContaining('large.webp'),
            width: 1200,
            format: 'webp',
          }),
          expect.objectContaining({
            url: expect.stringContaining('large.avif'),
            width: 1200,
            format: 'avif',
          }),
        ]),
      );
    });

    it('throws AssetNotReadyError when status is PROCESSING', () => {
      expect(() =>
        service.publicVariantUrl(readyAsset({ status: AssetStatus.PROCESSING }), 'hero'),
      ).toThrow(AssetNotReadyError);
    });

    it('throws AssetNotReadyError when status is PENDING', () => {
      expect(() =>
        service.publicVariantUrl(readyAsset({ status: AssetStatus.PENDING }), 'hero'),
      ).toThrow(AssetNotReadyError);
    });

    it('throws AssetFailedError when status is FAILED', () => {
      expect(() =>
        service.publicVariantUrl(readyAsset({ status: AssetStatus.FAILED }), 'hero'),
      ).toThrow(AssetFailedError);
    });

    it('throws AssetVariantMissingError when variants is null', () => {
      expect(() => service.publicVariantUrl(readyAsset({ variants: null }), 'hero')).toThrow(
        AssetVariantMissingError,
      );
    });

    it('throws AssetVariantMissingError when the requested variant key is absent', () => {
      const broken = readyAsset();
      delete (broken.variants as Record<string, unknown>).large;
      expect(() => service.publicVariantUrl(broken, 'hero')).toThrow(AssetVariantMissingError);
    });
  });

  describe('publicProjection', () => {
    function readyAssetRow(id: string) {
      const url = (n: string, f: string) => `https://cdn/${id}/${n}.${f}`;
      const a = (n: string, f: 'webp' | 'avif', w: number) => ({
        url: url(n, f),
        storagePath: `assets/${id}/${n}.${f}`,
        width: w,
        height: Math.round(w * 0.66),
        size: 100,
      });
      return {
        id,
        type: AssetType.IMAGE,
        status: AssetStatus.READY,
        mimeType: 'image/webp',
        url: url('large', 'webp'),
        storagePath: `assets/${id}/large.webp`,
        originalStoragePath: null,
        variants: {
          thumbnail: { webp: a('thumbnail', 'webp', 150), avif: a('thumbnail', 'avif', 150) },
          small: { webp: a('small', 'webp', 400), avif: a('small', 'avif', 400) },
          medium: { webp: a('medium', 'webp', 800), avif: a('medium', 'avif', 800) },
          large: { webp: a('large', 'webp', 1200), avif: a('large', 'avif', 1200) },
        },
      };
    }

    it('returns an empty Map when ids is empty', async () => {
      const result = await service.publicProjection([], 'thumbnail');
      expect(result.size).toBe(0);
      expect(prisma.asset.findMany).not.toHaveBeenCalled();
    });

    it('returns a Map of id → PublicVariantUrl for READY assets', async () => {
      prisma.asset.findMany.mockResolvedValue([readyAssetRow('a-1'), readyAssetRow('a-2')]);
      const result = await service.publicProjection(['a-1', 'a-2'], 'thumbnail');
      expect(result.size).toBe(2);
      expect(result.get('a-1')?.url).toContain('a-1/thumbnail.webp');
      expect(result.get('a-2')?.url).toContain('a-2/thumbnail.webp');
    });

    it('omits ids absent from the database', async () => {
      prisma.asset.findMany.mockResolvedValue([readyAssetRow('a-1')]);
      const result = await service.publicProjection(['a-1', 'a-missing'], 'card');
      expect(result.has('a-1')).toBe(true);
      expect(result.has('a-missing')).toBe(false);
    });

    it('omits ids whose asset is not READY', async () => {
      const processing = { ...readyAssetRow('a-1'), status: AssetStatus.PROCESSING };
      const failed = { ...readyAssetRow('a-2'), status: AssetStatus.FAILED };
      prisma.asset.findMany.mockResolvedValue([processing, failed, readyAssetRow('a-3')]);
      const result = await service.publicProjection(['a-1', 'a-2', 'a-3'], 'banner');
      expect(result.size).toBe(1);
      expect(result.has('a-3')).toBe(true);
    });

    it('deduplicates repeated ids before the database query', async () => {
      prisma.asset.findMany.mockResolvedValue([readyAssetRow('a-1')]);
      await service.publicProjection(['a-1', 'a-1', 'a-1'], 'thumbnail');
      const call = prisma.asset.findMany.mock.calls[0][0] as {
        where: { id: { in: string[] } };
      };
      expect(call.where.id.in).toEqual(['a-1']);
    });
  });

  // ── getOriginalUrl (AV1 — admin signed-URL endpoint) ───────────────────────

  describe('getOriginalUrl', () => {
    it('returns { url, expiresAt } from storage.signUrl with a 5-minute TTL', async () => {
      prisma.asset.findUnique.mockResolvedValue({
        id: 'uuid-1',
        status: 'READY',
        originalStoragePath: 'private/assets/uuid-1/original.jpg',
      });
      storageDriver.signUrl.mockResolvedValue('https://example/signed?token=abc&exp=1746000300');
      const before = Date.now();
      const res = await service.getOriginalUrl('uuid-1');
      const after = Date.now();

      expect(storageDriver.signUrl).toHaveBeenCalledWith('private/assets/uuid-1/original.jpg', 300);
      expect(res.url).toBe('https://example/signed?token=abc&exp=1746000300');
      const expMs = new Date(res.expiresAt).getTime();
      // expiresAt should be ~5 minutes from now (allow 2 s slack for test scheduler)
      expect(expMs).toBeGreaterThanOrEqual(before + 300 * 1000 - 2000);
      expect(expMs).toBeLessThanOrEqual(after + 300 * 1000 + 2000);
    });

    it('throws NotFoundException when the asset is missing', async () => {
      prisma.asset.findUnique.mockResolvedValue(null);
      await expect(service.getOriginalUrl('missing')).rejects.toThrow();
    });

    it('throws NotFoundException when originalStoragePath is NULL', async () => {
      prisma.asset.findUnique.mockResolvedValue({
        id: 'uuid-1',
        status: 'READY',
        originalStoragePath: null,
      });
      await expect(service.getOriginalUrl('uuid-1')).rejects.toThrow();
      expect(storageDriver.signUrl).not.toHaveBeenCalled();
    });

    // AV1 nit #4 / AV3 — status guard. PENDING rows have not yet had the
    // upload buffer persisted; signing the storage path would yield 404
    // against the driver. Deny early per §3.5 deny-by-default.
    it('throws NotFoundException when status is PENDING', async () => {
      prisma.asset.findUnique.mockResolvedValue({
        id: 'uuid-1',
        status: 'PENDING',
        originalStoragePath: 'private/assets/uuid-1/original.jpg',
      });
      await expect(service.getOriginalUrl('uuid-1')).rejects.toThrow(/PENDING/);
      expect(storageDriver.signUrl).not.toHaveBeenCalled();
    });

    // PROCESSING / FAILED rows still allow original access — admin operators
    // may need to re-process or audit; the original buffer is still on disk
    // until the post-cutover delete runs.
    it('allows PROCESSING + FAILED rows so admin can re-process / audit', async () => {
      for (const status of ['PROCESSING', 'FAILED'] as const) {
        prisma.asset.findUnique.mockResolvedValueOnce({
          id: 'uuid-1',
          status,
          originalStoragePath: 'private/assets/uuid-1/original.jpg',
        });
        storageDriver.signUrl.mockResolvedValueOnce('https://example/signed');
        await expect(service.getOriginalUrl('uuid-1')).resolves.toMatchObject({
          url: 'https://example/signed',
        });
      }
    });
  });
});
