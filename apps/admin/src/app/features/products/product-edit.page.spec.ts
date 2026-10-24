import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import {
  AssetsService,
  AuditLogService,
  CategoriesService,
  ProductsService,
} from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ProductEditPage } from './product-edit.page';

expect.extend(toHaveNoViolations);

describe('ProductEditPage', () => {
  let fixture: ComponentFixture<ProductEditPage>;
  let page: ProductEditPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let paramMap$: BehaviorSubject<ParamMap>;
  let confirmSpy: jest.SpyInstance;
  let uploadSpy: jest.Mock;
  let updateAssetsSpy: jest.Mock;
  let categoryTreeSpy: jest.Mock;
  let replaceSpecsSpy: jest.Mock;

  const productFixture = {
    id: 'prod-1',
    name: { default: 'Sac à dos', fr: 'Sac à dos', en: 'Backpack' },
    slug: 'backpack',
    description: { default: 'A bag.', en: 'A bag.' },
    shortDescription: { default: 'Bag.', en: 'Bag.' },
    status: 'DRAFT',
    brand: 'Badii',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    variants: [{ id: 'v-1', sku: 'SKU-1', price: 100, isActive: true, isDefault: true }],
  };

  function configure(id: string | null = 'prod-1') {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap(id ? { id } : {}));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: ProductsService,
          useValue: {
            getProduct: getSpy,
            updateProduct: updateSpy,
            updateProductAssets: updateAssetsSpy,
            replaceSpecs: replaceSpecsSpy,
            listSpecLabels: jest.fn(() =>
              of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
            ),
          },
        },
        // AV3 — page calls `tryPublicVariantUrl` shim for Media-tab tiles.
        // Use a real instance via prototype-extension so the resolver shim
        // shares behaviour with production; only `upload` (the HTTP path)
        // is stubbed.
        {
          provide: AssetsService,
          useValue: Object.assign(
            Object.create((AssetsService as { prototype: object }).prototype) as AssetsService,
            { upload: uploadSpy },
          ),
        },
        { provide: CategoriesService, useValue: { tree: categoryTreeSpy } },
        {
          provide: AuditLogService,
          useValue: {
            listByEntity: jest.fn(() =>
              of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
            ),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParamMap: of(convertToParamMap({})),
          },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['products:update'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(ProductEditPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(productFixture));
    updateSpy = jest.fn((_id: string, body: unknown) =>
      of({ ...productFixture, ...(body as object) }),
    );
    uploadSpy = jest.fn();
    updateAssetsSpy = jest.fn(() => of(undefined));
    categoryTreeSpy = jest.fn(() => of([]));
    replaceSpecsSpy = jest.fn(() => of([]));
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => confirmSpy.mockRestore());

  it('seeds the form from the loaded product', () => {
    configure();
    expect(page.loading()).toBe(false);
    expect(page.form.controls.slug.value).toBe('backpack');
    expect(page.form.controls.brand.value).toBe('Badii');
  });

  it('save is disabled when pristine', () => {
    configure();
    expect(page.form.dirty).toBe(false);
  });

  it('patches only the dirty fields', async () => {
    configure();
    page.form.controls.brand.setValue('Other');
    page.form.controls.brand.markAsDirty();
    page.save();
    expect(updateSpy).toHaveBeenCalledWith('prod-1', { brand: 'Other' });
  });

  it('slug validator rejects uppercase input', () => {
    configure();
    page.form.controls.slug.setValue('NotSlug');
    page.form.controls.slug.markAsTouched();
    expect(page.slugError()).toContain('Lowercase');
  });

  it('surfaces ApiConflictError as a slug-conflict message', async () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'taken' })),
    );
    configure();
    page.form.controls.slug.setValue('taken');
    page.form.controls.slug.markAsDirty();
    page.save();
    expect(page.error()).toContain('Slug conflict');
  });

  it('surfaces ApiForbiddenError as the permission-specific error', async () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.form.controls.slug.setValue('new-slug');
    page.form.controls.slug.markAsDirty();
    page.save();
    expect(page.error()).toContain('permission');
  });

  it('publish confirms before flipping DRAFT → ACTIVE', async () => {
    configure();
    await page.togglePublish();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('prod-1', { status: 'ACTIVE' });
  });

  it('unpublish skips the confirm (ACTIVE → DRAFT)', async () => {
    getSpy = jest.fn(() => of({ ...productFixture, status: 'ACTIVE' }));
    configure();
    await page.togglePublish();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith('prod-1', { status: 'DRAFT' });
  });

  it('maps ApiNotFoundError as not-found', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Product not found.');
  });

  it('switching to history tab fires listByEntity once', () => {
    configure();
    const audit = TestBed.inject(AuditLogService) as unknown as { listByEntity: jest.Mock };
    page.setTab('history');
    expect(audit.listByEntity).toHaveBeenCalledWith('product', 'prod-1', { pageSize: 20 });
    // Second flip to history doesn't re-fetch.
    page.setTab('general');
    page.setTab('history');
    expect(audit.listByEntity).toHaveBeenCalledTimes(1);
  });

  it('applyVariantSave replaces an existing variant in the product', () => {
    configure();
    const pageAny = page as unknown as {
      applyVariantSave: (v: unknown) => void;
    };
    pageAny.applyVariantSave({
      id: 'v-1',
      productId: 'prod-1',
      sku: 'SKU-1-NEW',
      price: 200,
      isActive: true,
      isDefault: true,
    });
    expect(page.product()?.variants?.[0]?.sku).toBe('SKU-1-NEW');
  });

  it('applyVariantDelete drops the variant by id', () => {
    configure();
    const pageAny = page as unknown as { applyVariantDelete: (id: string) => void };
    pageAny.applyVariantDelete('v-1');
    expect(page.product()?.variants ?? []).toHaveLength(0);
  });

  it('has no axe violations once loaded', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('records the picker selection and marks categoriesDirty', () => {
    configure();
    page.onCategorySelectionChange(['cat-1']);
    expect(page.selectedCategoryIds().has('cat-1')).toBe(true);
    expect(page.categoriesDirty()).toBe(true);
  });

  it('saves categoryIds when categoriesDirty without touching form fields', () => {
    configure();
    page.onCategorySelectionChange(['cat-1']);
    page.save();
    expect(updateSpy).toHaveBeenCalledWith('prod-1', { categoryIds: ['cat-1'] });
  });

  /**
   * The detach bug: an existing assignment must survive a save that only adds
   * another, because `update` replaces the set rather than merging it.
   *
   * Honest about its own reach: this spec stubs `ProductsService`, so the zod
   * parse that actually dropped `categories` never runs here and this assertion
   * was already green before the fix. The guard that goes red without the
   * schema key is `getProduct() surfaces categories from the include payload`
   * in libs/admin-services. This one pins the page half of the contract: that
   * the seeded ids are carried into the patch body rather than replaced.
   */
  it('keeps the categories the product already had when another is ticked', () => {
    getSpy = jest.fn(() =>
      of({
        ...productFixture,
        categories: [{ productId: 'prod-1', categoryId: 'cat-1' }],
      }),
    );
    configure();
    page.onCategorySelectionChange([...page.selectedCategoryIds(), 'cat-2']);
    page.save();
    expect(updateSpy).toHaveBeenCalledWith('prod-1', { categoryIds: ['cat-1', 'cat-2'] });
  });

  it('unticking the last category sends an explicit empty list', () => {
    getSpy = jest.fn(() =>
      of({
        ...productFixture,
        categories: [{ productId: 'prod-1', categoryId: 'cat-1' }],
      }),
    );
    configure();
    page.onCategorySelectionChange([]);
    page.save();
    expect(updateSpy).toHaveBeenCalledWith('prod-1', { categoryIds: [] });
  });

  describe('specifications tab', () => {
    /**
     * `isEditorTab` is a hand-written type guard that no compiler ties to the
     * `tabs` array. Forgetting an entry breaks only the ?tab= deep link, and it
     * does so silently, so the pair is pinned rather than trusted.
     */
    it('every declared tab passes the deep-link guard', () => {
      configure();
      const guard = (page as unknown as { isEditorTab: (v: string) => boolean }).isEditorTab.bind(
        page,
      );
      expect(page.tabs.map((t) => t.value).filter((v) => !guard(v))).toEqual([]);
    });

    it('exposes Specifications between Media and SEO', () => {
      configure();
      expect(page.tabs.map((t) => t.value)).toEqual([
        'general',
        'pricing',
        'variants',
        'media',
        'specs',
        'seo',
        'history',
      ]);
    });

    it('saving replaces the whole set and folds the result back into the product', () => {
      replaceSpecsSpy = jest.fn(() =>
        of([
          {
            id: 's1',
            label: { default: 'Materiau' },
            value: { default: 'Acier' },
            key: 'materiau',
            valueKey: 'acier',
            sortOrder: 0,
          },
        ]),
      );
      configure();
      page.setTab('specs');
      fixture.detectChanges();
      const matrix = page.specsMatrix()!;
      matrix.rows.at(0)?.get(['label', 'fr'])?.setValue('Materiau');
      page.onSpecsChanged();
      page.saveSpecs();

      expect(replaceSpecsSpy).toHaveBeenCalledWith(
        'prod-1',
        expect.objectContaining({ specs: [] }),
      );
      expect(page.product()?.specs).toHaveLength(1);
      expect(page.specsDirty()).toBe(false);
    });

    it('blocks a save while a row is missing its label or value', () => {
      configure();
      page.setTab('specs');
      fixture.detectChanges();
      // Add a row the way the operator does: it starts blank, and a blank
      // label folds to an empty key the server would reject.
      fixture.nativeElement.querySelector('[data-testid="product-spec-add"]').click();
      fixture.detectChanges();
      page.onSpecsChanged();
      page.saveSpecs();
      expect(replaceSpecsSpy).not.toHaveBeenCalled();
      expect(page.specsError()).toContain('label and a value');
    });

    /**
     * A folded-key collision is the one failure the operator cannot see for
     * themselves: the two rows look different on screen.
     */
    it('maps the duplicate-key 400 onto copy that explains the collision', () => {
      replaceSpecsSpy = jest.fn(() =>
        throwError(
          () =>
            new ApiError({
              code: 'PRODUCT_SPEC_DUPLICATE_KEY',
              message: 'are the same specification',
            }),
        ),
      );
      configure();
      page.setTab('specs');
      fixture.detectChanges();
      const matrix = page.specsMatrix()!;
      matrix.rows.at(0)?.get(['label', 'fr'])?.setValue('Materiau');
      matrix.rows.at(0)?.get(['value', 'fr'])?.setValue('Acier');
      page.onSpecsChanged();
      page.saveSpecs();
      expect(page.specsError()).toContain('accents and punctuation');
    });

    it('maps a forbidden save to a permission message', () => {
      replaceSpecsSpy = jest.fn(() =>
        throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
      );
      configure();
      page.setTab('specs');
      fixture.detectChanges();
      const matrix = page.specsMatrix()!;
      matrix.rows.at(0)?.get(['label', 'fr'])?.setValue('Materiau');
      matrix.rows.at(0)?.get(['value', 'fr'])?.setValue('Acier');
      page.onSpecsChanged();
      page.saveSpecs();
      expect(page.specsError()).toContain('permission');
    });

    it('saving specifications never touches the product PATCH', () => {
      configure();
      page.setTab('specs');
      fixture.detectChanges();
      const matrix = page.specsMatrix()!;
      matrix.rows.at(0)?.get(['label', 'fr'])?.setValue('Materiau');
      matrix.rows.at(0)?.get(['value', 'fr'])?.setValue('Acier');
      page.onSpecsChanged();
      page.saveSpecs();
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  it('media upload success chains updateProductAssets with the new row', async () => {
    uploadSpy.mockReturnValueOnce(of({ id: 'asset-new', url: 'https://x.y/z', status: 'READY' }));
    configure();
    page.onFilesAdded([new File(['x'], 'x.png', { type: 'image/png' })]);
    // Upload resolves synchronously via `of`; afterUploads triggers persist.
    expect(updateAssetsSpy).toHaveBeenCalled();
    const [, body] = updateAssetsSpy.mock.calls[0];
    expect(body.assets[0].assetId).toBe('asset-new');
    expect(body.assets[0].isPrimary).toBe(true);
  });

  it('media rejects return a human-readable error', () => {
    configure();
    page.onFilesRejected([
      { file: new File(['x'], 'big.png', { type: 'image/png' }), reason: 'size' },
    ]);
    expect(page.mediaError()).toContain('10 MB');
  });

  it('removeAsset refuses to leave the product with zero assets', () => {
    configure();
    page.assetRows.set([{ assetId: 'a1', sortOrder: 0, isPrimary: true }]);
    page.removeAsset('a1');
    expect(page.assetRows().some((r) => r.assetId === 'a1')).toBe(true);
    expect(page.mediaError()).toContain('Keep at least one');
  });

  it('setPrimaryAsset persists a single primary', () => {
    configure();
    page.assetRows.set([
      { assetId: 'a1', sortOrder: 0, isPrimary: true },
      { assetId: 'a2', sortOrder: 1, isPrimary: false },
    ]);
    page.setPrimaryAsset('a2');
    const [, body] = updateAssetsSpy.mock.calls[0];
    expect(body.assets.filter((a: { isPrimary: boolean }) => a.isPrimary)).toHaveLength(1);
    expect(body.assets.find((a: { assetId: string }) => a.assetId === 'a2').isPrimary).toBe(true);
  });

  it('moveAsset swaps and renumbers sort order', () => {
    configure();
    page.assetRows.set([
      { assetId: 'a1', sortOrder: 0, isPrimary: true },
      { assetId: 'a2', sortOrder: 1, isPrimary: false },
    ]);
    page.moveAsset(1, -1);
    const [, body] = updateAssetsSpy.mock.calls[0];
    expect(body.assets[0].assetId).toBe('a2');
    expect(body.assets[0].sortOrder).toBe(0);
    expect(body.assets[1].sortOrder).toBe(1);
  });

  /** AV3 — variants payload for fixture rows so the resolver shim resolves. */
  const buildVariantsForId = (id: string) => ({
    thumbnail: {
      webp: {
        url: `https://cdn.test/${id}-thumb.webp`,
        storagePath: `pub/${id}-t.webp`,
        width: 160,
        height: 120,
        size: 100,
      },
      avif: {
        url: `https://cdn.test/${id}-thumb.avif`,
        storagePath: `pub/${id}-t.avif`,
        width: 160,
        height: 120,
        size: 90,
      },
    },
    small: {
      webp: {
        url: `https://cdn.test/${id}-small.webp`,
        storagePath: `pub/${id}-s.webp`,
        width: 320,
        height: 240,
        size: 200,
      },
      avif: {
        url: `https://cdn.test/${id}-small.avif`,
        storagePath: `pub/${id}-s.avif`,
        width: 320,
        height: 240,
        size: 180,
      },
    },
    medium: {
      webp: {
        url: `https://cdn.test/${id}-med.webp`,
        storagePath: `pub/${id}-m.webp`,
        width: 640,
        height: 480,
        size: 400,
      },
      avif: {
        url: `https://cdn.test/${id}-med.avif`,
        storagePath: `pub/${id}-m.avif`,
        width: 640,
        height: 480,
        size: 360,
      },
    },
    large: {
      webp: {
        url: `https://cdn.test/${id}-large.webp`,
        storagePath: `pub/${id}-l.webp`,
        width: 1280,
        height: 960,
        size: 800,
      },
      avif: {
        url: `https://cdn.test/${id}-large.avif`,
        storagePath: `pub/${id}-l.avif`,
        width: 1280,
        height: 960,
        size: 720,
      },
    },
  });

  it('seedAssetRows hydrates row.asset from the product fixture', () => {
    getSpy = jest.fn(() =>
      of({
        ...productFixture,
        assets: [
          {
            assetId: 'a1',
            sortOrder: 0,
            isPrimary: true,
            asset: {
              id: 'a1',
              url: 'https://cdn.test/thumb.jpg',
              type: 'IMAGE' as const,
              alt: { default: 'Thumb' },
              status: 'READY' as const,
              mimeType: 'image/jpeg',
              fileSize: 4096,
              width: 800,
              height: 600,
              variants: buildVariantsForId('a1'),
            },
          },
        ],
      }),
    );
    configure();
    const rows = page.assetRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].assetId).toBe('a1');
    expect(rows[0].isPrimary).toBe(true);
    expect(rows[0].asset).toBeDefined();
    expect(rows[0].asset!.url).toBe('https://cdn.test/thumb.jpg');
    expect(rows[0].asset!.type).toBe('IMAGE');
  });

  // ── AV3 — Media tab tile binds variant URL ────────────────────────────────

  it('Media tab tile binds the resolved thumbnail variant URL, not raw asset.url', () => {
    getSpy = jest.fn(() =>
      of({
        ...productFixture,
        assets: [
          {
            assetId: 'a1',
            sortOrder: 0,
            isPrimary: true,
            asset: {
              id: 'a1',
              url: 'https://cdn.test/raw.jpg',
              type: 'IMAGE' as const,
              alt: 'Front',
              status: 'READY' as const,
              mimeType: 'image/jpeg',
              fileSize: 4096,
              width: 800,
              height: 600,
              variants: buildVariantsForId('a1'),
            },
          },
        ],
      }),
    );
    configure();
    page.setTab('media');
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector(
      '[data-testid="product-media-thumb-a1"]',
    ) as HTMLImageElement | null;
    expect(img?.tagName).toBe('IMG');
    expect(img!.getAttribute('src')).toBe('https://cdn.test/a1-thumb.webp');
  });

  it('Media tab tile renders a status-label fallback when an IMAGE row lacks variants', () => {
    getSpy = jest.fn(() =>
      of({
        ...productFixture,
        assets: [
          {
            assetId: 'a-pending',
            sortOrder: 0,
            isPrimary: true,
            // PROCESSING row, no variants payload yet — fall back path.
            asset: {
              id: 'a-pending',
              url: '',
              type: 'IMAGE' as const,
              alt: null,
              status: 'PROCESSING' as const,
              mimeType: 'image/jpeg',
              fileSize: 100,
            },
          },
        ],
      }),
    );
    configure();
    page.setTab('media');
    fixture.detectChanges();
    const tile = fixture.nativeElement.querySelector(
      '[data-testid="product-media-thumb-a-pending"]',
    ) as HTMLElement | null;
    expect(tile).not.toBeNull();
    expect(tile!.tagName).toBe('P');
    expect(tile!.textContent?.trim()).toBe('PROCESSING');
  });

  it('seedAssetRows returns an empty list when product.assets is absent', () => {
    getSpy = jest.fn(() => of(productFixture));
    configure();
    expect(page.assetRows()).toHaveLength(0);
  });

  it('persistAssets strips the asset envelope from the wire body', () => {
    configure();
    page.assetRows.set([
      {
        assetId: 'a1',
        sortOrder: 0,
        isPrimary: true,
        asset: {
          id: 'a1',
          url: 'https://cdn.test/x.jpg',
          type: 'IMAGE',
          alt: null,
        },
      },
      { assetId: 'a2', sortOrder: 1, isPrimary: false },
    ]);
    page.setPrimaryAsset('a2');
    const [, body] = updateAssetsSpy.mock.calls[0];
    for (const r of body.assets) {
      expect(Object.keys(r).sort()).toEqual(['assetId', 'isPrimary', 'sortOrder']);
    }
  });

  // ── S18.8 — picker consumer on media tab ─────────────────────────────────

  describe('openMediaPicker (S18 — picker consumer)', () => {
    const newAsset = {
      id: 'asset-new',
      url: 'https://cdn.test/new.jpg',
      type: 'IMAGE' as const,
      status: 'READY' as const,
      mimeType: 'image/jpeg',
      fileSize: 4096,
      alt: { default: 'New' },
      createdAt: '2026-04-21T10:00:00.000Z',
      updatedAt: '2026-04-21T10:00:00.000Z',
    };

    afterEach(() => jest.restoreAllMocks());

    it('opens the picker in multi-select with current ids preselected', async () => {
      const pickerSpy = jest
        .spyOn(adminUi, 'openAssetPicker')
        .mockResolvedValue({ kind: 'cancel' });
      configure();
      page.assetRows.set([{ assetId: 'a1', sortOrder: 0, isPrimary: true }]);
      await page.openMediaPicker();
      expect(pickerSpy).toHaveBeenCalledTimes(1);
      const opts = pickerSpy.mock.calls[0]?.[1] as {
        mode: string;
        selectedIds: string[];
        filter: { type: string };
      };
      expect(opts.mode).toBe('multi');
      expect(opts.selectedIds).toEqual(['a1']);
      expect(opts.filter.type).toBe('IMAGE');
    });

    it('appends picked assets that are not already attached', async () => {
      jest
        .spyOn(adminUi, 'openAssetPicker')
        .mockResolvedValue({ kind: 'select-multi', assets: [newAsset] });
      configure();
      page.assetRows.set([{ assetId: 'a1', sortOrder: 0, isPrimary: true }]);
      await page.openMediaPicker();
      expect(updateAssetsSpy).toHaveBeenCalled();
      const [, body] = updateAssetsSpy.mock.calls[0];
      expect(body.assets).toHaveLength(2);
      expect(body.assets[1].assetId).toBe('asset-new');
      expect(body.assets[1].sortOrder).toBe(1);
      expect(body.assets[1].isPrimary).toBe(false);
    });

    it('marks the very first picked asset as primary when the list was empty', async () => {
      jest
        .spyOn(adminUi, 'openAssetPicker')
        .mockResolvedValue({ kind: 'select-multi', assets: [newAsset] });
      configure();
      page.assetRows.set([]);
      await page.openMediaPicker();
      const [, body] = updateAssetsSpy.mock.calls[0];
      expect(body.assets[0].isPrimary).toBe(true);
    });

    it('skips already-attached assets without firing a no-op persist', async () => {
      jest
        .spyOn(adminUi, 'openAssetPicker')
        .mockResolvedValue({ kind: 'select-multi', assets: [newAsset] });
      configure();
      page.assetRows.set([{ assetId: 'asset-new', sortOrder: 0, isPrimary: true }]);
      await page.openMediaPicker();
      expect(updateAssetsSpy).not.toHaveBeenCalled();
    });

    it('treats cancel as a no-op', async () => {
      jest.spyOn(adminUi, 'openAssetPicker').mockResolvedValue({ kind: 'cancel' });
      configure();
      page.assetRows.set([]);
      await page.openMediaPicker();
      expect(updateAssetsSpy).not.toHaveBeenCalled();
    });
  });
});
