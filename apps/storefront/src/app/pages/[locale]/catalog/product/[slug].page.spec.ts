import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CartService,
  ProductsService,
  QuestionsService,
  ReviewsService,
  STOREFRONT_API_CLIENT,
  type ApiClient,
} from '@storefront-services';
import {
  StorefrontConflictError,
  StorefrontError,
  StorefrontForbiddenError,
  StorefrontNotFoundError,
  StorefrontValidationError,
} from '@storefront-types';

import { AuthStateService } from '../../../../services/auth-state.service';
import { LocaleService } from '../../../../locale.service';
import { getChromeStrings } from '../../../../../i18n';
import { type Locale } from '../../../../../i18n/types';
import {
  regionFromLocale,
  ogLocaleAlternates,
  ogLocaleFromLocale,
} from '../../../../../lib/locale-region';
import ProductDetailPage from './[slug].page';
import {
  fixtureRuntimeConfig,
  provideFixtureStoreConfig,
  fixtureChromeIdentity,
} from '../../../../../test-support/store-config-fixtures';

/** The scenario config every page spec renders under. */
const SEO_LOCALES = {
  supportedLocales: fixtureRuntimeConfig('maghreb-ltr').localization.supportedLocales,
  defaultLocale: fixtureRuntimeConfig('maghreb-ltr').localization.defaultLocale,
  country: fixtureRuntimeConfig('maghreb-ltr').identity.address.country,
};

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;

  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }

  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
  readonly currentUrl = () => `/${this._locale()}/catalog/product/echo-buds-pro`;
}

const SAMPLE_PRODUCT = {
  id: 'p1',
  slug: 'echo-buds-pro',
  name: 'Echo Buds Pro',
  description: 'Wireless earbuds with active noise cancellation.',
  brand: 'Echo',
  primaryAsset: { url: '/uploads/echo-pro-1.jpg' },
  assets: [
    { url: '/uploads/echo-pro-1.jpg', sortOrder: 0, isPrimary: true },
    { url: '/uploads/echo-pro-2.jpg', sortOrder: 1 },
  ],
  variants: [{ id: 'v1', sku: 'EB-PRO-001', price: '449.00', stock: 10, isDefault: true }],
  faqs: [],
  categories: [{ id: 'cat-audio', slug: 'fx-audio', name: 'Audio' }],
  currency: 'AED',
  status: 'ACTIVE' as const,
};

function makeProductsServiceStub() {
  return {
    list: vi.fn(async () => ({
      data: [{ ...SAMPLE_PRODUCT, id: 'p2', slug: 'sonic-headphones', name: 'Sonic' }],
      meta: { page: 1, pageSize: 5, total: 1 },
    })),
    getBySlug: vi.fn(async () => SAMPLE_PRODUCT),
  };
}

/**
 * Build the SSR `routeMeta.load` payload that `injectLoad<typeof load>()`
 * resolves to in production. The component's `loaded` signal subscribes to
 * `ActivatedRoute.data` and projects `data['load']`; the test provides the
 * payload synchronously via the `ActivatedRoute` stub below.
 */
function buildLoadPayload(
  opts: {
    reviewsTotal?: number;
    reviewSeed?: Array<{
      id: string;
      productId: string;
      rating: number;
      body: string;
      authorName: string;
      createdAt: string;
      status: 'PENDING' | 'PUBLISHED' | 'HIDDEN';
      helpfulCount: number;
      userId?: string;
    }>;
  } = {},
) {
  const reviews = opts.reviewSeed ?? [
    {
      id: 'r1',
      productId: 'p1',
      rating: 5,
      body: 'Best earbuds.',
      authorName: 'Ahmad',
      createdAt: '2026-04-01T00:00:00Z',
      status: 'PUBLISHED' as const,
      helpfulCount: 0,
    },
  ];
  const questions = [
    {
      id: 'q1',
      productId: 'p1',
      question: 'Wireless charging?',
      status: 'PUBLISHED' as const,
      // The real wire shape: one flat answer column plus its admin marker.
      answer: null,
      isAdminAnswer: false,
      questionLocale: null,
      asker: { firstName: 'Amel', lastName: 'Ben Salah' },
      createdAt: '2026-04-01T00:00:00Z',
      helpfulCount: 0,
    },
  ];
  return {
    product: SAMPLE_PRODUCT,
    reviewSummary: { averageRating: 4.6, total: opts.reviewsTotal ?? 23 },
    firstReviews: reviews,
    questions,
    related: [] as Array<{ id: string; slug: string; name: string }>,
  };
}

function makeReviewsServiceStub(
  opts: {
    total?: number;
    own?: Record<string, unknown> | null;
    eligibility?: { eligible: boolean; reason: string | null };
    seed?: Array<{
      id: string;
      productId: string;
      rating: number;
      body: string;
      authorName: string;
      createdAt: string;
      status: 'PENDING' | 'PUBLISHED' | 'HIDDEN';
      helpfulCount: number;
      userId?: string;
    }>;
  } = {},
) {
  const data = opts.seed ?? [
    {
      id: 'r1',
      productId: 'p1',
      rating: 5,
      body: 'Best earbuds.',
      authorName: 'Ahmad',
      createdAt: '2026-04-01T00:00:00Z',
      status: 'PUBLISHED' as const,
      helpfulCount: 0,
    },
  ];
  return {
    list: vi.fn(async () => ({
      data,
      meta: { page: 1, pageSize: 3, total: data.length },
    })),
    summary: vi.fn(async () => ({ averageRating: 4.6, total: opts.total ?? 23 })),
    create: vi.fn(async (slug: string, body: { rating: number }) => ({
      id: 'r-new',
      productId: 'p1',
      rating: body.rating,
      body: 'Newly created review',
      authorName: 'Self',
      createdAt: '2026-04-10T00:00:00Z',
      status: 'PENDING' as const,
      helpfulCount: 0,
      userId: 'u-self',
    })),
    update: vi.fn(async (id: string, body: { body?: string }) => ({
      id,
      productId: 'p1',
      rating: 5,
      body: body.body ?? 'Updated',
      authorName: 'Self',
      createdAt: '2026-04-01T00:00:00Z',
      status: 'PENDING' as const,
      helpfulCount: 0,
      userId: 'u-self',
    })),
    delete: vi.fn(async () => undefined),
    toggleHelpful: vi.fn(async () => ({ helpful: true })),
    mine: vi.fn(async () => opts.own ?? null),
    eligibility: vi.fn(async () => opts.eligibility ?? { eligible: true, reason: null }),
  };
}

