import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AssetsService, type AssetUploadEvent } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Subject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AssetsLibraryPage } from './assets-library.page';

expect.extend(toHaveNoViolations);

/**
 * AV3 — variants payload shape mirrors `assetVariantsSchema` in
 * `libs/shared/common/src/asset-variants/asset-variants.schema.ts`. The
 * resolver shim picks `variants[name].webp.url` per intent — `thumbnail`
 * intent → `thumbnail` variant for grid + list bindings.
 */
const buildVariants = (id: string) => ({
  thumbnail: {
    webp: {
      url: `https://cdn/${id}-thumb.webp`,
      storagePath: `pub/${id}-thumb.webp`,
      width: 160,
      height: 120,
      size: 100,
    },
    avif: {
      url: `https://cdn/${id}-thumb.avif`,
      storagePath: `pub/${id}-thumb.avif`,
      width: 160,
      height: 120,
      size: 90,
    },
  },
  small: {
    webp: {
      url: `https://cdn/${id}-small.webp`,
      storagePath: `pub/${id}-small.webp`,
      width: 320,
      height: 240,
      size: 200,
    },
    avif: {
      url: `https://cdn/${id}-small.avif`,
      storagePath: `pub/${id}-small.avif`,
      width: 320,
      height: 240,
      size: 180,
    },
  },
  medium: {
    webp: {
      url: `https://cdn/${id}-med.webp`,
      storagePath: `pub/${id}-med.webp`,
      width: 640,
      height: 480,
      size: 400,
    },
    avif: {
      url: `https://cdn/${id}-med.avif`,
      storagePath: `pub/${id}-med.avif`,
      width: 640,
      height: 480,
      size: 360,
    },
  },
  large: {
    webp: {
      url: `https://cdn/${id}-large.webp`,
      storagePath: `pub/${id}-large.webp`,
      width: 1280,
      height: 960,
      size: 800,
    },
    avif: {
      url: `https://cdn/${id}-large.avif`,
      storagePath: `pub/${id}-large.avif`,
      width: 1280,
      height: 960,
      size: 720,
    },
  },
});

const assets = [
  {
    id: 'a-1',
    url: 'https://cdn/1.jpg',
    status: 'READY',
    type: 'IMAGE',
    mimeType: 'image/jpeg',
    width: 1024,
    height: 768,
    fileSize: 100_000,
    alt: { en: 'Alpha' },
    variants: buildVariants('a-1'),
    originalStoragePath: 'private/a-1-orig.jpg',
  },
  {
    id: 'a-2',
    url: 'https://cdn/2.mp4',
    status: 'PROCESSING',
    type: 'VIDEO',
    mimeType: 'video/mp4',
    fileSize: 500_000,
  },
  // Image asset still PROCESSING — exercises the `<img>` → status-label
  // fallback path on grid + list (AV3.13).
  {
    id: 'a-3',
    url: '',
    status: 'PROCESSING',
    type: 'IMAGE',
    mimeType: 'image/jpeg',
    fileSize: 50_000,
  },
];

