import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { AssetsService } from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AssetDetailPage } from './asset-detail.page';
import * as referencesDialog from './references.dialog';

expect.extend(toHaveNoViolations);

/**
 * AV3 — variants payload mirrors `assetVariantsSchema` so the resolver
 * shim picks `large.webp.url` for the `'detail'` intent on the preview img.
 */
const VARIANTS_FIXTURE = {
  thumbnail: {
    webp: {
      url: 'https://cdn/a-1-thumb.webp',
      storagePath: 'pub/a-1-t.webp',
      width: 160,
      height: 120,
      size: 100,
    },
    avif: {
      url: 'https://cdn/a-1-thumb.avif',
      storagePath: 'pub/a-1-t.avif',
      width: 160,
      height: 120,
      size: 90,
    },
  },
  small: {
    webp: {
      url: 'https://cdn/a-1-small.webp',
      storagePath: 'pub/a-1-s.webp',
      width: 320,
      height: 240,
      size: 200,
    },
    avif: {
      url: 'https://cdn/a-1-small.avif',
      storagePath: 'pub/a-1-s.avif',
      width: 320,
      height: 240,
      size: 180,
    },
  },
  medium: {
    webp: {
      url: 'https://cdn/a-1-med.webp',
      storagePath: 'pub/a-1-m.webp',
      width: 640,
      height: 480,
      size: 400,
    },
    avif: {
      url: 'https://cdn/a-1-med.avif',
      storagePath: 'pub/a-1-m.avif',
      width: 640,
      height: 480,
      size: 360,
    },
  },
  large: {
    webp: {
      url: 'https://cdn/a-1-large.webp',
      storagePath: 'pub/a-1-l.webp',
      width: 1280,
      height: 960,
      size: 800,
    },
    avif: {
      url: 'https://cdn/a-1-large.avif',
      storagePath: 'pub/a-1-l.avif',
      width: 1280,
      height: 960,
      size: 720,
    },
  },
};

const unreferencedFixture = {
  id: 'a-1',
  url: 'https://cdn/1.jpg',
  status: 'READY' as const,
  type: 'IMAGE' as const,
  mimeType: 'image/jpeg',
  width: 1024,
  height: 768,
  fileSize: 100_000,
  alt: { en: 'Alpha' },
  variants: VARIANTS_FIXTURE,
  originalStoragePath: 'private/a-1-orig.jpg',
  createdAt: '2026-04-21T10:00:00.000Z',
  updatedAt: '2026-04-21T10:00:00.000Z',
  usage: {
    products: 0,
    reviews: 0,
    returns: 0,
    categories: 0,
    total: 0,
  },
};

const referencedFixture = {
  ...unreferencedFixture,
  usage: {
    products: 2,
    reviews: 0,
    returns: 0,
    categories: 1,
    total: 3,
  },
};

/** AV3 — post-cutover row with original deleted; "Download original" must disable. */
const cutoverFixture = {
  ...unreferencedFixture,
  originalStoragePath: null,
};

