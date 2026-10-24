import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { AssetsService, type AssetUploadEvent } from './assets.service';

const ISO_NOW = '2026-04-21T10:00:00.000Z';

/**
 * AV3 — `variants` payload mirrors the canonical `assetVariantsSchema` shape
 * from `libs/shared/common/src/asset-variants`. Each pair carries `webp` +
 * `avif` artefacts at four widths. The admin shim re-parses through the
 * canonical schema so any drift here would fail the resolver call.
 */
const variantsFixture = {
  thumbnail: {
    webp: {
      url: 'https://cdn.example.com/assets/a-thumb.webp',
      storagePath: 'public/a-thumb.webp',
      width: 160,
      height: 120,
      size: 512,
    },
    avif: {
      url: 'https://cdn.example.com/assets/a-thumb.avif',
      storagePath: 'public/a-thumb.avif',
      width: 160,
      height: 120,
      size: 480,
    },
  },
  small: {
    webp: {
      url: 'https://cdn.example.com/assets/a-small.webp',
      storagePath: 'public/a-small.webp',
      width: 320,
      height: 240,
      size: 1024,
    },
    avif: {
      url: 'https://cdn.example.com/assets/a-small.avif',
      storagePath: 'public/a-small.avif',
      width: 320,
      height: 240,
      size: 960,
    },
  },
  medium: {
    webp: {
      url: 'https://cdn.example.com/assets/a-medium.webp',
      storagePath: 'public/a-medium.webp',
      width: 640,
      height: 480,
      size: 2048,
    },
    avif: {
      url: 'https://cdn.example.com/assets/a-medium.avif',
      storagePath: 'public/a-medium.avif',
      width: 640,
      height: 480,
      size: 1900,
    },
  },
  large: {
    webp: {
      url: 'https://cdn.example.com/assets/a-large.webp',
      storagePath: 'public/a-large.webp',
      width: 1280,
      height: 960,
      size: 4096,
    },
    avif: {
      url: 'https://cdn.example.com/assets/a-large.avif',
      storagePath: 'public/a-large.avif',
      width: 1280,
      height: 960,
      size: 3800,
    },
  },
};

const assetFixture = {
  id: '54f5c9a4-1a1a-4a4a-8a8a-555555555555',
  url: 'https://cdn.example.com/assets/a.webp',
  status: 'PROCESSING',
  type: 'IMAGE',
  mimeType: 'image/webp',
  fileSize: 2048,
  variants: variantsFixture,
  originalStoragePath: null,
  createdAt: ISO_NOW,
  updatedAt: ISO_NOW,
};

const assetWithUsageFixture = {
  ...assetFixture,
  status: 'READY',
  usage: {
    products: 0,
    reviews: 0,
    returns: 0,
    categories: 0,
    total: 0,
  },
};