function makeQuestionsServiceStub() {
  return {
    list: vi.fn(async () => ({
      data: [
        {
          id: 'q1',
          productId: 'p1',
          question: 'Wireless charging?',
          status: 'PUBLISHED' as const,
          answer: null,
          isAdminAnswer: false,
          questionLocale: null,
          asker: { firstName: 'Amel', lastName: 'Ben Salah' },
          createdAt: '2026-04-01T00:00:00Z',
          helpfulCount: 0,
        },
      ],
      meta: { page: 1, pageSize: 3, total: 1 },
    })),
    create: vi.fn(async (slug: string, body: { question: string }) => ({
      id: 'q-new',
      productId: 'p1',
      question: body.question,
      status: 'PENDING' as const,
      answer: null,
      isAdminAnswer: false,
      createdAt: '2026-04-10T00:00:00Z',
      helpfulCount: 0,
    })),
    // The endpoint returns the updated question row, not an answer record.
    answer: vi.fn(async (questionId: string, body: { answer: string }) => ({
      id: questionId,
      productId: 'p1',
      question: 'Wireless charging?',
      status: 'PUBLISHED' as const,
      answer: body.answer,
      isAdminAnswer: false,
      questionLocale: null,
      asker: { firstName: 'Amel', lastName: 'Ben Salah' },
      createdAt: '2026-04-01T00:00:00Z',
      helpfulCount: 0,
    })),
    toggleHelpful: vi.fn(async () => ({ helpful: true })),
  };
}

function makeCartServiceStub() {
  return {
    itemCount: signal(0),
    addItem: vi.fn(async () => ({ items: [{ quantity: 1 }] })),
    get: vi.fn(),
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
}

async function renderPage(opts: {
  locale: Locale;
  reviewsTotal?: number;
  loadQuestionsOverride?: Array<Record<string, unknown>>;
  authedUser?: { id: string; firstName?: string };
  reviewsServiceOverride?: ReturnType<typeof makeReviewsServiceStub>;
  questionsServiceOverride?: ReturnType<typeof makeQuestionsServiceStub>;
  cartServiceOverride?: ReturnType<typeof makeCartServiceStub>;
  reviewSeed?: Array<{
    id: string;
    productId: string;
    rating: number;
    body: string;
    authorName: string;
    createdAt: string;
    status: 'PENDING' | 'PUBLISHED' | 'HIDDEN';
    helpfulCount: number;
    userId?: string;
  }>;
}): Promise<ComponentFixture<ProductDetailPage>> {
  TestBed.overrideComponent(ProductDetailPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  const reviewsService =
    opts.reviewsServiceOverride ??
    makeReviewsServiceStub({ total: opts.reviewsTotal, seed: opts.reviewSeed });
  const questionsService = opts.questionsServiceOverride ?? makeQuestionsServiceStub();
  const noopApi: ApiClient = {
    get: async () => ({}) as never,
    post: async () => ({}) as never,
    patch: async () => ({}) as never,
    delete: async () => ({}) as never,
    request: async () => ({}) as never,
  };
  // SH2 — mirror Analog's `injectLoad` shape: the component reads the SSR
  // payload via `injectLoad<typeof load>()` which projects `route.data['load']`.
  // Provide it synchronously through the ActivatedRoute stub so the seeded
  // signals receive the payload at field-initializer time.
  const loadPayload = buildLoadPayload({
    reviewsTotal: opts.reviewsTotal,
    reviewSeed: opts.reviewSeed,
  });
  // Match the active firstReviews seed from the reviews service stub so the
  // initial signal seed and the post-mutation refetch land on consistent data.
  const seededFirstReviews = opts.reviewSeed ?? [
    {
      id: 'r1',
      productId: 'p1',
      rating: 5,
      body: 'Best earbuds.',
      authorName: 'Ahmad',
      createdAt: '2026-04-01T00:00:00Z',
      status: 'PUBLISHED' as const,
      helpfulCount: 0,
    },
  ];
  loadPayload.firstReviews = seededFirstReviews;
  if (opts.loadQuestionsOverride) {
    loadPayload.questions = opts.loadQuestionsOverride as never;
  }
  TestBed.configureTestingModule({
    providers: [
      // The scenario config these specs assert their hreflang and money against.
      provideFixtureStoreConfig('maghreb-ltr'),
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(opts.locale) },
      { provide: ProductsService, useValue: makeProductsServiceStub() },
      { provide: ReviewsService, useValue: reviewsService },
      { provide: QuestionsService, useValue: questionsService },
      { provide: CartService, useValue: opts.cartServiceOverride ?? makeCartServiceStub() },
      // The product-summary CTA row mounts a wishlist-toggle whose state
      // service indirectly resolves STOREFRONT_API_CLIENT. Provide a noop
      // API so the toggle's WishlistService injection succeeds.
      { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ slug: 'echo-buds-pro' }),
            queryParamMap: convertToParamMap({}),
            data: { load: loadPayload },
          },
          paramMap: of(convertToParamMap({ slug: 'echo-buds-pro' })),
          queryParamMap: of(convertToParamMap({})),
          data: of({ load: loadPayload }),
        },
      },
    ],
  });
  if (opts.authedUser) {
    TestBed.inject(AuthStateService).setSession({
      user: {
        id: opts.authedUser.id,
        email: 'self@example.com',
        firstName: opts.authedUser.firstName ?? 'Self',
      } as never,
    });
  }
  const fixture = TestBed.createComponent(ProductDetailPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const AXE_OPTS: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  rules: {
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'page-has-heading-one': { enabled: false },
  },
};