describe('AssetDetailPage', () => {
  let component: ComponentFixture<AssetDetailPage>;
  let page: AssetDetailPage;
  let getSpy: jest.Mock;
  let deleteSpy: jest.Mock;
  let getOriginalUrlSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;
  let referencesSpy: jest.SpyInstance;
  let windowOpenSpy: jest.SpyInstance;
  let paramMap$: BehaviorSubject<ParamMap>;

  function configure(id = 'a-1', perms: string[] = ['assets:view', 'assets:delete']) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id }));
    // Real `AssetsService` instance so the resolver shim
    // (`tryPublicVariantUrl`) shares behaviour with production. Only the
    // HTTP-bearing methods are stubbed.
    const fakeService = Object.assign(
      Object.create((AssetsService as { prototype: object }).prototype) as AssetsService,
      { get: getSpy, delete: deleteSpy, getOriginalUrl: getOriginalUrlSpy },
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: AssetsService, useValue: fakeService },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    component = TestBed.createComponent(AssetDetailPage);
    page = component.componentInstance;
    component.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(unreferencedFixture));
    deleteSpy = jest.fn(() => of(undefined));
    getOriginalUrlSpy = jest.fn(() =>
      of({
        url: 'https://signed.example/original?sig=abc&exp=123',
        expiresAt: '2026-04-21T10:05:00.000Z',
      }),
    );
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
    referencesSpy = jest
      .spyOn(referencesDialog, 'openAssetReferencesDialog')
      .mockResolvedValue(undefined);
    windowOpenSpy = jest.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    referencesSpy.mockRestore();
    windowOpenSpy.mockRestore();
  });

  it('loads the asset with usage counts', () => {
    configure();
    expect(page.current()?.usage.total).toBe(0);
  });

  it('happy delete (usage=0) opens confirm + calls service.delete', async () => {
    configure();
    await page.confirmDelete();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('a-1');
  });

  it('shows the View references CTA when usage > 0 (DR-07 — destructive CTA hidden)', () => {
    getSpy = jest.fn(() => of(referencedFixture));
    configure();
    const viewRefs = component.nativeElement.querySelector(
      '[data-testid="asset-view-references"]',
    ) as HTMLButtonElement | null;
    expect(viewRefs).not.toBeNull();
    const destructive = component.nativeElement.querySelector('[data-testid="asset-delete"]');
    expect(destructive).toBeNull();
  });

  it('opens the references dialog when View references is clicked', async () => {
    getSpy = jest.fn(() => of(referencedFixture));
    configure();
    await page.viewReferences();
    expect(referencesSpy).toHaveBeenCalledTimes(1);
    const args = referencesSpy.mock.calls[0]?.[1] as { assetId: string };
    expect(args.assetId).toBe('a-1');
  });

  it('refetches usage after the references dialog closes', async () => {
    getSpy = jest.fn(() => of(referencedFixture));
    configure();
    getSpy.mockClear();
    await page.viewReferences();
    expect(getSpy).toHaveBeenCalledWith('a-1');
  });

  it('shows the Delete CTA only when unreferenced', () => {
    configure();
    const btn = component.nativeElement.querySelector(
      '[data-testid="asset-delete"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.hasAttribute('disabled')).toBe(false);
    expect(btn!.getAttribute('aria-describedby')).toBe('asset-delete-summary');
  });

  it('canDelete false without the permission', () => {
    configure('a-1', ['assets:view']);
    expect(page.canDelete()).toBe(false);
  });

  it('ApiError with a message passes through on delete failure', async () => {
    deleteSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'STORAGE_ERROR', message: 'S3 timeout' })),
    );
    configure();
    await page.confirmDelete();
    expect(page.error()).toBe('S3 timeout');
  });

  it('refetches and shows a friendly error when delete races a 409 ASSET_REFERENCED', async () => {
    deleteSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'ASSET_REFERENCED', message: 'asset has refs' })),
    );
    configure();
    getSpy.mockClear();
    await page.confirmDelete();
    expect(page.error()).toContain('references');
    expect(getSpy).toHaveBeenCalledWith('a-1');
  });

  it('ApiNotFoundError maps to a clear error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure('zzz');
    expect(page.error()).toBe('Asset not found.');
  });

  it('ApiForbiddenError maps to the permission error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure('zzz');
    expect(page.error()).toContain('permission');
  });

  it('has no axe violations on the happy render', async () => {
    configure();
    const results = await axe(component.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the referenced state (View references CTA)', async () => {
    getSpy = jest.fn(() => of(referencedFixture));
    configure();
    component.detectChanges();
    const results = await axe(component.nativeElement);
    expect(results).toHaveNoViolations();
  });

  // ── AV3 — variant URL preview + Download original button ─────────────────

  describe('AV3 variant URL migration + Download original', () => {
    it('preview <img> binds the resolved detail variant URL, not raw asset.url', () => {
      configure();
      const img = component.nativeElement.querySelector(
        '[data-testid="asset-preview-image"]',
      ) as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe('https://cdn/a-1-large.webp');
      expect(img!.getAttribute('src')).not.toBe('https://cdn/1.jpg');
    });

    it('preview area renders status placeholder (no <img>) when image asset is PROCESSING', () => {
      const processingFixture = { ...unreferencedFixture, status: 'PROCESSING' as const };
      getSpy = jest.fn(() => of(processingFixture));
      configure();
      expect(
        component.nativeElement.querySelector('[data-testid="asset-preview-image"]'),
      ).toBeNull();
      const placeholder = component.nativeElement.querySelector(
        '[data-testid="asset-preview-pending"]',
      ) as HTMLElement | null;
      expect(placeholder).not.toBeNull();
      expect(placeholder!.textContent).toContain('Processing');
    });

    it('Download original button is visible to assets:view operators with a non-null originalStoragePath', () => {
      configure();
      const btn = component.nativeElement.querySelector(
        '[data-testid="asset-download-original"]',
      ) as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn!.hasAttribute('disabled')).toBe(false);
      expect(btn!.getAttribute('aria-describedby')).toBe('asset-download-original-help');
    });

    it('Download original button is absent for users without the assets:view permission', () => {
      configure('a-1', []);
      const btn = component.nativeElement.querySelector('[data-testid="asset-download-original"]');
      expect(btn).toBeNull();
    });

    it('Download original button is disabled when originalStoragePath is null (post-cutover)', () => {
      getSpy = jest.fn(() => of(cutoverFixture));
      configure();
      // `app-button` projects the data-testid onto the inner native <button>
      // element, so the query lands directly on the disabled-bearing button.
      const btn = component.nativeElement.querySelector(
        '[data-testid="asset-download-original"]',
      ) as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn!.hasAttribute('disabled')).toBe(true);
    });

    it('Download original button surfaces the 5-minute TTL help text when enabled', () => {
      configure();
      const help = component.nativeElement.querySelector(
        '#asset-download-original-help',
      ) as HTMLElement | null;
      expect(help).not.toBeNull();
      expect(help!.textContent).toMatch(/5 minutes/i);
    });

    it('Download original button surfaces the post-cutover help copy when disabled', () => {
      getSpy = jest.fn(() => of(cutoverFixture));
      configure();
      const help = component.nativeElement.querySelector(
        '#asset-download-original-help',
      ) as HTMLElement | null;
      expect(help).not.toBeNull();
      expect(help!.textContent).toMatch(/Original deleted/i);
    });

    it('downloadOriginal() calls AssetsService.getOriginalUrl + window.open with the presigned URL', () => {
      configure();
      page.downloadOriginal();
      expect(getOriginalUrlSpy).toHaveBeenCalledWith('a-1');
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://signed.example/original?sig=abc&exp=123',
        '_blank',
        'noopener',
      );
    });

    it('downloadOriginal() short-circuits when originalStoragePath is null', () => {
      getSpy = jest.fn(() => of(cutoverFixture));
      configure();
      page.downloadOriginal();
      expect(getOriginalUrlSpy).not.toHaveBeenCalled();
      expect(windowOpenSpy).not.toHaveBeenCalled();
    });

    it('downloadOriginal() surfaces a friendly error on backend failure', () => {
      getOriginalUrlSpy = jest.fn(() =>
        throwError(() => new ApiError({ code: 'STORAGE_ERROR', message: 'S3 timeout' })),
      );
      configure();
      page.downloadOriginal();
      expect(page.error()).toBe('S3 timeout');
      expect(windowOpenSpy).not.toHaveBeenCalled();
    });

    it('has no axe violations with the Download original button + help text', async () => {
      configure();
      const results = await axe(component.nativeElement);
      expect(results).toHaveNoViolations();
    });

    it('has no axe violations when Download original is disabled (post-cutover)', async () => {
      getSpy = jest.fn(() => of(cutoverFixture));
      configure();
      const results = await axe(component.nativeElement);
      expect(results).toHaveNoViolations();
    });
  });
});