describe('AssetsService', () => {
  let service: AssetsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        AssetsService,
      ],
    });
    service = TestBed.inject(AssetsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ── upload ─────────────────────────────────────────────────────────────────

  it('upload() POSTs multipart with the file field', (done) => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.webp', { type: 'image/webp' });
    service.upload(file).subscribe((asset) => {
      expect(asset.id).toBe(assetFixture.id);
      done();
    });
    const req = http.expectOne('/api/v1/admin/assets/upload');
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush({ data: assetFixture });
  });

  it('upload() rejects a malformed response via Zod', (done) => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    service.upload(file).subscribe({
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    http.expectOne('/api/v1/admin/assets/upload').flush({ data: { id: 'not-a-uuid' } });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  it('list() GETs the endpoint + parses the envelope + meta', (done) => {
    service.list({ page: 2, pageSize: 10, type: 'IMAGE', status: 'READY' }).subscribe((res) => {
      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe(assetFixture.id);
      expect(res.meta.page).toBe(2);
      expect(res.meta.total).toBe(25);
      done();
    });
    const req = http.expectOne(
      (r) =>
        r.url === '/api/v1/admin/assets' &&
        r.params.get('page') === '2' &&
        r.params.get('pageSize') === '10' &&
        r.params.get('type') === 'IMAGE' &&
        r.params.get('status') === 'READY',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ data: [assetFixture], meta: { page: 2, pageSize: 10, total: 25 } });
  });

  it('list() with no params sends no query string', (done) => {
    service.list().subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/assets');
    expect(req.request.params.keys()).toHaveLength(0);
    req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it('list() rejects a malformed meta via Zod', (done) => {
    service.list().subscribe({
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    http.expectOne('/api/v1/admin/assets').flush({ data: [], meta: { page: 'oops' } });
  });

  it('list() propagates HTTP 403', (done) => {
    service.list().subscribe({
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/assets')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'nope' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  // ── get ────────────────────────────────────────────────────────────────────

  it('get() GETs by id + returns AssetWithUsage envelope', (done) => {
    service.get(assetFixture.id).subscribe((asset) => {
      expect(asset.id).toBe(assetFixture.id);
      expect(asset.usage.total).toBe(0);
      expect(asset.usage.products).toBe(0);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/assets/${assetFixture.id}`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: assetWithUsageFixture });
  });

  it('get() rejects a response missing the usage block', (done) => {
    service.get(assetFixture.id).subscribe({
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    // usage block absent — fails assetWithUsageSchema.extend({ usage })
    http.expectOne(`/api/v1/admin/assets/${assetFixture.id}`).flush({ data: assetFixture });
  });

  it('get() propagates HTTP 404', (done) => {
    service.get('missing').subscribe({
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/assets/missing')
      .flush(
        { error: { code: 'NOT_FOUND', message: 'missing' } },
        { status: 404, statusText: 'Not Found' },
      );
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  it('delete() fires DELETE + emits void on 204', (done) => {
    service.delete(assetFixture.id).subscribe((value) => {
      expect(value).toBeUndefined();
      done();
    });
    const req = http.expectOne(`/api/v1/admin/assets/${assetFixture.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('delete() propagates HTTP 404', (done) => {
    service.delete('missing').subscribe({
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/assets/missing')
      .flush(
        { error: { code: 'NOT_FOUND', message: 'missing' } },
        { status: 404, statusText: 'Not Found' },
      );
  });

  it('delete() propagates HTTP 403', (done) => {
    service.delete(assetFixture.id).subscribe({
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/assets/${assetFixture.id}`)
      .flush(
        { error: { code: 'FORBIDDEN', message: 'nope' } },
        { status: 403, statusText: 'Forbidden' },
      );
  });

  // ── uploadWithProgress ─────────────────────────────────────────────────────

  it('uploadWithProgress() emits progress + done events', (done) => {
    const file = new File([new Uint8Array([1])], 'x.webp', { type: 'image/webp' });
    const events: AssetUploadEvent[] = [];
    service.uploadWithProgress(file).subscribe({
      next: (e) => events.push(e),
      complete: () => {
        expect(events.some((e) => e.kind === 'progress')).toBe(true);
        const doneEvent = events.find((e) => e.kind === 'done');
        expect(doneEvent).toBeDefined();
        if (doneEvent?.kind === 'done') {
          expect(doneEvent.asset.id).toBe(assetFixture.id);
        }
        done();
      },
    });
    const req = http.expectOne('/api/v1/admin/assets/upload');
    req.event({ type: 1, loaded: 100, total: 200 } as never);
    req.event({ type: 1, loaded: 200, total: 200 } as never);
    req.flush({ data: assetFixture });
  });

  it('uploadWithProgress() propagates HTTP error', (done) => {
    const file = new File([new Uint8Array([1])], 'x.webp', { type: 'image/webp' });
    service.uploadWithProgress(file).subscribe({
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });
    http
      .expectOne('/api/v1/admin/assets/upload')
      .flush(
        { error: { code: 'BAD_REQUEST', message: 'bad magic' } },
        { status: 400, statusText: 'Bad Request' },
      );
  });

  // ── getReferences (S18 — DR-07) ────────────────────────────────────────────

  describe('getReferences', () => {
    const referencesFixture = {
      products: [{ kind: 'product', id: 'prod-1', label: 'tee', route: '/products/prod-1/edit' }],
      variants: [],
      reviews: [],
      returns: [],
      categories: [],
      sections: [],
      total: 1,
    };

    it('GETs the references endpoint + parses the envelope', (done) => {
      service.getReferences(assetFixture.id).subscribe((refs) => {
        expect(refs.total).toBe(1);
        expect(refs.products).toHaveLength(1);
        expect(refs.products[0].kind).toBe('product');
        done();
      });
      const req = http.expectOne(`/api/v1/admin/assets/${assetFixture.id}/references`);
      expect(req.request.method).toBe('GET');
      req.flush({ data: referencesFixture });
    });

    it('threads the type/page/pageSize filter into query params', (done) => {
      service
        .getReferences(assetFixture.id, { type: 'product', page: 1, pageSize: 50 })
        .subscribe(() => done());
      const req = http.expectOne(
        (r) =>
          r.url === `/api/v1/admin/assets/${assetFixture.id}/references` &&
          r.params.get('type') === 'product' &&
          r.params.get('page') === '1' &&
          r.params.get('pageSize') === '50',
      );
      req.flush({ data: referencesFixture });
    });

    it('rejects a malformed response via Zod', (done) => {
      service.getReferences(assetFixture.id).subscribe({
        error: (err) => {
          expect(err).toBeDefined();
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/assets/${assetFixture.id}/references`)
        .flush({ data: { products: [], total: 'NaN' } });
    });

    it('propagates HTTP 403', (done) => {
      service.getReferences(assetFixture.id).subscribe({
        error: (err) => {
          expect(err).toBeDefined();
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/assets/${assetFixture.id}/references`)
        .flush(
          { error: { code: 'FORBIDDEN', message: 'nope' } },
          { status: 403, statusText: 'Forbidden' },
        );
    });
  });

  // ── getOriginalUrl (AV1 — admin signed-URL endpoint) ───────────────────────

  describe('getOriginalUrl', () => {
    const originalUrlFixture = {
      url: 'https://private.example.com/assets/orig?sig=abc&exp=123',
      expiresAt: '2026-04-21T10:05:00.000Z',
    };

    it('GETs the endpoint + parses the envelope', (done) => {
      service.getOriginalUrl(assetFixture.id).subscribe((res) => {
        expect(res.url).toBe(originalUrlFixture.url);
        expect(res.expiresAt).toBe(originalUrlFixture.expiresAt);
        done();
      });
      const req = http.expectOne(`/api/v1/admin/assets/${assetFixture.id}/original-url`);
      expect(req.request.method).toBe('GET');
      req.flush({ data: originalUrlFixture });
    });

    it('rejects a malformed response missing expiresAt via Zod', (done) => {
      service.getOriginalUrl(assetFixture.id).subscribe({
        error: (err) => {
          expect(err).toBeDefined();
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/assets/${assetFixture.id}/original-url`)
        .flush({ data: { url: originalUrlFixture.url } });
    });

    it('propagates HTTP 404 (post-cutover original deleted)', (done) => {
      service.getOriginalUrl(assetFixture.id).subscribe({
        error: (err) => {
          expect(err).toBeDefined();
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/assets/${assetFixture.id}/original-url`)
        .flush(
          { error: { code: 'NOT_FOUND', message: 'original deleted' } },
          { status: 404, statusText: 'Not Found' },
        );
    });

    it('propagates HTTP 403', (done) => {
      service.getOriginalUrl(assetFixture.id).subscribe({
        error: (err) => {
          expect(err).toBeDefined();
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/assets/${assetFixture.id}/original-url`)
        .flush(
          { error: { code: 'FORBIDDEN', message: 'nope' } },
          { status: 403, statusText: 'Forbidden' },
        );
    });
  });

  // ── publicVariantUrl + tryPublicVariantUrl (AV3 resolver shim) ─────────────

  describe('publicVariantUrl + tryPublicVariantUrl', () => {
    const readyAsset = { ...assetFixture, status: 'READY' as const };

    it('publicVariantUrl picks the canonical variant URL per intent', () => {
      // Intent map mirrors `INTENT_TO_VARIANT` in
      // `libs/shared/common/src/asset-variants/asset-variants.schema.ts`.
      // thumbnail → thumbnail, card → small, banner → medium, hero → large,
      // detail → large.
      const expectations: Array<['thumbnail' | 'card' | 'banner' | 'hero' | 'detail', string]> = [
        ['thumbnail', variantsFixture.thumbnail.webp.url],
        ['card', variantsFixture.small.webp.url],
        ['banner', variantsFixture.medium.webp.url],
        ['hero', variantsFixture.large.webp.url],
        ['detail', variantsFixture.large.webp.url],
      ];
      for (const [intent, expected] of expectations) {
        const result = service.publicVariantUrl(readyAsset, intent);
        expect(result.url).toBe(expected);
        expect(result.format).toBe('webp');
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
        // srcset always carries every (variant × format) artefact for the asset.
        expect(result.srcset?.length).toBe(8);
      }
    });

    it('publicVariantUrl throws AssetNotReadyError on PROCESSING', () => {
      const processing = { ...readyAsset, status: 'PROCESSING' as const };
      expect(() => service.publicVariantUrl(processing, 'thumbnail')).toThrow(/not READY/);
    });

    it('publicVariantUrl throws AssetNotReadyError on PENDING', () => {
      const pending = { ...readyAsset, status: 'PENDING' as const };
      expect(() => service.publicVariantUrl(pending, 'thumbnail')).toThrow(/not READY/);
    });

    it('publicVariantUrl throws AssetFailedError on FAILED', () => {
      const failed = { ...readyAsset, status: 'FAILED' as const };
      expect(() => service.publicVariantUrl(failed, 'thumbnail')).toThrow(/FAILED/);
    });

    it('publicVariantUrl throws AssetVariantMissingError on missing variants', () => {
      const noVariants = { ...readyAsset, variants: undefined };
      expect(() => service.publicVariantUrl(noVariants, 'thumbnail')).toThrow(/variants/);
    });

    it('publicVariantUrl throws AssetVariantMissingError on malformed variants payload', () => {
      const broken = { ...readyAsset, variants: { thumbnail: { webp: { url: '' } } } };
      expect(() => service.publicVariantUrl(broken, 'thumbnail')).toThrow();
    });

    it('tryPublicVariantUrl returns null for null/undefined asset', () => {
      expect(service.tryPublicVariantUrl(null, 'thumbnail')).toBeNull();
      expect(service.tryPublicVariantUrl(undefined, 'thumbnail')).toBeNull();
    });

    it('tryPublicVariantUrl returns null on PROCESSING / PENDING / FAILED instead of throwing', () => {
      const processing = { ...readyAsset, status: 'PROCESSING' as const };
      const pending = { ...readyAsset, status: 'PENDING' as const };
      const failed = { ...readyAsset, status: 'FAILED' as const };
      expect(service.tryPublicVariantUrl(processing, 'thumbnail')).toBeNull();
      expect(service.tryPublicVariantUrl(pending, 'thumbnail')).toBeNull();
      expect(service.tryPublicVariantUrl(failed, 'thumbnail')).toBeNull();
    });

    it('tryPublicVariantUrl returns null on missing / malformed variants', () => {
      expect(
        service.tryPublicVariantUrl({ ...readyAsset, variants: undefined }, 'thumbnail'),
      ).toBeNull();
      expect(
        service.tryPublicVariantUrl({ ...readyAsset, variants: { broken: true } }, 'thumbnail'),
      ).toBeNull();
    });

    it('tryPublicVariantUrl resolves to the variant URL on a READY asset', () => {
      const result = service.tryPublicVariantUrl(readyAsset, 'detail');
      expect(result?.url).toBe(variantsFixture.large.webp.url);
    });

    it('publicVariantUrl resolves video poster shape (top-level pairs + renditions)', () => {
      // Per AV2 (`libs/shared/common/src/asset-variants/asset-variants.schema.ts`)
      // video payloads carry the same top-level pairs as image payloads (poster
      // frame at the four widths) plus a `renditions` block. The pure resolver
      // reads `variants[name].webp` unchanged for both shapes.
      const videoVariants = {
        ...variantsFixture,
        renditions: {
          mobile: {
            url: 'https://cdn/v-mobile.mp4',
            storagePath: 'public/v-mobile.mp4',
            width: 640,
            height: 360,
            size: 100,
            container: 'mp4',
            codec: 'h264-baseline',
            bitrate: '1.0M',
          },
          tablet: {
            url: 'https://cdn/v-tablet.mp4',
            storagePath: 'public/v-tablet.mp4',
            width: 1280,
            height: 720,
            size: 200,
            container: 'mp4',
            codec: 'h264-main',
            bitrate: '2.5M',
          },
          desktop: {
            url: 'https://cdn/v-desktop.mp4',
            storagePath: 'public/v-desktop.mp4',
            width: 1920,
            height: 1080,
            size: 400,
            container: 'mp4',
            codec: 'h264-high',
            bitrate: '5.0M',
          },
          'desktop-webm': {
            url: 'https://cdn/v-desktop.webm',
            storagePath: 'public/v-desktop.webm',
            width: 1920,
            height: 1080,
            size: 380,
            container: 'webm',
            codec: 'vp9',
            bitrate: '5.0M',
          },
        },
      };
      const videoAsset = { ...readyAsset, type: 'VIDEO' as const, variants: videoVariants };
      const result = service.publicVariantUrl(videoAsset, 'thumbnail');
      expect(result.url).toBe(variantsFixture.thumbnail.webp.url);
    });
  });

  // ── assetSchema widening (AV3 — variants + originalStoragePath) ────────────

  describe('assetSchema widening', () => {
    it('list() preserves the variants + originalStoragePath fields end-to-end', (done) => {
      const enriched = {
        ...assetFixture,
        status: 'READY',
        originalStoragePath: 'private/orig.png',
      };
      service.list().subscribe((res) => {
        const row = res.data[0];
        // The shim depends on these fields surviving Zod parse — without
        // the AV3 widening they would be silently stripped.
        expect(row.variants).toBeDefined();
        // eslint-disable-next-line no-restricted-syntax
        expect(row.originalStoragePath).toBe('private/orig.png');
        done();
      });
      http
        .expectOne('/api/v1/admin/assets')
        .flush({ data: [enriched], meta: { page: 1, pageSize: 20, total: 1 } });
    });

    it('get() preserves variants + originalStoragePath through the AssetWithUsage envelope', (done) => {
      service.get(assetFixture.id).subscribe((row) => {
        expect(row.variants).toBeDefined();
        // eslint-disable-next-line no-restricted-syntax
        expect(row.originalStoragePath).toBeNull();
        done();
      });
      http
        .expectOne(`/api/v1/admin/assets/${assetFixture.id}`)
        .flush({ data: assetWithUsageFixture });
    });
  });
});