describe('ProductDetailPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the product detail container with breadcrumb, gallery, summary', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="product-detail-page"]')).not.toBeNull();
    expect(root.querySelector('app-breadcrumb')).not.toBeNull();
    expect(root.querySelector('product-gallery')).not.toBeNull();
    expect(root.querySelector('product-summary')).not.toBeNull();
    expect(root.querySelector('h1')?.textContent).toContain('Echo Buds Pro');
  });

  it('emits BreadcrumbList + Product JSON-LD into the head', async () => {
    await renderPage({ locale: 'en' });
    const scripts = document.head.querySelectorAll(
      'script[type="application/ld+json"][data-product-jsonld]',
    );
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    const types = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? '{}')['@type']);
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('Product');
  });

  it('Product JSON-LD includes aggregateRating when reviewSummary.total > 0', async () => {
    await renderPage({ locale: 'en', reviewsTotal: 23 });
    const scripts = Array.from(
      document.head.querySelectorAll('script[type="application/ld+json"][data-product-jsonld]'),
    );
    const product = scripts
      .map((s) => JSON.parse(s.textContent ?? '{}'))
      .find((p) => p['@type'] === 'Product');
    expect(product?.aggregateRating?.['@type']).toBe('AggregateRating');
    expect(product?.aggregateRating?.reviewCount).toBe(23);
  });

  it('Product JSON-LD omits aggregateRating when reviewSummary.total === 0', async () => {
    await renderPage({ locale: 'en', reviewsTotal: 0 });
    const scripts = Array.from(
      document.head.querySelectorAll('script[type="application/ld+json"][data-product-jsonld]'),
    );
    const product = scripts
      .map((s) => JSON.parse(s.textContent ?? '{}'))
      .find((p) => p['@type'] === 'Product');
    expect(product?.aggregateRating).toBeUndefined();
  });

  it('applies title + canonical + hreflang for the active locale', async () => {
    await renderPage({ locale: 'en' });
    expect(document.title).toContain('Echo Buds Pro');
    expect(document.querySelector('link[rel="canonical"]')).not.toBeNull();
    const hreflangs = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]'),
    ).map((l) => l.getAttribute('hreflang'));
    expect(hreflangs.sort()).toEqual(
      [
        ...SEO_LOCALES.supportedLocales.map((l) => regionFromLocale(l, SEO_LOCALES)),
        'x-default',
      ].sort(),
    );
  });

  it('writes one og:locale:alternate tag per other locale', async () => {
    // The builder computed the alternates all along; the page never wrote them
    // to the head, so the product page advertised its own locale and nothing
    // else. Meta.updateTag manages a single node per selector, so a repeating
    // OG property needs its own clear-then-append pass.
    await renderPage({ locale: 'en' });
    const alternates = Array.from(
      document.querySelectorAll<HTMLMetaElement>('meta[property="og:locale:alternate"]'),
    ).map((m) => m.getAttribute('content'));
    expect(alternates).toEqual(ogLocaleAlternates('en', SEO_LOCALES.supportedLocales, SEO_LOCALES));
    expect(alternates).not.toContain(ogLocaleFromLocale('en', SEO_LOCALES));
    expect(alternates.length).toBeGreaterThan(0);
  });

  it('passes axe on the rendered detail page', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const result = await axe.run(fixture.nativeElement, AXE_OPTS);
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  it('shows the anonymous review + question sign-in CTA when not authed and threads ?from=', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="product-review-auth-cta"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="product-question-auth-cta"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="product-review-form-new"]')).toBeNull();
    expect(root.querySelector('[data-testid="product-question-form"]')).toBeNull();
    const reviewLink = root.querySelector(
      '[data-testid="product-review-signin-link"]',
    ) as HTMLAnchorElement;
    const expectedFrom = encodeURIComponent('/en/catalog/product/echo-buds-pro');
    expect(reviewLink.getAttribute('href')).toBe(`/en/auth/login?from=${expectedFrom}`);
  });

  it('renders the review + question forms when authed', async () => {
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self', firstName: 'Self' },
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="product-review-auth-cta"]')).toBeNull();
    expect(root.querySelector('[data-testid="product-review-form-new"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="product-question-form"]')).not.toBeNull();
  });

  it('submits a review, shows the pending banner, and clears the body field', async () => {
    const reviews = makeReviewsServiceStub();
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Excellent earbuds, daily use.';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(reviews.create).toHaveBeenCalledTimes(1);
    expect(reviews.summary).toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-review-pending-banner"]'),
    ).not.toBeNull();
    const refreshedBody = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement | null;
    expect(refreshedBody?.value ?? '').toBe('');
  });

  /**
   * B1 — backend now emits `REVIEW_VERIFIED_PURCHASE_REQUIRED` on review
   * submission without a delivered order. The storefront catch must map that
   * code to the localized `verifiedPurchaseRequired` message (FR + EN) rather
   * than the generic "try again" fallback. Three tests pin all three legs:
   * EN-specific copy, AR-specific copy, and the generic fallback for
   * unknown codes (regression guard so the switch never silently swallows
   * declared codes in the future).
   */
  it('replaces the review form with a reason and an orders link for an ineligible customer', async () => {
    // The form was offered to every signed-in visitor and gated only by the
    // 400 the server answered after they had written the whole review.
    const reviewsService = makeReviewsServiceStub({
      total: 0,
      seed: [],
      eligibility: { eligible: false, reason: 'VERIFIED_PURCHASE_REQUIRED' },
    });
    const fixture = await renderPage({
      locale: 'en',
      reviewsTotal: 0,
      reviewSeed: [],
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviewsService,
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(reviewsService.eligibility).toHaveBeenCalledWith('echo-buds-pro');
    expect(root.querySelector('[data-testid="product-review-form-new"]')).toBeNull();
    const reason = root.querySelector('[data-testid="product-review-ineligible"]');
    expect(reason?.textContent).toContain("You can only review a product you've purchased");
    expect(
      root.querySelector('[data-testid="product-review-orders-link"]')?.getAttribute('href'),
    ).toBe('/en/account/orders');
  });

  it('drops the create form without a redundant notice once a review exists', async () => {
    const own = {
      id: 'own-1',
      productId: 'p1',
      rating: 4,
      body: 'Already said my piece.',
      createdAt: '2026-04-05T00:00:00Z',
      status: 'PENDING' as const,
      helpfulCount: 0,
      userId: 'u-self',
    };
    const reviewsService = makeReviewsServiceStub({
      total: 0,
      seed: [],
      own,
      eligibility: { eligible: false, reason: 'ALREADY_REVIEWED' },
    });
    const fixture = await renderPage({
      locale: 'en',
      reviewsTotal: 0,
      reviewSeed: [],
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviewsService,
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="product-review-form-new"]')).toBeNull();
    // The slot below already says it, and it carries Edit and Delete.
    expect(root.querySelector('[data-testid="product-review-ineligible"]')).toBeNull();
    expect(root.querySelector('[data-testid="product-own-review"]')).not.toBeNull();
  });

  it('keeps the review form for an eligible customer', async () => {
    const fixture = await renderPage({
      locale: 'en',
      reviewsTotal: 0,
      reviewSeed: [],
      authedUser: { id: 'u-self' },
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="product-review-form-new"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="product-review-ineligible"]')).toBeNull();
  });

  it('never inflates the aggregate with a locally held pending review', async () => {
    // A lone pending review used to be counted into `total` client-side, so
    // the header advertised "0.0 out of 5, 1 reviews".
    const reviewsService = makeReviewsServiceStub({
      total: 0,
      seed: [],
      own: {
        id: 'own-1',
        productId: 'p1',
        rating: 4,
        body: 'Waiting on moderation.',
        createdAt: '2026-04-05T00:00:00Z',
        status: 'PENDING',
        helpfulCount: 0,
        userId: 'u-self',
      },
    });
    const fixture = await renderPage({
      locale: 'en',
      reviewsTotal: 0,
      reviewSeed: [],
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviewsService,
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('product-reviews-summary .header')).toBeNull();
    expect(root.querySelector('[data-testid="product-own-review"]')).not.toBeNull();
  });

  it('fetches the own review on boot so it survives a reload', async () => {
    const reviewsService = makeReviewsServiceStub({
      total: 0,
      seed: [],
      own: {
        id: 'own-1',
        productId: 'p1',
        rating: 4,
        body: 'Waiting on moderation.',
        createdAt: '2026-04-05T00:00:00Z',
        status: 'PENDING',
        helpfulCount: 0,
        userId: 'u-self',
      },
    });
    const fixture = await renderPage({
      locale: 'en',
      reviewsTotal: 0,
      reviewSeed: [],
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviewsService,
    });

    expect(reviewsService.mine).toHaveBeenCalledWith('echo-buds-pro');
    const slot = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="product-own-review"]',
    );
    expect(slot?.textContent).toContain('Waiting on moderation.');
  });

  it('does not fetch the own review for an anonymous visitor', async () => {
    const reviewsService = makeReviewsServiceStub({ total: 0, seed: [] });
    await renderPage({
      locale: 'en',
      reviewsTotal: 0,
      reviewSeed: [],
      reviewsServiceOverride: reviewsService,
    });

    expect(reviewsService.mine).not.toHaveBeenCalled();
  });

  it('renders the own review once, in the slot, when it is also published in the list', async () => {
    const own = {
      id: 'own-1',
      productId: 'p1',
      rating: 4,
      body: 'Published and mine.',
      createdAt: '2026-04-05T00:00:00Z',
      status: 'PUBLISHED' as const,
      helpfulCount: 0,
      userId: 'u-self',
    };
    const reviewsService = makeReviewsServiceStub({ total: 1, seed: [own as never], own });
    const fixture = await renderPage({
      locale: 'en',
      reviewsTotal: 1,
      reviewSeed: [own as never],
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviewsService,
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('[data-testid="product-review-edit-own-1"]').length).toBe(1);
    expect(root.querySelectorAll('[data-testid="product-reviews-list"] .review').length).toBe(0);
  });

  it('maps REVIEW_VERIFIED_PURCHASE_REQUIRED to the localized EN error string', async () => {
    const reviews = makeReviewsServiceStub();
    reviews.create = vi.fn(async () => {
      throw new StorefrontValidationError({
        code: 'REVIEW_VERIFIED_PURCHASE_REQUIRED',
        message: 'A verified purchase is required to leave a review',
      });
    });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Trying without verified purchase';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = root.querySelector(
      '[data-testid="product-review-form-error"]',
    ) as HTMLElement | null;
    expect(errEl, 'error region must render after a rejected review submit').not.toBeNull();
    expect(errEl?.textContent ?? '').toContain("You can only review a product you've purchased");
  });

  it('maps REVIEW_VERIFIED_PURCHASE_REQUIRED to the localized FR error string', async () => {
    const reviews = makeReviewsServiceStub();
    reviews.create = vi.fn(async () => {
      throw new StorefrontValidationError({
        code: 'REVIEW_VERIFIED_PURCHASE_REQUIRED',
        message: 'A verified purchase is required to leave a review',
      });
    });
    const fixture = await renderPage({
      locale: 'fr',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Tentative sans achat vérifié';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = root.querySelector(
      '[data-testid="product-review-form-error"]',
    ) as HTMLElement | null;
    expect(errEl, 'error region must render after a rejected review submit (fr)').not.toBeNull();
    expect(errEl?.textContent ?? '').toContain(
      'Vous ne pouvez évaluer qu’un produit que vous avez commandé et reçu.',
    );
  });

  /**
   * Full-stack audit B1 row #1 — backend emits `REVIEW_DUPLICATE` on a second
   * review attempt. The storefront catch must map that code to the localized
   * `duplicate` string in both FR + EN. The exception class is
   * `ConflictException` (409) so the typed error arrives as a
   * `StorefrontConflictError`, not a `StorefrontValidationError`.
   */
  it('maps REVIEW_DUPLICATE to the localized EN error string', async () => {
    const reviews = makeReviewsServiceStub();
    reviews.create = vi.fn(async () => {
      throw new StorefrontConflictError({
        code: 'REVIEW_DUPLICATE',
        message: 'You have already submitted a review for this product',
      });
    });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Trying to submit a second review';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = root.querySelector(
      '[data-testid="product-review-form-error"]',
    ) as HTMLElement | null;
    expect(errEl?.textContent ?? '').toContain("You've already shared a review for this product");
  });

  it('maps REVIEW_DUPLICATE to the localized FR error string', async () => {
    const reviews = makeReviewsServiceStub();
    reviews.create = vi.fn(async () => {
      throw new StorefrontConflictError({
        code: 'REVIEW_DUPLICATE',
        message: 'You have already submitted a review for this product',
      });
    });
    const fixture = await renderPage({
      locale: 'fr',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Tentative de second avis';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = root.querySelector(
      '[data-testid="product-review-form-error"]',
    ) as HTMLElement | null;
    expect(errEl?.textContent ?? '').toContain('Vous avez déjà publié un avis sur ce produit.');
  });

  /**
   * Full-stack audit B2 rows #13, #14, #15 — backend now emits
   * `REVIEW_PRODUCT_NOT_FOUND`, `ASSET_INVALID`, and `REVIEW_NOT_OWNED` on the
   * matching review-create / edit / delete failures. Three EN-tier assertions
   * pin the catch dispatch; per the B1 phase-log policy the bilingual i18n
   * keys plus the storefront-error-contract auditor's both-locales probe
   * substitute for per-spec AR coverage at this tier (Phase F locale-matrix
   * sweep extends the pair).
   */
  it('maps REVIEW_PRODUCT_NOT_FOUND to the localized EN error string', async () => {
    const reviews = makeReviewsServiceStub();
    reviews.create = vi.fn(async () => {
      throw new StorefrontNotFoundError({
        code: 'REVIEW_PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
    });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Submitting against a product that no longer exists';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = root.querySelector(
      '[data-testid="product-review-form-error"]',
    ) as HTMLElement | null;
    expect(errEl?.textContent ?? '').toContain('This product is no longer available');
  });

  it('maps ASSET_INVALID to the localized EN error string', async () => {
    const reviews = makeReviewsServiceStub();
    reviews.create = vi.fn(async () => {
      throw new StorefrontValidationError({
        code: 'ASSET_INVALID',
        message: 'One or more asset IDs are invalid',
      });
    });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Attached a phantom asset';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = root.querySelector(
      '[data-testid="product-review-form-error"]',
    ) as HTMLElement | null;
    expect(errEl?.textContent ?? '').toContain('One or more of the attached photos');
  });

  it('maps REVIEW_NOT_OWNED to the localized EN error string via the review-save dispatch', async () => {
    // The dispatch handler `reviewErrorMessageFor` is shared between create,
    // update, and delete catches; pinning it via the create path keeps the
    // test direct without rendering an edit dialog the page-shell doesn't
    // expose to unowned reviews. Backend e2e separately covers the
    // PATCH/DELETE 403 wire path.
    const reviews = makeReviewsServiceStub();
    reviews.create = vi.fn(async () => {
      throw new StorefrontForbiddenError({
        code: 'REVIEW_NOT_OWNED',
        message: 'Not your review',
      });
    });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Exercise the dispatch path';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = root.querySelector(
      '[data-testid="product-review-form-error"]',
    ) as HTMLElement | null;
    expect(errEl?.textContent ?? '').toContain('You can only edit or delete your own review');
  });

  it('falls back to the generic error string when the backend code is unknown', async () => {
    const reviews = makeReviewsServiceStub();
    reviews.create = vi.fn(async () => {
      throw new StorefrontValidationError({
        code: 'SOME_FUTURE_UNDECLARED_CODE',
        message: 'Future server-side rejection',
      });
    });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-form-rating-5"]') as HTMLButtonElement
    ).click();
    const body = root.querySelector(
      '[data-testid="product-review-form-body"]',
    ) as HTMLTextAreaElement;
    body.value = 'Triggers the unknown-code fallback path';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-review-form-new"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    const errEl = root.querySelector(
      '[data-testid="product-review-form-error"]',
    ) as HTMLElement | null;
    expect(errEl?.textContent ?? '').toContain('Could not post your review right now');
  });

  it('rolls helpful-toggle vote back when the API call rejects', async () => {
    const seed = [
      {
        id: 'r-peer',
        productId: 'p1',
        rating: 4,
        body: 'Peer view',
        authorName: 'Other',
        createdAt: '2026-04-01T00:00:00Z',
        status: 'PUBLISHED' as const,
        helpfulCount: 2,
        userId: 'u-other',
      },
    ];
    const reviews = makeReviewsServiceStub({ seed });
    reviews.toggleHelpful = vi.fn(async () => {
      throw new Error('500');
    });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
      reviewSeed: seed,
    });
    const root = fixture.nativeElement as HTMLElement;
    const btn = root.querySelector(
      '[data-testid="product-review-helpful-r-peer"]',
    ) as HTMLButtonElement;
    btn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(reviews.toggleHelpful).toHaveBeenCalledWith('r-peer');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the review when delete confirm is dismissed', async () => {
    const seed = [
      {
        id: 'r-mine',
        productId: 'p1',
        rating: 4,
        body: 'My take',
        authorName: 'Self',
        createdAt: '2026-04-01T00:00:00Z',
        status: 'PUBLISHED' as const,
        helpfulCount: 0,
        userId: 'u-self',
      },
    ];
    const reviews = makeReviewsServiceStub({ seed });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
      reviewSeed: seed,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-delete-r-mine"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="product-review-delete-confirm"]')).not.toBeNull();
    const no = root.querySelector(
      '[testId="product-review-delete-no"] button',
    ) as HTMLButtonElement;
    no.click();
    fixture.detectChanges();
    expect(reviews.delete).not.toHaveBeenCalled();
    expect(root.querySelector('[data-testid="product-review-delete-confirm"]')).toBeNull();
  });

  it('renders own-row controls + opens the inline edit form on edit click', async () => {
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewSeed: [
        {
          id: 'r-mine',
          productId: 'p1',
          rating: 4,
          body: 'My take',
          authorName: 'Self',
          createdAt: '2026-04-01T00:00:00Z',
          status: 'PUBLISHED',
          helpfulCount: 0,
          userId: 'u-self',
        },
      ],
    });
    const root = fixture.nativeElement as HTMLElement;
    const editBtn = root.querySelector(
      '[data-testid="product-review-edit-r-mine"]',
    ) as HTMLButtonElement;
    expect(editBtn).not.toBeNull();
    editBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="product-review-form-r-mine"]')).not.toBeNull();
  });

  it('opens the delete confirm + invokes ReviewsService.delete on confirm yes', async () => {
    const seed = [
      {
        id: 'r-mine',
        productId: 'p1',
        rating: 4,
        body: 'My take',
        authorName: 'Self',
        createdAt: '2026-04-01T00:00:00Z',
        status: 'PUBLISHED' as const,
        helpfulCount: 0,
        userId: 'u-self',
      },
    ];
    const reviews = makeReviewsServiceStub({ seed });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
      reviewSeed: seed,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-delete-r-mine"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="product-review-delete-confirm"]')).not.toBeNull();
    const yes = root.querySelector(
      '[testId="product-review-delete-yes"] button',
    ) as HTMLButtonElement;
    expect(yes).not.toBeNull();
    yes.click();
    await fixture.whenStable();
    expect(reviews.delete).toHaveBeenCalledWith('r-mine');
  });

  it('toggles helpful on a peer review and calls the service', async () => {
    const seed = [
      {
        id: 'r-peer',
        productId: 'p1',
        rating: 4,
        body: 'Peer view',
        authorName: 'Other',
        createdAt: '2026-04-01T00:00:00Z',
        status: 'PUBLISHED' as const,
        helpfulCount: 1,
        userId: 'u-other',
      },
    ];
    const reviews = makeReviewsServiceStub({ seed });
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      reviewsServiceOverride: reviews,
      reviewSeed: seed,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-review-helpful-r-peer"]') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(reviews.toggleHelpful).toHaveBeenCalledWith('r-peer');
  });

  it('submits a question and shows the pending banner', async () => {
    const questions = makeQuestionsServiceStub();
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      questionsServiceOverride: questions,
    });
    const root = fixture.nativeElement as HTMLElement;
    const ta = root.querySelector(
      '[data-testid="product-question-form-question"]',
    ) as HTMLTextAreaElement;
    ta.value = 'Does it ship to QA?';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('[data-testid="product-question-form"]') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(questions.create).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-testid="product-question-pending-banner"]')).not.toBeNull();
  });

  it('widens the review window on show-more and renders every row it gets back', async () => {
    const seeded = [
      {
        id: 'r1',
        productId: 'p1',
        rating: 5,
        body: 'Best earbuds.',
        authorName: 'Ahmad',
        createdAt: '2026-04-01T00:00:00Z',
        status: 'PUBLISHED' as const,
        helpfulCount: 0,
      },
    ];
    const wider = Array.from({ length: 6 }, (_, i) => ({
      ...seeded[0],
      id: `r${i + 1}`,
      body: `Review ${i + 1}`,
    }));
    const reviewsService = makeReviewsServiceStub({ total: 6, seed: seeded });
    reviewsService.list = vi.fn(async (_slug: string, query: { pageSize?: number }) => ({
      data: (query.pageSize ?? 3) > 3 ? wider : seeded,
      meta: { page: 1, pageSize: query.pageSize ?? 3, total: 6 },
    })) as never;

    const fixture = await renderPage({
      locale: 'en',
      reviewsTotal: 6,
      reviewSeed: seeded,
      reviewsServiceOverride: reviewsService,
    });
    const root = fixture.nativeElement as HTMLElement;

    // The list used to be capped at four rows behind a dead anchor.
    const showMore = root.querySelector(
      '[data-testid="product-reviews-show-more"]',
    ) as HTMLButtonElement;
    expect(showMore).not.toBeNull();
    expect(root.querySelectorAll('[data-testid="product-reviews-list"] .review').length).toBe(1);

    showMore.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(reviewsService.list).toHaveBeenCalledWith(
      'echo-buds-pro',
      expect.objectContaining({ pageSize: 13 }),
    );
    expect(root.querySelectorAll('[data-testid="product-reviews-list"] .review').length).toBe(6);
    // Every published row is on screen, so the control retires.
    expect(root.querySelector('[data-testid="product-reviews-show-more"]')).toBeNull();
  });

  it('no control on the product page points at a bare fragment', async () => {
    const fixture = await renderPage({ locale: 'en' });
    const hrefs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('a[href]'),
    ).map((a) => a.getAttribute('href') ?? '');
    // `href="#reviews"` resolved against <base href="/"> and navigated home.
    expect(hrefs.filter((h) => h.startsWith('#'))).toEqual([]);
  });

  it('renders the stored answer the questions payload has always carried', async () => {
    const questions = makeQuestionsServiceStub();
    questions.list = vi.fn(async () => ({
      data: [
        {
          id: 'q1',
          productId: 'p1',
          question: 'Wireless charging?',
          status: 'PUBLISHED' as const,
          answer: 'Yes, Qi.',
          isAdminAnswer: true,
          questionLocale: null,
          asker: { firstName: 'Amel', lastName: 'Ben Salah' },
          createdAt: '2026-04-01T00:00:00Z',
          helpfulCount: 0,
        },
      ],
      meta: { page: 1, pageSize: 3, total: 1 },
    })) as never;
    const fixture = await renderPage({
      locale: 'en',
      questionsServiceOverride: questions,
      loadQuestionsOverride: [
        {
          id: 'q1',
          productId: 'p1',
          question: 'Wireless charging?',
          status: 'PUBLISHED' as const,
          answer: 'Yes, Qi.',
          isAdminAnswer: true,
          questionLocale: null,
          asker: { firstName: 'Amel', lastName: 'Ben Salah' },
          createdAt: '2026-04-01T00:00:00Z',
          helpfulCount: 0,
        },
      ],
    });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="product-question-answer-q1"]')?.textContent).toContain(
      'Yes, Qi.',
    );
    // An admin answer is attributed to the store, not to a bare user id.
    expect(
      root.querySelector('[data-testid="product-question-answer-badge-q1"]')?.textContent,
    ).toContain('Store team');
    expect(root.querySelector('[data-testid="product-question-asker-q1"]')?.textContent).toContain(
      'Amel Ben Salah',
    );
  });

  it('replaces the question row with the answered one the endpoint returns', async () => {
    const questions = makeQuestionsServiceStub();
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      questionsServiceOverride: questions,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-question-answer-toggle-q1"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const ta = root.querySelector(
      '[data-testid="product-question-answer-input-q1"]',
    ) as HTMLTextAreaElement;
    ta.value = 'About 6 hours per charge.';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-question-answer-form-q1"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('[data-testid="product-question-answer-q1"]')?.textContent).toContain(
      'About 6 hours per charge.',
    );
    // ...and the control that would overwrite it is gone.
    expect(root.querySelector('[data-testid="product-question-answer-toggle-q1"]')).toBeNull();
  });

  it('submits an answer and appends it to the question row', async () => {
    const questions = makeQuestionsServiceStub();
    const fixture = await renderPage({
      locale: 'en',
      authedUser: { id: 'u-self' },
      questionsServiceOverride: questions,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-question-answer-toggle-q1"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const ta = root.querySelector(
      '[data-testid="product-question-answer-input-q1"]',
    ) as HTMLTextAreaElement;
    ta.value = 'About 6 hours per charge.';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-question-answer-form-q1"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(questions.answer).toHaveBeenCalledWith('q1', { answer: 'About 6 hours per charge.' });
  });

  /**
   * Full-stack audit B1 row #2 — backend emits
   * `QUESTION_NOT_AVAILABLE_FOR_ANSWER` (400) when answering a HIDDEN
   * question. The storefront catch must map that code to the localized
   * `notAvailable` string in both FR + EN rather than the generic
   * "try again" fallback. Three legs: EN, AR, and the generic fallback
   * regression guard for unknown codes.
   */
  async function submitAnswerWithError(
    locale: Locale,
    error: StorefrontValidationError | StorefrontConflictError,
  ): Promise<HTMLElement | null> {
    const questions = makeQuestionsServiceStub();
    questions.answer = vi.fn(async () => {
      throw error;
    });
    const fixture = await renderPage({
      locale,
      authedUser: { id: 'u-self' },
      questionsServiceOverride: questions,
    });
    const root = fixture.nativeElement as HTMLElement;
    (
      root.querySelector('[data-testid="product-question-answer-toggle-q1"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const ta = root.querySelector(
      '[data-testid="product-question-answer-input-q1"]',
    ) as HTMLTextAreaElement;
    ta.value = 'Attempting an answer on a hidden question';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      root.querySelector('[data-testid="product-question-answer-form-q1"]') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    return root.querySelector(
      '[data-testid="product-question-answer-error-q1"]',
    ) as HTMLElement | null;
  }

  it('maps QUESTION_NOT_AVAILABLE_FOR_ANSWER to the localized EN error string', async () => {
    const errEl = await submitAnswerWithError(
      'en',
      new StorefrontValidationError({
        code: 'QUESTION_NOT_AVAILABLE_FOR_ANSWER',
        message: 'This question is not available for answers',
      }),
    );
    expect(errEl?.textContent ?? '').toContain('This question is closed for new answers');
  });

  it('maps QUESTION_NOT_AVAILABLE_FOR_ANSWER to the localized FR error string', async () => {
    const errEl = await submitAnswerWithError(
      'fr',
      new StorefrontValidationError({
        code: 'QUESTION_NOT_AVAILABLE_FOR_ANSWER',
        message: 'This question is not available for answers',
      }),
    );
    expect(errEl?.textContent ?? '').toContain(
      'Cette question n’accepte plus de nouvelles réponses.',
    );
  });

  it('falls back to the generic answer error string on unknown codes', async () => {
    const errEl = await submitAnswerWithError(
      'en',
      new StorefrontValidationError({
        code: 'SOME_FUTURE_UNDECLARED_CODE',
        message: 'Future server-side answer rejection',
      }),
    );
    expect(errEl?.textContent ?? '').toContain('Could not post your answer right now');
  });

  it('maps QUESTION_ALREADY_ANSWERED to the localized EN error string', async () => {
    const errEl = await submitAnswerWithError(
      'en',
      new StorefrontConflictError({
        code: 'QUESTION_ALREADY_ANSWERED',
        message: 'This question has already been answered',
      }),
    );
    expect(errEl?.textContent ?? '').toContain('This question already has an answer');
  });

  it('maps QUESTION_ALREADY_ANSWERED to the localized FR error string', async () => {
    const errEl = await submitAnswerWithError(
      'fr',
      new StorefrontConflictError({
        code: 'QUESTION_ALREADY_ANSWERED',
        message: 'This question has already been answered',
      }),
    );
    expect(errEl?.textContent ?? '').toContain('Cette question a déjà une réponse');
  });

  /**
   * B2b — `questionRows` crashed in production on a question payload that
   * omitted its answers. The relation it guarded against never existed: the
   * model carries one flat `answer` column, and the phantom `answers` array
   * the schema used to declare is gone. The pin stays, retargeted at the real
   * field: a server-rendered seed value that bypasses `questionSchema` still
   * arrives without it, and the row must render regardless.
   */
  it('renders the questions list without throwing when a question payload omits its answer (B2b)', async () => {
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const inlineQuestionsService = makeQuestionsServiceStub();
      const loadPayload = {
        product: SAMPLE_PRODUCT,
        reviewSummary: { averageRating: 0, total: 0 },
        firstReviews: [] as Array<unknown>,
        questions: [
          {
            id: 'q1',
            productId: 'p1',
            question: 'Wireless charging?',
            status: 'PUBLISHED' as const,
            // Simulate a backend payload that omits the answer column.
            // Production tripped the old `.map` on this exact shape on
            // a production storefront, 2026-05-14.
            answer: undefined as unknown as string,
            createdAt: '2026-04-01T00:00:00Z',
            helpfulCount: 0,
          },
        ],
        related: [] as Array<unknown>,
      };
      const inlineNoopApi: ApiClient = {
        get: async () => ({}) as never,
        post: async () => ({}) as never,
        patch: async () => ({}) as never,
        delete: async () => ({}) as never,
        request: async () => ({}) as never,
      };
      TestBed.overrideComponent(ProductDetailPage, {
        set: { changeDetection: ChangeDetectionStrategy.Default },
      });
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: LocaleService, useValue: new StubLocaleService('en') },
          { provide: ProductsService, useValue: makeProductsServiceStub() },
          { provide: ReviewsService, useValue: makeReviewsServiceStub() },
          { provide: QuestionsService, useValue: inlineQuestionsService },
          { provide: CartService, useValue: makeCartServiceStub() },
          { provide: STOREFRONT_API_CLIENT, useValue: inlineNoopApi },
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                paramMap: convertToParamMap({ slug: 'echo-buds-pro' }),
                queryParamMap: convertToParamMap({}),
                data: { load: loadPayload },
              },
              paramMap: of(convertToParamMap({ slug: 'echo-buds-pro' })),
              queryParamMap: of(convertToParamMap({})),
              data: of({ load: loadPayload }),
            },
          },
        ],
      });

      const fixture = TestBed.createComponent(ProductDetailPage);
      expect(() => fixture.detectChanges()).not.toThrow();
      await fixture.whenStable();
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(
        root.querySelector('[data-testid="product-questions-list"]'),
        'questions list section must still render even when answers is undefined',
      ).not.toBeNull();
    } finally {
      console.error = originalError;
    }

    // Angular routes template-binding errors through ErrorHandler, which by
    // default writes to console.error. Filter for the specific TypeError
    // shape — the test is precise about which class of error it asserts
    // against, so unrelated console noise does not flake it.
    const templateErrors = errors
      .flat()
      .filter((entry) => /Cannot read properties of undefined.*map/i.test(String(entry)));
    expect(
      templateErrors,
      'questionRows template binding must not throw on missing answers relation',
    ).toEqual([]);
  });

  /**
   * Full-stack audit B1 rows #3-4 — backend now emits typed cart codes on
   * variant-not-found and insufficient-stock add-to-cart attempts. The PDP
   * surfaces the localized error string through the new `addErrorMessage`
   * signal binding on `product-summary`. Three tests pin EN variant-not-found,
   * EN insufficient-stock, and AR insufficient-stock for the AR-leg sanity.
   */
  async function clickAddToCartWithError(
    locale: Locale,
    error: StorefrontError,
  ): Promise<HTMLElement | null> {
    const cart = makeCartServiceStub();
    cart.addItem = vi.fn(async () => {
      throw error;
    });
    const fixture = await renderPage({
      locale,
      cartServiceOverride: cart,
    });
    const root = fixture.nativeElement as HTMLElement;
    const btn = root.querySelector(
      '[data-testid="product-add-to-cart"]',
    ) as HTMLButtonElement | null;
    expect(btn, 'add-to-cart button must mount on the PDP test render').not.toBeNull();
    btn?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    return root.querySelector('[data-testid="product-add-to-cart-error"]') as HTMLElement | null;
  }

  /**
   * Finding P4. The page hardcoded `quantity: 1`, so the number the shopper
   * picked in the buy box never reached the cart endpoint at all.
   */
  it('forwards the quantity the buy box chose to POST /v1/cart/items', async () => {
    const cart = makeCartServiceStub();
    const fixture = await renderPage({ locale: 'en', cartServiceOverride: cart });
    const root = fixture.nativeElement as HTMLElement;

    const increment = root.querySelector('app-stepper .increment') as HTMLButtonElement | null;
    expect(increment, 'the buy box must offer a quantity stepper').not.toBeNull();
    // One render between clicks: the stepper is controlled, so it reads the
    // value the owner echoed back rather than what it last emitted.
    increment!.click();
    fixture.detectChanges();
    increment!.click();
    fixture.detectChanges();

    (root.querySelector('[data-testid="product-add-to-cart"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(cart.addItem).toHaveBeenCalledTimes(1);
    expect(cart.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 3 }) as unknown as never,
    );
  });

  it('maps CART_VARIANT_NOT_FOUND to the localized EN error string on add', async () => {
    const errEl = await clickAddToCartWithError(
      'en',
      new StorefrontNotFoundError({
        code: 'CART_VARIANT_NOT_FOUND',
        message: 'Product variant not found or unavailable',
      }),
    );
    expect(errEl?.textContent ?? '').toContain('This product is no longer available');
  });

  it('maps CART_INSUFFICIENT_STOCK to the localized EN error string on add', async () => {
    const errEl = await clickAddToCartWithError(
      'en',
      new StorefrontValidationError({
        code: 'CART_INSUFFICIENT_STOCK',
        message: 'Insufficient stock for the requested quantity',
      }),
    );
    expect(errEl?.textContent ?? '').toContain('Not enough stock available');
  });

  it('maps CART_INSUFFICIENT_STOCK to the localized FR error string on add', async () => {
    const errEl = await clickAddToCartWithError(
      'fr',
      new StorefrontValidationError({
        code: 'CART_INSUFFICIENT_STOCK',
        message: 'Insufficient stock for the requested quantity',
      }),
    );
    expect(errEl?.textContent ?? '').toContain('Stock insuffisant pour cette quantité.');
  });
});