describe('AssetsLibraryPage', () => {
  let fixture: ComponentFixture<AssetsLibraryPage>;
  let page: AssetsLibraryPage;
  let listSpy: jest.Mock;

  function configure() {
    // Real `AssetsService` so the resolver shim (`tryPublicVariantUrl`)
    // shares behaviour with production. Only `list` is stubbed.
    const fakeService = Object.assign(
      Object.create((AssetsService as { prototype: object }).prototype) as AssetsService,
      { list: listSpy },
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: AssetsService, useValue: fakeService },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: ['assets:view'], roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(AssetsLibraryPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: assets, meta: { page: 1, pageSize: 24, total: assets.length } }),
    );
  });

  it('loads rows', () => {
    configure();
    expect(page.rows()).toHaveLength(3);
  });

  it('setView swaps between grid and list', () => {
    configure();
    expect(page.view()).toBe('grid');
    page.setView('list');
    expect(page.view()).toBe('list');
  });

  it('setType navigates with the new type', () => {
    configure();
    const navSpy = jest.spyOn(TestBed.inject(Router), 'navigate');
    page.setType('VIDEO');
    expect(navSpy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ type: 'VIDEO', page: null }),
      }),
    );
  });

  it('setStatus navigates with the new status', () => {
    configure();
    const navSpy = jest.spyOn(TestBed.inject(Router), 'navigate');
    page.setStatus('READY');
    expect(navSpy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ status: 'READY' }),
      }),
    );
  });

  it('goToPage clamps out-of-bounds inputs to a no-op', () => {
    listSpy = jest.fn(() => of({ data: assets, meta: { page: 1, pageSize: 24, total: 100 } }));
    configure();
    const navSpy = jest.spyOn(TestBed.inject(Router), 'navigate');
    page.goToPage(0);
    page.goToPage(9999);
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('empty-state renders the no-results copy', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 24, total: 0 } }));
    configure();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('No assets match');
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the assets-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Assets not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  // ── AV3 — variant URL bindings ─────────────────────────────────────────────

  describe('AV3 variant URL migration', () => {
    it('grid card binds the resolved thumbnail variant URL, not raw asset.url', () => {
      configure();
      const card = fixture.nativeElement.querySelector(
        '[data-testid="asset-card-a-1"]',
      ) as HTMLElement;
      expect(card).not.toBeNull();
      const img = card.querySelector('img') as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe('https://cdn/a-1-thumb.webp');
      expect(img!.getAttribute('src')).not.toBe('https://cdn/1.jpg');
    });

    it('grid card renders status-label fallback (not <img>) when image asset is PROCESSING', () => {
      configure();
      const card = fixture.nativeElement.querySelector(
        '[data-testid="asset-card-a-3"]',
      ) as HTMLElement;
      expect(card).not.toBeNull();
      const img = card.querySelector('img');
      expect(img).toBeNull();
      const fallback = card.querySelector('[data-testid="asset-card-pending-a-3"]');
      expect(fallback).not.toBeNull();
      expect(fallback!.textContent?.trim()).toBe('Processing');
    });

    it('list-table thumb binds the resolved thumbnail variant URL', () => {
      configure();
      page.setView('list');
      fixture.detectChanges();
      const row = fixture.nativeElement.querySelector(
        '[data-testid="asset-row-a-1"]',
      ) as HTMLElement;
      const img = row.querySelector('img') as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe('https://cdn/a-1-thumb.webp');
    });

    it('list-table thumb cell renders status fallback (no <img>) when image asset is PROCESSING', () => {
      configure();
      page.setView('list');
      fixture.detectChanges();
      const row = fixture.nativeElement.querySelector(
        '[data-testid="asset-row-a-3"]',
      ) as HTMLElement;
      expect(row.querySelector('img')).toBeNull();
      const fallback = row.querySelector(
        '[data-testid="asset-row-pending-a-3"]',
      ) as HTMLElement | null;
      expect(fallback).not.toBeNull();
      expect(fallback!.textContent?.trim()).toBe('Processing');
      expect(fallback!.getAttribute('aria-label')).toBe('Status: Processing');
    });
  });

  // ── AU0 — upload queue (dropzone + transient queue + polling) ─────────────

  describe('AU0 upload queue', () => {
    let uploadSpy: jest.Mock;
    let getSpy: jest.Mock;

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function makeAsset(id: string, status: 'PROCESSING' | 'READY' | 'FAILED' = 'PROCESSING') {
      return {
        id,
        url: status === 'READY' ? `https://cdn/${id}.jpg` : '',
        status,
        type: 'IMAGE',
        mimeType: 'image/png',
        fileSize: 1234,
      };
    }

    function configureUploads(opts: { permissions?: string[] } = {}): void {
      const permissions = opts.permissions ?? ['assets:view', 'assets:create'];
      listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 24, total: 0 } }));
      uploadSpy = jest.fn();
      getSpy = jest.fn();
      const fakeService = Object.assign(
        Object.create((AssetsService as { prototype: object }).prototype) as AssetsService,
        { list: listSpy, uploadWithProgress: uploadSpy, get: getSpy },
      );
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: '**', children: [] }]),
          { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
          { provide: AssetsService, useValue: fakeService },
        ],
      });
      TestBed.inject(AuthStore).setSession({
        user: { id: 'u', email: 'a@b', permissions, roles: [], status: 'active' },
      });
      fixture = TestBed.createComponent(AssetsLibraryPage);
      page = fixture.componentInstance;
      fixture.detectChanges();
    }

    function makeFile(name = 'pic.png', size = 1024, type = 'image/png'): File {
      const file = new File(['x'.repeat(Math.min(size, 64))], name, { type });
      Object.defineProperty(file, 'size', { value: size });
      return file;
    }

    it('dropzone + queue render only when assets:create permission present', () => {
      configureUploads({ permissions: ['assets:view'] });
      expect(fixture.nativeElement.querySelector('[data-testid="assets-upload-block"]')).toBeNull();
      expect(page.canUpload()).toBe(false);
    });

    it('queue + dropzone render when assets:create permission present', () => {
      configureUploads();
      expect(
        fixture.nativeElement.querySelector('[data-testid="assets-upload-block"]'),
      ).not.toBeNull();
      expect(page.canUpload()).toBe(true);
    });

    it('happy path: row transitions UPLOADING → PROCESSING → READY and refetches once', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);
      getSpy.mockReturnValue(of(makeAsset('a-new', 'READY')));

      page.onFilesAdded([makeFile()]);
      expect(page.mediaQueue()).toHaveLength(1);
      expect(page.mediaQueue()[0].status).toBe('UPLOADING');

      upload$.next({ kind: 'progress', progress: { loaded: 50, total: 100, ratio: 0.5 } });
      expect(page.mediaQueue()[0].progress).toBe(50);

      upload$.next({ kind: 'done', asset: makeAsset('a-new', 'PROCESSING') });
      expect(page.mediaQueue()[0].status).toBe('PROCESSING');
      expect(page.mediaQueue()[0].assetId).toBe('a-new');
      upload$.complete();

      jest.advanceTimersByTime(1000);
      expect(getSpy).toHaveBeenCalledWith('a-new');
      expect(page.mediaQueue()[0].status).toBe('READY');
      // initial fetch + post-batch refetch on drain
      expect(listSpy).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(5000);
      expect(page.mediaQueue()).toHaveLength(0);
    });

    it('queue row exposes the created asset id once the upload returns', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      fixture.detectChanges();
      const rowSelector = '[data-testid^="assets-upload-row-"]';
      const row = (): HTMLElement => fixture.nativeElement.querySelector(rowSelector);
      expect(row().hasAttribute('data-asset-id')).toBe(false);

      upload$.next({ kind: 'done', asset: makeAsset('a-new', 'PROCESSING') });
      fixture.detectChanges();
      expect(row().getAttribute('data-asset-id')).toBe('a-new');
    });

    it('parallel uploads progress independently and refetch fires once per batch', () => {
      const u1 = new Subject<AssetUploadEvent>();
      const u2 = new Subject<AssetUploadEvent>();
      const u3 = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValueOnce(u1).mockReturnValueOnce(u2).mockReturnValueOnce(u3);
      getSpy.mockReturnValue(of(makeAsset('any', 'READY')));

      page.onFilesAdded([makeFile('a.png'), makeFile('b.png'), makeFile('c.png')]);
      expect(page.mediaQueue()).toHaveLength(3);
      expect(uploadSpy).toHaveBeenCalledTimes(3);

      u1.next({ kind: 'done', asset: makeAsset('id-1', 'PROCESSING') });
      u1.complete();
      u2.next({ kind: 'done', asset: makeAsset('id-2', 'PROCESSING') });
      u2.complete();
      u3.next({ kind: 'done', asset: makeAsset('id-3', 'PROCESSING') });
      u3.complete();

      jest.advanceTimersByTime(1000);
      const statuses = page.mediaQueue().map((r) => r.status);
      expect(statuses.every((s) => s === 'READY')).toBe(true);
      // Initial mount + exactly one batch refetch (not 3)
      expect(listSpy).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(5000);
      expect(page.mediaQueue()).toHaveLength(0);
    });

    it('caps concurrent uploads at 8; the 9th waits until a slot frees', () => {
      const subs = Array.from({ length: 9 }, () => new Subject<AssetUploadEvent>());
      configureUploads();
      subs.forEach((s) => uploadSpy.mockReturnValueOnce(s));
      getSpy.mockReturnValue(of(makeAsset('id-x', 'READY')));

      const files = Array.from({ length: 9 }, (_, i) => makeFile(`f${i}.png`));
      page.onFilesAdded(files);

      expect(uploadSpy).toHaveBeenCalledTimes(8);

      subs[0].next({ kind: 'done', asset: makeAsset('id-0', 'PROCESSING') });
      subs[0].complete();

      expect(uploadSpy).toHaveBeenCalledTimes(9);

      for (let i = 1; i < 9; i++) {
        subs[i].next({ kind: 'done', asset: makeAsset(`id-${i}`, 'PROCESSING') });
        subs[i].complete();
      }
      jest.advanceTimersByTime(1000);
      jest.advanceTimersByTime(5000);
    });

    it('polling cap → STILL_PROCESSING; row persists and refetch fires on drain', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);
      getSpy.mockReturnValue(of(makeAsset('a-stuck', 'PROCESSING')));

      page.onFilesAdded([makeFile()]);
      upload$.next({ kind: 'done', asset: makeAsset('a-stuck', 'PROCESSING') });
      upload$.complete();

      // Roll past the 30-second cap (31 polls @ 1 s each).
      for (let i = 0; i < 31; i++) jest.advanceTimersByTime(1000);

      const row = page.mediaQueue()[0];
      expect(row.status).toBe('STILL_PROCESSING');
      expect(row.assetId).toBe('a-stuck');
      expect(listSpy).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(10_000);
      expect(page.mediaQueue()).toHaveLength(1);
    });

    it('polling HTTP error → FAILED row with error message', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);
      getSpy.mockReturnValue(
        throwError(() => new ApiError({ code: 'NET', message: 'gone', status: 500 })),
      );

      page.onFilesAdded([makeFile()]);
      upload$.next({ kind: 'done', asset: makeAsset('a-x', 'PROCESSING') });
      upload$.complete();
      jest.advanceTimersByTime(1000);

      const row = page.mediaQueue()[0];
      expect(row.status).toBe('FAILED');
      expect(row.error).toContain('gone');
    });

    it('server-side terminal FAILED from get() → FAILED row', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);
      getSpy.mockReturnValue(of(makeAsset('a-bad', 'FAILED')));

      page.onFilesAdded([makeFile()]);
      upload$.next({ kind: 'done', asset: makeAsset('a-bad', 'PROCESSING') });
      upload$.complete();
      jest.advanceTimersByTime(1000);

      const row = page.mediaQueue()[0];
      expect(row.status).toBe('FAILED');
      expect(row.error).toBe('Processing failed.');
    });

    it('upload HTTP error during POST → FAILED row with retry surface', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      upload$.error(new ApiError({ code: 'BAD', message: 'magic-byte mismatch', status: 400 }));

      const row = page.mediaQueue()[0];
      expect(row.status).toBe('FAILED');
      expect(row.error).toContain('magic-byte');
    });

    it('retry on FAILED row replays the upload on the same File', () => {
      const first$ = new Subject<AssetUploadEvent>();
      const second$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValueOnce(first$).mockReturnValueOnce(second$);
      getSpy.mockReturnValue(of(makeAsset('id-r', 'READY')));

      const file = makeFile('retry.png');
      page.onFilesAdded([file]);
      first$.error(new ApiError({ code: 'BAD', message: 'transient', status: 500 }));
      const tempId = page.mediaQueue()[0].tempId;
      expect(page.mediaQueue()[0].status).toBe('FAILED');

      page.retry(tempId);
      expect(uploadSpy).toHaveBeenCalledTimes(2);
      expect(uploadSpy.mock.calls[1][0]).toBe(file);

      second$.next({ kind: 'done', asset: makeAsset('id-r', 'PROCESSING') });
      second$.complete();
      jest.advanceTimersByTime(1000);
      expect(page.mediaQueue()[0].status).toBe('READY');
      jest.advanceTimersByTime(5000);
      expect(page.mediaQueue()).toHaveLength(0);
    });

    it('onFilesRejected appends FAILED rows with size/mime reason and does NOT refetch', () => {
      configureUploads();
      const before = listSpy.mock.calls.length;
      page.onFilesRejected([
        { file: makeFile('big.png', 20 * 1024 * 1024), reason: 'size' },
        { file: makeFile('weird.exe', 100, 'application/x-msdownload'), reason: 'mime' },
      ]);
      expect(page.mediaQueue()).toHaveLength(2);
      expect(page.mediaQueue()[0].status).toBe('FAILED');
      expect(page.mediaQueue()[0].error).toContain('10 MB');
      expect(page.mediaQueue()[1].error).toContain('not allowed');
      // No upload happened, so no batch drain → no extra refetch.
      expect(listSpy.mock.calls.length).toBe(before);
    });

    it('dismiss removes a row regardless of status and stops its polling', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);
      getSpy.mockReturnValue(of(makeAsset('a-keep', 'PROCESSING')));

      page.onFilesAdded([makeFile()]);
      upload$.next({ kind: 'done', asset: makeAsset('a-keep', 'PROCESSING') });
      upload$.complete();
      jest.advanceTimersByTime(1000);
      const tempId = page.mediaQueue()[0].tempId;

      page.dismiss(tempId);
      expect(page.mediaQueue()).toHaveLength(0);

      jest.advanceTimersByTime(2000);
    });

    it('aria-busy attribute is true on the queue container while any row is in flight', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);
      getSpy.mockReturnValue(of(makeAsset('a-y', 'READY')));

      page.onFilesAdded([makeFile()]);
      fixture.detectChanges();
      const list = fixture.nativeElement.querySelector(
        '[data-testid="assets-upload-queue"]',
      ) as HTMLElement;
      expect(list.getAttribute('aria-busy')).toBe('true');

      upload$.next({ kind: 'done', asset: makeAsset('a-y', 'PROCESSING') });
      upload$.complete();
      jest.advanceTimersByTime(1000);
      fixture.detectChanges();
      expect(list.getAttribute('aria-busy')).toBeNull();
      jest.advanceTimersByTime(5000);
    });

    it('axe-clean with an active uploading queue row', async () => {
      jest.useRealTimers();
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      upload$.next({ kind: 'progress', progress: { loaded: 30, total: 100, ratio: 0.3 } });
      fixture.detectChanges();
      const results = await axe(fixture.nativeElement);
      expect(results).toHaveNoViolations();
      upload$.complete();
    });

    // ── Edge-case branches (coverage hardening) ─────────────────────────────

    it('onFilesAdded with empty array is a no-op', () => {
      configureUploads();
      page.onFilesAdded([]);
      expect(page.mediaQueue()).toHaveLength(0);
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('onFilesAdded without assets:create permission is a no-op', () => {
      configureUploads({ permissions: ['assets:view'] });
      page.onFilesAdded([makeFile()]);
      expect(page.mediaQueue()).toHaveLength(0);
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('onFilesRejected with empty array is a no-op', () => {
      configureUploads();
      page.onFilesRejected([]);
      expect(page.mediaQueue()).toHaveLength(0);
    });

    it('onFilesRejected without assets:create permission is a no-op', () => {
      configureUploads({ permissions: ['assets:view'] });
      page.onFilesRejected([{ file: makeFile(), reason: 'mime' }]);
      expect(page.mediaQueue()).toHaveLength(0);
    });

    it('retry on a non-existent tempId is a no-op', () => {
      configureUploads();
      page.retry('does-not-exist');
      expect(page.mediaQueue()).toHaveLength(0);
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('retry on a non-FAILED row is a no-op', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      const tempId = page.mediaQueue()[0].tempId;
      expect(uploadSpy).toHaveBeenCalledTimes(1);

      page.retry(tempId);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
    });

    it('progress event with no ratio falls back to 0', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      upload$.next({
        kind: 'progress',
        progress: { loaded: 100, total: null, ratio: null },
      });
      expect(page.mediaQueue()[0].progress).toBe(0);
    });

    it('done event with asset.status READY skips polling and refetches once', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      upload$.next({ kind: 'done', asset: makeAsset('a-imm', 'READY') });
      upload$.complete();
      expect(getSpy).not.toHaveBeenCalled();
      expect(page.mediaQueue()[0].status).toBe('READY');
      expect(listSpy).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(5000);
      expect(page.mediaQueue()).toHaveLength(0);
    });

    it('dismiss while UPLOADING cancels the in-flight subscription and frees the slot', () => {
      const subs = Array.from({ length: 9 }, () => new Subject<AssetUploadEvent>());
      configureUploads();
      subs.forEach((s) => uploadSpy.mockReturnValueOnce(s));

      const files = Array.from({ length: 9 }, (_, i) => makeFile(`f${i}.png`));
      page.onFilesAdded(files);
      expect(uploadSpy).toHaveBeenCalledTimes(8);

      // Dismiss one of the active uploads → the 9th waiting file gets a slot.
      const activeTempId = page.mediaQueue()[0].tempId;
      page.dismiss(activeTempId);
      expect(uploadSpy).toHaveBeenCalledTimes(9);
    });

    it('dismiss removes a waiting-list entry without spawning an upload', () => {
      const subs = Array.from({ length: 8 }, () => new Subject<AssetUploadEvent>());
      configureUploads();
      subs.forEach((s) => uploadSpy.mockReturnValueOnce(s));
      // 9th call must never occur — no return value provided.
      uploadSpy.mockReturnValueOnce(new Subject<AssetUploadEvent>());

      const files = Array.from({ length: 9 }, (_, i) => makeFile(`f${i}.png`));
      page.onFilesAdded(files);
      const waitingTempId = page.mediaQueue()[8].tempId;
      page.dismiss(waitingTempId);

      expect(uploadSpy).toHaveBeenCalledTimes(8);
      expect(page.mediaQueue()).toHaveLength(8);
    });

    it('formatUploadError handles ApiForbiddenError', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      upload$.error(new ApiForbiddenError({ code: 'FORBID', message: 'no perm' }));

      const row = page.mediaQueue()[0];
      expect(row.status).toBe('FAILED');
      expect(row.error).toContain('permission');
    });

    it('formatUploadError surfaces a plain Error message', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      upload$.error(new Error('socket reset'));

      const row = page.mediaQueue()[0];
      expect(row.status).toBe('FAILED');
      expect(row.error).toBe('socket reset');
    });

    it('formatUploadError falls back to a generic message for non-Error values', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      upload$.error('unexpected string');

      const row = page.mediaQueue()[0];
      expect(row.status).toBe('FAILED');
      expect(row.error).toBe('Upload failed.');
    });

    it('FAILED row persists past the 5 s auto-clear window', () => {
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile()]);
      upload$.error(new ApiError({ code: 'BAD', message: 'reset', status: 500 }));

      jest.advanceTimersByTime(10_000);
      expect(page.mediaQueue()).toHaveLength(1);
      expect(page.mediaQueue()[0].status).toBe('FAILED');
    });

    it('one upload erroring leaves sibling uploads in the same batch unaffected', () => {
      const u1 = new Subject<AssetUploadEvent>();
      const u2 = new Subject<AssetUploadEvent>();
      const u3 = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValueOnce(u1).mockReturnValueOnce(u2).mockReturnValueOnce(u3);
      getSpy.mockReturnValue(of(makeAsset('any', 'READY')));

      page.onFilesAdded([makeFile('a.png'), makeFile('b.png'), makeFile('c.png')]);
      u1.error(new ApiError({ code: 'BAD', message: 'a', status: 400 }));
      u2.next({ kind: 'done', asset: makeAsset('id-2', 'PROCESSING') });
      u2.complete();
      u3.next({ kind: 'done', asset: makeAsset('id-3', 'PROCESSING') });
      u3.complete();
      jest.advanceTimersByTime(1000);

      const statuses = page.mediaQueue().map((r) => r.status);
      expect(statuses).toEqual(['FAILED', 'READY', 'READY']);
    });

    it('retry relocates focus to the row dismiss button', async () => {
      jest.useRealTimers();
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile('focus.png')]);
      upload$.error(new ApiError({ code: 'BAD', message: 'x', status: 500 }));
      fixture.detectChanges();
      const tempId = page.mediaQueue()[0].tempId;

      uploadSpy.mockReturnValueOnce(new Subject<AssetUploadEvent>());
      page.retry(tempId);
      fixture.detectChanges();
      await Promise.resolve();
      const dismissBtn = fixture.nativeElement.querySelector(
        `[data-testid="assets-upload-dismiss-${tempId}"] button`,
      ) as HTMLButtonElement | null;
      expect(dismissBtn).not.toBeNull();
      expect(document.activeElement).toBe(dismissBtn);
    });

    it('dismiss relocates focus to the dropzone trigger when no rows remain', async () => {
      jest.useRealTimers();
      const upload$ = new Subject<AssetUploadEvent>();
      configureUploads();
      uploadSpy.mockReturnValue(upload$);

      page.onFilesAdded([makeFile('only.png')]);
      upload$.error(new ApiError({ code: 'BAD', message: 'x', status: 500 }));
      fixture.detectChanges();
      const tempId = page.mediaQueue()[0].tempId;

      page.dismiss(tempId);
      fixture.detectChanges();
      await Promise.resolve();
      const trigger = fixture.nativeElement.querySelector(
        '[data-testid="assets-dropzone"] [data-testid="dropzone-trigger"]',
      ) as HTMLButtonElement | null;
      expect(trigger).not.toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
