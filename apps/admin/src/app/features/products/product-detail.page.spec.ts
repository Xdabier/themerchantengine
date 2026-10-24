import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { AssetsService, GeoService, ProductsService, SeoService } from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ProductDetailPage } from './product-detail.page';

expect.extend(toHaveNoViolations);

describe('ProductDetailPage', () => {
  let fixture: ComponentFixture<ProductDetailPage>;
  let page: ProductDetailPage;
  let getSpy: jest.Mock;
  let restoreSpy: jest.Mock;
  let createFaqSpy: jest.Mock;
  let updateFaqSpy: jest.Mock;
  let deleteFaqSpy: jest.Mock;
  let getAiReadinessSpy: jest.Mock;
  let getFaqSuggestionsSpy: jest.Mock;
  let acceptFaqSuggestionsSpy: jest.Mock;
  let inspectUrlSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;
  let paramMap$: BehaviorSubject<ParamMap>;

  // The page's default perms exclude seo:view; spread + 'seo:view' to render the
  // D5 "Search index" section.
  const SEO_PERMS = [
    'products:view',
    'products:create',
    'products:update',
    'products:delete',
    'geo:view',
    'geo:create',
    'seo:view',
  ];

  const faqFixture = {
    id: 'faq-1',
    productId: 'prod-1',
    question: { default: 'What size fits?' },
    answer: { default: 'See our size chart.' },
    sortOrder: 0,
  };

  const faqProductFixture = () => ({
    ...productFixture,
    faqs: [faqFixture],
  });

  const reportFixture = {
    score: 72,
    signals: {
      answerFirstDescription: 0.8,
      faqEntries: 0.5,
      completeSchemaMarkup: 1,
    },
  };

  const suggestionFixture = {
    question: { default: 'How do I track my order?' },
    answer: { default: 'Check the tracking link in your confirmation email.' },
  };

  const productFixture = {
    id: 'prod-1',
    name: { default: 'Backpack', en: 'Backpack' },
    slug: 'backpack',
    description: { default: 'A canvas backpack.', en: 'A canvas backpack.' },
    status: 'ACTIVE',
    brand: 'Badii',
    productTypeId: 'pt-general',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    variants: [
      { id: 'v-1', sku: 'SKU-1', price: 289, isActive: true, isDefault: true, weight: 0.6 },
    ],
    qualityScore: { score: 72, grade: 'yellow' as const },
  };

  const deletedFixture = {
    ...productFixture,
    status: 'ARCHIVED',
    deletedAt: '2026-04-15T12:00:00.000Z',
  };

  const restoredFixture = {
    ...productFixture,
    status: 'DRAFT',
    deletedAt: null,
  };

  function configure(
    id: string | null,
    perms: string[] = [
      'products:view',
      'products:create',
      'products:update',
      'products:delete',
      'geo:view',
      'geo:create',
    ],
  ) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap(id ? { id } : {}));
    // AV3 — page injects `AssetsService` for the media-strip variant URL
    // shim. Provide a real instance via prototype-extension so the resolver
    // shim shares behaviour with production; only the HTTP-bearing methods
    // would need a stub, none of which the detail page calls.
    const fakeAssetsService = Object.create(
      (AssetsService as { prototype: object }).prototype,
    ) as AssetsService;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: ProductsService,
          useValue: {
            getProduct: getSpy,
            restoreProduct: restoreSpy,
            createFaq: createFaqSpy,
            updateFaq: updateFaqSpy,
            deleteFaq: deleteFaqSpy,
          },
        },
        {
          provide: GeoService,
          useValue: {
            getAiReadiness: getAiReadinessSpy,
            getFaqSuggestions: getFaqSuggestionsSpy,
            acceptFaqSuggestions: acceptFaqSuggestionsSpy,
          },
        },
        { provide: AssetsService, useValue: fakeAssetsService },
        { provide: SeoService, useValue: { inspectUrl: inspectUrlSpy } },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(ProductDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(productFixture));
    restoreSpy = jest.fn(() => of(restoredFixture));
    createFaqSpy = jest.fn(() => of(faqFixture));
    updateFaqSpy = jest.fn(() => of(faqFixture));
    deleteFaqSpy = jest.fn(() => of(undefined));
    getAiReadinessSpy = jest.fn(() => of(reportFixture));
    getFaqSuggestionsSpy = jest.fn(() => of({ data: [suggestionFixture] }));
    acceptFaqSuggestionsSpy = jest.fn(() => of({ data: [faqFixture] }));
    // Lazy-on-click: the badge must NOT call inspectUrl in setup, so leave it a
    // bare mock (returns undefined) — any test that asserts non-invocation relies
    // on this default.
    inspectUrlSpy = jest.fn();
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => confirmSpy.mockRestore());

  it('loads the product for the :id param', () => {
    configure('prod-1');
    expect(getSpy).toHaveBeenCalledWith('prod-1');
    expect(page.product()?.id).toBe('prod-1');
    expect(page.loading()).toBe(false);
  });

  describe('categories panel', () => {
    it('renders one chip per assignment, resolved at the active locale', () => {
      getSpy = jest.fn(() =>
        of({
          ...productFixture,
          categories: [
            {
              categoryId: 'cat-1',
              category: { id: 'cat-1', name: { default: 'Soins', fr: 'Soins' }, slug: 'soins' },
            },
          ],
        }),
      );
      configure('prod-1');
      const chip = fixture.nativeElement.querySelector(
        '[data-testid="product-category-chip-cat-1"]',
      );
      expect(chip).not.toBeNull();
      expect(chip.textContent.trim()).toBe('Soins');
    });

    it('falls back to the slug when the join is absent, never rendering an object', () => {
      getSpy = jest.fn(() => of({ ...productFixture, categories: [{ categoryId: 'cat-9' }] }));
      configure('prod-1');
      const chip = fixture.nativeElement.querySelector(
        '[data-testid="product-category-chip-cat-9"]',
      );
      expect(chip.textContent.trim()).toBe('cat-9');
      expect(fixture.nativeElement.textContent).not.toContain('[object Object]');
    });

    it('renders the empty state when the product has none', () => {
      configure('prod-1');
      expect(
        fixture.nativeElement.querySelector('[data-testid="product-categories-empty"]'),
      ).not.toBeNull();
    });
  });

  describe('description card', () => {
    // The read view renders what the WYSIWYG stored. Two content generations
    // share the field, and the wrong treatment is visible in both directions:
    // interpolating HTML shows the operator raw tags, and HTML-rendering plain
    // text swallows its \n paragraph breaks.
    function descriptionCard(): HTMLElement {
      return fixture.nativeElement.querySelector('[data-testid="product-description-body"]');
    }

    it('renders an authored description as real elements', () => {
      getSpy = jest.fn(() =>
        of({
          ...productFixture,
          description: {
            default: '<p>x <strong>y</strong></p>',
            en: '<p>x <strong>y</strong></p>',
          },
        }),
      );
      configure('prod-1');
      const card = descriptionCard();
      expect(card.querySelector('strong')?.textContent).toBe('y');
      expect(card.textContent).not.toContain('<strong>');
    });

    it('keeps the paragraph breaks of a plain-text description', () => {
      const plain = 'Ligne une.\n\nLigne deux.';
      getSpy = jest.fn(() => of({ ...productFixture, description: { default: plain, en: plain } }));
      configure('prod-1');
      const card = descriptionCard();
      expect(card.className).toContain('whitespace-pre-line');
      expect(card.textContent).toContain('Ligne une.\n\nLigne deux.');
    });
  });

  describe('specifications panel', () => {
    it('renders label and value resolved at the active locale', () => {
      getSpy = jest.fn(() =>
        of({
          ...productFixture,
          specs: [
            {
              id: 'sp-1',
              label: { default: 'Materiau', fr: 'Materiau', en: 'Material' },
              value: { default: 'Titane', fr: 'Titane', en: 'Titanium' },
              key: 'materiau',
              valueKey: 'titane',
              sortOrder: 0,
            },
          ],
        }),
      );
      configure('prod-1');
      const row = fixture.nativeElement.querySelector('[data-testid="product-spec-sp-1"]');
      expect(row).not.toBeNull();
      expect(row.textContent).toContain('Materiau');
      expect(row.textContent).toContain('Titane');
      expect(fixture.nativeElement.textContent).not.toContain('object Object');
    });

    it('renders the empty state when the product has none', () => {
      configure('prod-1');
      expect(
        fixture.nativeElement.querySelector('[data-testid="product-spec-empty"]'),
      ).not.toBeNull();
    });

    it('keeps the API order rather than re-sorting', () => {
      getSpy = jest.fn(() =>
        of({
          ...productFixture,
          specs: [
            {
              id: 'b',
              label: { default: 'Zeta' },
              value: { default: '2' },
              key: 'zeta',
              valueKey: '2',
              sortOrder: 0,
            },
            {
              id: 'a',
              label: { default: 'Alpha' },
              value: { default: '1' },
              key: 'alpha',
              valueKey: '1',
              sortOrder: 1,
            },
          ],
        }),
      );
      configure('prod-1');
      const labels = [
        ...fixture.nativeElement.querySelectorAll('[data-testid^="product-spec-"] td:first-child'),
      ].map((td: HTMLElement) => td.textContent?.trim());
      expect(labels).toEqual(['Zeta', 'Alpha']);
    });
  });

  it('keeps the FAQ question error live after the field is edited (zoneless reactivity)', () => {
    configure('prod-1');
    // Regression guard for the memoized-computed bug: the error must be re-read
    // AFTER the field changes, not just on the pristine form. A computed() over
    // faqForm getters freezes at its initial (null) value under zoneless CD.
    expect(page.questionError()).toBeNull();

    page.faqForm.controls.question.setValue('');
    page.faqForm.controls.question.markAsDirty();
    fixture.detectChanges();

    expect(page.questionError()).toBe('Question is required.');
  });

  it('maps ApiNotFoundError to "Product not found."', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure('nope');
    expect(page.error()).toBe('Product not found.');
  });

  it('maps ApiForbiddenError to a permission-safe message', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure('prod-1');
    expect(page.error()).toContain('permission');
  });

  it('records an error when no :id is present', () => {
    getSpy = jest.fn();
    configure(null);
    expect(getSpy).not.toHaveBeenCalled();
    expect(page.error()).toBe('Missing product id.');
  });

  it('has no axe violations when a product is loaded', async () => {
    configure('prod-1');
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  /* Restore action */

  it('hides Restore button when deletedAt is null/undefined', () => {
    configure('prod-1');
    const btn = fixture.nativeElement.querySelector('[data-testid="product-restore-button"]');
    expect(btn).toBeNull();
    expect(page.canRestore()).toBe(false);
  });

  it('shows Restore button when deletedAt is set and user has products:update', () => {
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1');
    const btn = fixture.nativeElement.querySelector('[data-testid="product-restore-button"]');
    expect(btn).not.toBeNull();
    expect(page.canRestore()).toBe(true);
  });

  it('hides Restore button when user lacks products:update even if deletedAt is set', () => {
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1', ['products:view']);
    const btn = fixture.nativeElement.querySelector('[data-testid="product-restore-button"]');
    expect(btn).toBeNull();
    expect(page.canRestore()).toBe(false);
  });

  it('clicking Restore opens ConfirmDialogComponent', async () => {
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1');
    await page.onRestoreClick();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('confirming the dialog calls restoreProduct and updates the product signal', async () => {
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1');
    await page.onRestoreClick();
    expect(restoreSpy).toHaveBeenCalledWith('prod-1');
    expect(page.product()?.deletedAt).toBeNull();
    expect(page.product()?.status).toBe('DRAFT');
  });

  it('cancelling the dialog does not call restoreProduct', async () => {
    confirmSpy.mockResolvedValueOnce(false);
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1');
    await page.onRestoreClick();
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('restore button carries aria-busy="true" while the call is in flight', async () => {
    const pending$ = new Subject<typeof restoredFixture>();
    restoreSpy = jest.fn(() => pending$.asObservable());
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1');
    const clickPromise = page.onRestoreClick();
    await Promise.resolve();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="product-restore-button"] button',
    ) as HTMLButtonElement | null;
    expect(btn?.getAttribute('aria-busy')).toBe('true');
    pending$.next(restoredFixture);
    pending$.complete();
    await clickPromise;
  });

  it('emits a role=status aria-live=polite success announcement after restore', async () => {
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1');
    await page.onRestoreClick();
    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector(
      '[data-testid="product-restore-status"]',
    ) as HTMLElement | null;
    expect(status).not.toBeNull();
    expect(status!.getAttribute('role')).toBe('status');
    expect(status!.getAttribute('aria-live')).toBe('polite');
    expect(status!.textContent).toContain('restored');
  });

  it('maps ApiForbiddenError during restore to a permission-safe error', async () => {
    getSpy = jest.fn(() => of(deletedFixture));
    restoreSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure('prod-1');
    await page.onRestoreClick();
    expect(page.error()).toContain('permission');
  });

  it('maps ApiNotFoundError during restore to "Product not found."', async () => {
    getSpy = jest.fn(() => of(deletedFixture));
    restoreSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure('prod-1');
    await page.onRestoreClick();
    expect(page.error()).toBe('Product not found.');
  });

  it('maps generic ApiError during restore to its user-safe message', async () => {
    getSpy = jest.fn(() => of(deletedFixture));
    restoreSpy = jest.fn(() =>
      throwError(
        () => new ApiError({ code: 'WAT', message: 'Something went sideways.', status: 500 }),
      ),
    );
    configure('prod-1');
    await page.onRestoreClick();
    expect(page.error()).toBe('Something went sideways.');
  });

  it('has no axe violations in soft-deleted state (Restore button visible)', async () => {
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1');
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in post-restore state (status announcement live)', async () => {
    getSpy = jest.fn(() => of(deletedFixture));
    configure('prod-1');
    await page.onRestoreClick();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  /* FAQ panel */

  it('renders the FAQ empty-state copy when product has no faqs', () => {
    configure('prod-1');
    const empty = fixture.nativeElement.querySelector('[data-testid="product-faq-empty"]');
    expect(empty).not.toBeNull();
  });

  it('renders one FAQ card per entry when product.faqs is populated', () => {
    getSpy = jest.fn(() => of(faqProductFixture()));
    configure('prod-1');
    const card = fixture.nativeElement.querySelector(
      `[data-testid="product-faq-card-${faqFixture.id}"]`,
    );
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('What size fits?');
  });

  it('hides Add FAQ button when user lacks products:create', () => {
    configure('prod-1', ['products:view', 'products:update']);
    const btn = fixture.nativeElement.querySelector('[data-testid="product-faq-add"]');
    expect(btn).toBeNull();
  });

  it('clicking Add FAQ reveals the inline form', () => {
    configure('prod-1');
    fixture.nativeElement.querySelector('[data-testid="product-faq-add"] button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="product-faq-form"]')).not.toBeNull();
  });

  it('submitting the FAQ form calls createFaq and refreshes the product', () => {
    getSpy = jest
      .fn()
      .mockReturnValueOnce(of(productFixture))
      .mockReturnValueOnce(of(faqProductFixture()));
    configure('prod-1');
    page.onAddFaqClick();
    page.faqForm.setValue({ question: 'New Q?', answer: 'New A.' });
    page.onSaveFaq();
    expect(createFaqSpy).toHaveBeenCalledWith('prod-1', {
      question: { default: 'New Q?' },
      answer: { default: 'New A.' },
    });
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(page.editingFaq()).toBeNull();
    expect(page.faqAnnouncement()).toContain('created');
  });

  it('Edit pre-fills the form with existing values', () => {
    getSpy = jest.fn(() => of(faqProductFixture()));
    configure('prod-1');
    page.onEditFaqClick(faqFixture);
    expect(page.editingFaq()).toBe('faq-1');
    expect(page.faqForm.value).toEqual({
      question: 'What size fits?',
      answer: 'See our size chart.',
    });
  });

  it('Save while editing calls updateFaq with the faq id', () => {
    getSpy = jest
      .fn()
      .mockReturnValueOnce(of(faqProductFixture()))
      .mockReturnValueOnce(of(faqProductFixture()));
    configure('prod-1');
    page.onEditFaqClick(faqFixture);
    page.faqForm.patchValue({ answer: 'Updated answer.' });
    page.onSaveFaq();
    expect(updateFaqSpy).toHaveBeenCalledWith('prod-1', 'faq-1', {
      question: { default: 'What size fits?' },
      answer: { default: 'Updated answer.' },
    });
    expect(page.faqAnnouncement()).toContain('updated');
  });

  it('Delete opens ConfirmDialog and calls deleteFaq on confirm', async () => {
    getSpy = jest
      .fn()
      .mockReturnValueOnce(of(faqProductFixture()))
      .mockReturnValueOnce(of(productFixture));
    configure('prod-1');
    await page.onDeleteFaqClick(faqFixture);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteFaqSpy).toHaveBeenCalledWith('prod-1', 'faq-1');
    expect(page.faqAnnouncement()).toContain('deleted');
  });

  it('Cancelling the delete dialog does not call deleteFaq', async () => {
    confirmSpy.mockResolvedValueOnce(false);
    getSpy = jest.fn(() => of(faqProductFixture()));
    configure('prod-1');
    await page.onDeleteFaqClick(faqFixture);
    expect(deleteFaqSpy).not.toHaveBeenCalled();
  });

  it('createFaq() 404 maps to "FAQ not found." in the FAQ error banner', () => {
    createFaqSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure('prod-1');
    page.onAddFaqClick();
    page.faqForm.setValue({ question: 'Q?', answer: 'A.' });
    page.onSaveFaq();
    expect(page.faqError()).toBe('FAQ not found.');
  });

  it('deleteFaq() 403 maps to permission-safe copy', async () => {
    deleteFaqSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' })),
    );
    getSpy = jest.fn(() => of(faqProductFixture()));
    configure('prod-1');
    await page.onDeleteFaqClick(faqFixture);
    expect(page.faqError()).toContain('permission');
  });

  it('createFaq() generic ApiError maps to its message', () => {
    createFaqSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'WAT', message: 'FAQ oops.', status: 500 })),
    );
    configure('prod-1');
    page.onAddFaqClick();
    page.faqForm.setValue({ question: 'Q?', answer: 'A.' });
    page.onSaveFaq();
    expect(page.faqError()).toBe('FAQ oops.');
  });

  it('has no axe violations with FAQ list populated', async () => {
    getSpy = jest.fn(() => of(faqProductFixture()));
    configure('prod-1');
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with Add FAQ form open', async () => {
    configure('prod-1');
    page.onAddFaqClick();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  /* GEO panel */

  it('keeps the store-wide score off the product page', () => {
    // Finding E4: the score and its signals are store-wide; they render on
    // /seo/health now, and only per-product content stays here.
    configure('prod-1');
    expect(fixture.nativeElement.querySelector('[data-testid="product-geo-score"]')).toBeNull();
    const panel = fixture.nativeElement.querySelector('[data-testid="product-geo-panel"]');
    expect(panel.textContent).not.toContain('Store-wide score');
    expect(getAiReadinessSpy).not.toHaveBeenCalled();
  });

  it('explains the per-product quality badge on hover', () => {
    configure('prod-1');
    const badge = fixture.nativeElement.querySelector('app-badge[title]');
    expect(badge?.getAttribute('title')).toBe('Product content quality score (0–100)');
  });

  it('lays the FAQ row actions out side by side', () => {
    getSpy = jest.fn(() => of(faqProductFixture()));
    configure('prod-1');
    const actions = fixture.nativeElement.querySelector(
      '[data-testid^="product-faq-edit-"]',
    )?.parentElement;
    expect(actions?.className).toContain('flex');
    expect(actions?.className).not.toContain('flex-col');
  });

  it('renders suggestion cards when getFaqSuggestions returns data', () => {
    configure('prod-1');
    const panel = fixture.nativeElement.querySelector('[data-testid="product-geo-panel"]');
    expect(panel.textContent).toContain('How do I track my order?');
  });

  it('renders AI-ready empty-state copy when suggestions is empty', () => {
    getFaqSuggestionsSpy = jest.fn(() => of({ data: [] }));
    configure('prod-1');
    expect(fixture.nativeElement.querySelector('[data-testid="product-geo-empty"]')).not.toBeNull();
  });

  it('hides Accept button when user lacks geo:create', () => {
    configure('prod-1', ['products:view', 'geo:view']);
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-geo-accept-button"]'),
    ).toBeNull();
  });

  it('hides GEO panel when user lacks geo:view', () => {
    configure('prod-1', ['products:view']);
    expect(fixture.nativeElement.querySelector('[data-testid="product-geo-panel"]')).toBeNull();
  });

  it('clicking Accept calls acceptFaqSuggestions and refreshes the FAQ panel', () => {
    getSpy = jest
      .fn()
      .mockReturnValueOnce(of(productFixture))
      .mockReturnValueOnce(of(faqProductFixture()));
    configure('prod-1');
    page.onAcceptSuggestions();
    expect(acceptFaqSuggestionsSpy).toHaveBeenCalledWith('prod-1', {
      faqs: [suggestionFixture],
    });
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(page.geoAnnouncement()).toContain('accepted');
    expect(page.geoSuggestions()).toEqual([]);
  });

  it('acceptFaqSuggestions 403 surfaces in the GEO error banner', () => {
    acceptFaqSuggestionsSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' })),
    );
    configure('prod-1');
    page.onAcceptSuggestions();
    expect(page.geoError()).toContain('permission');
  });

  it('a failed suggestions fetch surfaces in the GEO error banner', () => {
    getFaqSuggestionsSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'WAT', message: 'GEO oops.', status: 500 })),
    );
    configure('prod-1');
    expect(page.geoError()).toBe('GEO oops.');
  });

  it('has no axe violations with GEO score + suggestions rendered', async () => {
    configure('prod-1');
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in GEO empty-state (AI-ready)', async () => {
    getFaqSuggestionsSpy = jest.fn(() => of({ data: [] }));
    configure('prod-1');
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations while FAQ save is in flight (faqPending=true)', async () => {
    const pending$ = new Subject<typeof faqFixture>();
    createFaqSpy = jest.fn(() => pending$.asObservable());
    configure('prod-1');
    page.onAddFaqClick();
    page.faqForm.setValue({ question: 'Q?', answer: 'A.' });
    page.onSaveFaq();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
    pending$.complete();
  });

  it('has no axe violations after accepting GEO suggestions', async () => {
    configure('prod-1');
    page.onAcceptSuggestions();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  /* Media thumb strip (S16.4) */

  /**
   * AV3 — variants payload mirrors `assetVariantsSchema`. The resolver shim
   * picks `variants.thumbnail.webp.url` for the `'thumbnail'` intent. Each
   * fixture asset gets its own URL so test assertions can distinguish them.
   */
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

  const productWithAssetsFixture = () => ({
    ...productFixture,
    assets: [
      {
        assetId: 'asset-1',
        sortOrder: 0,
        isPrimary: true,
        asset: {
          id: 'asset-1',
          url: 'https://cdn.test/primary.jpg',
          type: 'IMAGE' as const,
          alt: { default: 'Front view' },
          status: 'READY' as const,
          mimeType: 'image/jpeg',
          fileSize: 4096,
          width: 800,
          height: 600,
          variants: buildVariantsForId('asset-1'),
        },
      },
      {
        assetId: 'asset-2',
        sortOrder: 1,
        isPrimary: false,
        asset: {
          id: 'asset-2',
          url: 'https://cdn.test/back.jpg',
          type: 'IMAGE' as const,
          alt: 'Back view',
          status: 'READY' as const,
          mimeType: 'image/jpeg',
          fileSize: 4096,
          width: 800,
          height: 600,
          variants: buildVariantsForId('asset-2'),
        },
      },
    ],
  });

  it('renders the media thumb strip when product.assets is populated', () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1');
    const strip = fixture.nativeElement.querySelector('[data-testid="product-media-strip"]');
    expect(strip).not.toBeNull();
    const thumbs = fixture.nativeElement.querySelectorAll('[data-testid="product-media-strip"] li');
    expect(thumbs).toHaveLength(2);
  });

  it('renders one <img> per IMAGE asset with src and resolved alt', () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1');
    const imgs = fixture.nativeElement.querySelectorAll(
      '[data-testid="product-media-strip"] img',
    ) as NodeListOf<HTMLImageElement>;
    expect(imgs).toHaveLength(2);
    // AV3 — bindings now resolve via the variant URL shim, not raw asset.url.
    expect(imgs[0].getAttribute('src')).toBe('https://cdn.test/asset-1-thumb.webp');
    expect(imgs[1].getAttribute('src')).toBe('https://cdn.test/asset-2-thumb.webp');
    expect(imgs[0].getAttribute('alt')).toBe('Front view');
    expect(imgs[1].getAttribute('alt')).toBe('Back view');
  });

  // ── AV3 — variant URL fallback for IMAGE rows missing variants ──────────

  it('media-strip falls back to a type-label block for an IMAGE asset missing variants', () => {
    getSpy = jest.fn(() =>
      of({
        ...productFixture,
        assets: [
          {
            assetId: 'asset-pending',
            sortOrder: 0,
            isPrimary: true,
            // Image asset still PROCESSING — no variants payload yet. The
            // resolver returns null and the template should render the
            // type-label `<p>` block instead of a broken `<img>`.
            asset: {
              id: 'asset-pending',
              url: '',
              type: 'IMAGE' as const,
              alt: { default: 'pending' },
              status: 'PROCESSING' as const,
              mimeType: 'image/jpeg',
              fileSize: 1000,
            },
          },
        ],
      }),
    );
    configure('prod-1');
    const imgs = fixture.nativeElement.querySelectorAll('[data-testid="product-media-strip"] img');
    expect(imgs).toHaveLength(0);
    const fallback = fixture.nativeElement.querySelector(
      '[data-testid="product-media-strip-thumb-asset-pending"] p',
    ) as HTMLElement | null;
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent?.trim()).toBe('IMAGE');
  });

  it('hides the media thumb strip when product.assets is an empty array', () => {
    getSpy = jest.fn(() => of({ ...productFixture, assets: [] }));
    configure('prod-1');
    const strip = fixture.nativeElement.querySelector('[data-testid="product-media-strip"]');
    expect(strip).toBeNull();
  });

  it('hides the media thumb strip when product.assets is absent', () => {
    getSpy = jest.fn(() => of(productFixture));
    configure('prod-1');
    const strip = fixture.nativeElement.querySelector('[data-testid="product-media-strip"]');
    expect(strip).toBeNull();
  });

  it('marks the primary asset thumb with the ink border class', () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1');
    const primary = fixture.nativeElement.querySelector(
      '[data-testid="product-media-strip-thumb-asset-1"]',
    ) as HTMLElement;
    expect(primary.classList.contains('border-ink')).toBe(true);
    const secondary = fixture.nativeElement.querySelector(
      '[data-testid="product-media-strip-thumb-asset-2"]',
    ) as HTMLElement;
    expect(secondary.classList.contains('border-ink')).toBe(false);
  });

  it('Manage link routes to /products/:id/edit?tab=media when user can edit', () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1');
    const link = fixture.nativeElement.querySelector(
      '[data-testid="product-media-strip-edit-link"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/products/prod-1/edit?tab=media');
  });

  it('hides the Manage link when user lacks products:update', () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1', ['products:view']);
    const link = fixture.nativeElement.querySelector(
      '[data-testid="product-media-strip-edit-link"]',
    );
    expect(link).toBeNull();
  });

  it('each thumb is a routerLink to /edit?tab=media when user can edit', () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1');
    const links = fixture.nativeElement.querySelectorAll(
      '[data-testid^="product-media-strip-thumb-link-"]',
    ) as NodeListOf<HTMLAnchorElement>;
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/products/prod-1/edit?tab=media');
    expect(links[1].getAttribute('href')).toBe('/products/prod-1/edit?tab=media');
  });

  it('each thumb-link carries a unique aria-label naming its position and primary status', () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1');
    const links = fixture.nativeElement.querySelectorAll(
      '[data-testid^="product-media-strip-thumb-link-"]',
    ) as NodeListOf<HTMLAnchorElement>;
    const labels = Array.from(links).map((a) => a.getAttribute('aria-label'));
    expect(labels[0]).toContain('1 of 2');
    expect(labels[0]).toContain('primary');
    expect(labels[1]).toContain('2 of 2');
    expect(labels[1]).not.toContain('primary');
  });

  it('thumbs render without a routerLink when user lacks products:update', () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1', ['products:view']);
    const links = fixture.nativeElement.querySelectorAll(
      '[data-testid^="product-media-strip-thumb-link-"]',
    );
    expect(links).toHaveLength(0);
    const thumbs = fixture.nativeElement.querySelectorAll('[data-testid="product-media-strip"] li');
    expect(thumbs).toHaveLength(2);
  });

  it('renders a non-image badge for VIDEO/DOCUMENT/AUDIO assets', () => {
    getSpy = jest.fn(() =>
      of({
        ...productFixture,
        assets: [
          {
            assetId: 'asset-vid',
            sortOrder: 0,
            isPrimary: true,
            asset: {
              id: 'asset-vid',
              url: 'https://cdn.test/clip.mp4',
              type: 'VIDEO' as const,
              alt: null,
              status: 'READY' as const,
              mimeType: 'video/mp4',
              fileSize: 1024 * 1024,
              width: null,
              height: null,
            },
          },
        ],
      }),
    );
    configure('prod-1');
    const thumb = fixture.nativeElement.querySelector(
      '[data-testid="product-media-strip-thumb-asset-vid"]',
    ) as HTMLElement;
    expect(thumb).not.toBeNull();
    expect(thumb.querySelector('img')).toBeNull();
    expect(thumb.textContent).toContain('VIDEO');
  });

  it('has no axe violations with the media thumb strip rendered', async () => {
    getSpy = jest.fn(() => of(productWithAssetsFixture()));
    configure('prod-1');
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  // ── Search index section (DR-17 D5) ──────────────────────────────────────────

  describe('Search index section', () => {
    const sel = '[data-testid="product-seo-section"]';

    it('renders the section + lazy trigger when the user has seo:view', () => {
      configure('prod-1', SEO_PERMS);
      const section = fixture.nativeElement.querySelector(sel);
      expect(section).not.toBeNull();
      expect(section.querySelector('[data-testid="seo-index-state-check"]')).not.toBeNull();
    });

    it('hides the section without seo:view', () => {
      configure('prod-1'); // default perms — no seo:view
      expect(fixture.nativeElement.querySelector(sel)).toBeNull();
    });

    it('does NOT call inspectUrl on init (lazy on-click only)', () => {
      configure('prod-1', SEO_PERMS);
      expect(inspectUrlSpy).not.toHaveBeenCalled();
    });

    it('has no axe violations with the Search index section visible', async () => {
      configure('prod-1', SEO_PERMS);
      const results = await axe(fixture.nativeElement);
      expect(results).toHaveNoViolations();
    });
  });
});