/**
 * Finding N5. Analog forces `runGuardsAndResolvers: 'paramsOrQueryParamsChange'`
 * on every file route, so a sibling-slug navigation (the header search
 * suggestions do exactly this) re-runs the loader and a fresh payload arrives.
 * Every rendered signal on this page was a one-time copy taken at
 * field-initialiser time, and meta plus JSON-LD applied once in `ngOnInit`, so
 * the whole payload was silently dropped: URL changed, page did not.
 */
describe('ProductDetailPage sibling-slug re-hydration (finding N5)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  const SECOND_PRODUCT = {
    ...SAMPLE_PRODUCT,
    id: 'p2',
    slug: 'sonic-headphones',
    name: 'Sonic Headphones',
    description: 'Over-ear headphones.',
  };

  async function renderLive() {
    TestBed.overrideComponent(ProductDetailPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    const first = buildLoadPayload();
    const data$ = new BehaviorSubject<{ load: ReturnType<typeof buildLoadPayload> }>({
      load: first,
    });
    const snapshot = {
      paramMap: convertToParamMap({ slug: 'echo-buds-pro' }),
      queryParamMap: convertToParamMap({}),
      data: { load: first },
    };
    const noopApi: ApiClient = {
      get: async () => ({}) as never,
      post: async () => ({}) as never,
      patch: async () => ({}) as never,
      delete: async () => ({}) as never,
      request: async () => ({}) as never,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService('en') },
        { provide: ProductsService, useValue: makeProductsServiceStub() },
        { provide: ReviewsService, useValue: makeReviewsServiceStub({}) },
        { provide: QuestionsService, useValue: makeQuestionsServiceStub() },
        { provide: CartService, useValue: makeCartServiceStub() },
        { provide: STOREFRONT_API_CLIENT, useValue: noopApi },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot,
            paramMap: of(convertToParamMap({ slug: 'echo-buds-pro' })),
            queryParamMap: of(convertToParamMap({})),
            data: data$,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ProductDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const push = async (payload: ReturnType<typeof buildLoadPayload>) => {
      snapshot.paramMap = convertToParamMap({ slug: payload.product.slug });
      snapshot.data = { load: payload };
      data$.next({ load: payload });
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, push };
  }

  function secondPayload() {
    const payload = buildLoadPayload();
    payload.product = { ...payload.product, ...SECOND_PRODUCT } as never;
    payload.related = [];
    return payload;
  }

  function heading(fixture: ComponentFixture<ProductDetailPage>): string {
    return (
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="product-summary"] h1.title')
        ?.textContent?.trim() ?? ''
    );
  }

  it('renders the new product when the loader re-emits for a sibling slug', async () => {
    const { fixture, push } = await renderLive();
    expect(heading(fixture)).toBe('Echo Buds Pro');

    await push(secondPayload());

    expect(heading(fixture)).toBe('Sonic Headphones');
  });

  it('re-applies the document title and canonical for the new product', async () => {
    const { push } = await renderLive();
    await push(secondPayload());

    expect(document.title).toContain('Sonic Headphones');
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toContain('sonic-headphones');
  });

  it('re-emits JSON-LD for the new product', async () => {
    const { push } = await renderLive();
    await push(secondPayload());

    const scripts = Array.from(
      document.head.querySelectorAll('script[type="application/ld+json"]'),
    ).map((el) => el.textContent ?? '');
    expect(scripts.some((raw) => raw.includes('sonic-headphones'))).toBe(true);
    expect(scripts.some((raw) => raw.includes('echo-buds-pro'))).toBe(false);
  });

  it('resets per-product transient state so it cannot leak across products', async () => {
    const { fixture, push } = await renderLive();
    const component = fixture.componentInstance as unknown as {
      addState: { set(v: string): void; (): string };
      addErrorMessage: { set(v: string | null): void; (): string | null };
      editingReviewId: { set(v: string | null): void; (): string | null };
      deleteTarget: { set(v: string | null): void; (): string | null };
      votedReviewIds: { set(v: Set<string>): void; (): Set<string> };
    };
    component.addState.set('error');
    component.addErrorMessage.set('out of stock');
    component.editingReviewId.set('r1');
    component.deleteTarget.set('r1');
    component.votedReviewIds.set(new Set(['r1']));

    await push(secondPayload());

    expect(component.addState()).toBe('idle');
    expect(component.addErrorMessage()).toBeNull();
    expect(component.editingReviewId()).toBeNull();
    expect(component.deleteTarget()).toBeNull();
    expect(component.votedReviewIds().size).toBe(0);
  });
});
