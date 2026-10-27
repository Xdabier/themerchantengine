import { A11yModule } from '@angular/cdk/a11y';
import { DOCUMENT, isPlatformBrowser, isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { injectLoad } from '@analogjs/router';

import type { load } from './[slug].server';

import { CartService, QuestionsService, ReviewsService } from '@storefront-services';
import type {
  AnswerQuestionRequest,
  ProductDetail,
  ProductFaq,
  ProductSpec,
  ProductSummary,
  Question,
  RatingSummary,
  Review,
} from '@storefront-types';
import { pickTranslation, type ResolvedString, type ReviewEligibility } from '@storefront-types';

import { LocaleService } from '../../../../locale.service';
import { APP_ROUTES } from '../../../../../lib/routes';
import { pictureSourcesFromAssetVariants } from '../../../../../lib/asset-variant';
import { noImageFallback } from '../../../../../lib/no-image';
import { productAvailability, variantAvailability } from '../../../../../lib/availability';
import { AuthStateService } from '../../../../services/auth-state.service';
import { ToastService } from '../../../../ui/toast.component';
import { ButtonComponent } from '../../../../ui/button.component';
import {
  breadcrumbListJsonLd,
  faqPageJsonLd,
  pageTitle,
  productJsonLd,
  productMetaTags,
  serializeJsonLd,
} from '../../../../../lib/seo';
import { upsertPropertyMulti } from '../../../../../lib/meta-dom';
import { BreadcrumbComponent, type BreadcrumbItem } from '../../../../ui/breadcrumb.component';
import {
  ProductGalleryComponent,
  type GalleryImage,
} from '../../../../sections/product/product-gallery.component';
import {
  ProductSummaryComponent,
  type AddToCartRequest,
  type AddToCartState,
  type ProductSummaryInput,
  type ProductVariantOption,
} from '../../../../sections/product/product-summary.component';
import {
  ReviewsSummaryComponent,
  type ReviewsSummaryInput,
  type ReviewsSummaryRow,
} from '../../../../sections/product/reviews-summary.component';
import {
  QuestionsListComponent,
  type QuestionAnswerRow,
  type QuestionRow,
} from '../../../../sections/product/questions-list.component';
import {
  ReviewFormComponent,
  type ReviewFormSubmit,
} from '../../../../sections/product/review-form.component';
import {
  QuestionFormComponent,
  type QuestionFormSubmit,
} from '../../../../sections/product/question-form.component';
import { RelatedProductsComponent } from '../../../../sections/product/related-products.component';
import { ProductFaqsComponent } from '../../../../sections/product/product-faqs.component';
import { ProductSpecsComponent } from '../../../../sections/product/product-specs.component';
import type { ProductCardData } from '../../../../ui/product-card.component';
import { moneyFractionDigits } from '../../../../../lib/money';
import { reviewAuthorName } from '../../../../../lib/review-author';
import { StoreConfigService } from '../../../../services/store-config.service';
import { AnalyticsTrackerService } from '../../../../services/analytics-tracker.service';

const RELATED_PAGE_SIZE = 4;
/** Rows the SSR loader seeds per list, mirrored from `[slug].server.ts`. */
const PAGE_SIZE_SEED = 3;
/** Rows each "Show more" adds. */
const PAGE_SIZE_STEP = 10;
/** The API caps a page at 100. */
const PAGE_SIZE_MAX = 100;

@Component({
  selector: 'app-product-detail-page',
  standalone: true,
  imports: [
    A11yModule,
    BreadcrumbComponent,
    ProductGalleryComponent,
    ProductSummaryComponent,
    ReviewsSummaryComponent,
    QuestionsListComponent,
    ReviewFormComponent,
    QuestionFormComponent,
    ButtonComponent,
    RelatedProductsComponent,
    ProductFaqsComponent,
    ProductSpecsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="product-detail-page">
      <app-breadcrumb [items]="breadcrumb()" [ariaLabel]="strings().catalog.breadcrumb.navLabel" />

      <div class="hero">
        <product-gallery [images]="galleryImages()" />
        <product-summary
          [input]="summaryInput()"
          [addState]="addState()"
          [addErrorMessage]="addErrorMessage()"
          (addToCart)="onAddToCart($event)"
        />
      </div>

      <product-specs [specs]="specs()" [idSuffix]="product().slug" />

      <product-faqs [faqs]="faqs()" />

      <div class="reviews-block">
        @if (authed()) {
          @if (reviewSubmissionPending()) {
            <p
              class="pending-banner"
              role="status"
              aria-live="polite"
              data-testid="product-review-pending-banner"
            >
              {{ strings().product.reviews.pending }}
            </p>
          }
          @if (reviewIneligibilityReason(); as reason) {
            <div class="review-ineligible" data-testid="product-review-ineligible">
              <p>{{ reason }}</p>
              <a class="link-cta" [href]="ordersHref()" data-testid="product-review-orders-link">
                {{ strings().product.reviews.viewOrders }}
              </a>
            </div>
          }
          @if (canWriteReview() && !editingReviewId()) {
            <product-review-form
              #reviewForm
              mode="create"
              [saving]="reviewSaving()"
              [externalError]="reviewError()"
              (submitted)="onReviewSubmit($event)"
            />
          }
        } @else {
          <div class="auth-cta" data-testid="product-review-auth-cta">
            <p>{{ strings().product.reviews.signInBody }}</p>
            <a class="link-cta" [href]="loginHref()" data-testid="product-review-signin-link">
              {{ strings().product.reviews.signInCta }}
            </a>
          </div>
        }
        <product-reviews-summary
          [input]="reviewsInput()"
          [ownReview]="ownReviewRow()"
          [authed]="authed()"
          (loadMore)="onLoadMoreReviews()"
          [editingReviewId]="editingReviewId()"
          [editTarget]="editingReview()"
          [editSaving]="reviewSaving()"
          [editError]="reviewError()"
          (helpfulToggle)="onReviewHelpful($event)"
          (editClicked)="onReviewEdit($event)"
          (editSubmitted)="onReviewSubmit($event)"
          (editCancelled)="onReviewEditCancel()"
          (deleteClicked)="onReviewDelete($event)"
        />
        @if (deleteTarget(); as t) {
          <div
            class="delete-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="product-review-delete-title"
            aria-describedby="product-review-delete-body"
            cdkTrapFocus
            [cdkTrapFocusAutoCapture]="true"
            data-testid="product-review-delete-confirm"
          >
            <h3 id="product-review-delete-title">
              {{ strings().product.reviews.deleteConfirm.title }}
            </h3>
            <p id="product-review-delete-body">
              {{ strings().product.reviews.deleteConfirm.body }}
            </p>
            <div class="delete-confirm-actions">
              <app-button
                variant="secondary"
                size="sm"
                testId="product-review-delete-no"
                (clicked)="onDeleteCancel()"
              >
                {{ strings().product.reviews.deleteConfirm.no }}
              </app-button>
              <app-button
                variant="danger"
                size="sm"
                [loading]="deleteBusyId() === t"
                testId="product-review-delete-yes"
                (clicked)="onDeleteConfirm(t)"
              >
                {{ strings().product.reviews.deleteConfirm.yes }}
              </app-button>
            </div>
          </div>
        }
      </div>

      <div class="questions-block">
        @if (authed()) {
          @if (questionSubmissionPending()) {
            <p
              class="pending-banner"
              role="status"
              aria-live="polite"
              data-testid="product-question-pending-banner"
            >
              {{ strings().product.questions.pending }}
            </p>
          }
          <product-question-form
            #questionForm
            [saving]="questionSaving()"
            [externalError]="questionError()"
            (submitted)="onQuestionSubmit($event)"
          />
        } @else {
          <div class="auth-cta" data-testid="product-question-auth-cta">
            <p>{{ strings().product.questions.signInBody }}</p>
            <a class="link-cta" [href]="loginHref()" data-testid="product-question-signin-link">
              {{ strings().product.questions.signInCta }}
            </a>
          </div>
        }
        <product-questions-list
          #questionsList
          [questions]="questionRows()"
          [total]="questionsTotal()"
          [authed]="authed()"
          (loadMore)="onLoadMoreQuestions()"
          [answerSaving]="answerSaving()"
          [answerError]="answerError()"
          (helpfulToggle)="onQuestionHelpful($event)"
          (answerSubmitted)="onAnswerSubmit($event)"
        />
      </div>

      <product-related-products [items]="relatedItems()" />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        background-color: var(--brand-bg);
        min-block-size: 100dvh;
      }
      .page {
        display: flex;
        flex-direction: column;
        gap: clamp(1.5rem, 4vw, 2.5rem);
        max-inline-size: 1400px;
        margin-inline: auto;
        padding-block: clamp(1rem, 4vw, 2rem);
        padding-inline: clamp(1rem, 4vw, 2rem);
      }
      .hero {
        display: grid;
        gap: clamp(1.5rem, 4vw, 2.5rem);
        grid-template-columns: minmax(0, 1fr);
      }
      @media (min-width: 768px) {
        .hero {
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
        }
      }
      .reviews-block,
      .questions-block {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .review-ineligible {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem;
        border: 1px solid var(--brand-border);
      }
      .auth-cta {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-block: 1rem;
        padding-inline: 1rem;
        border: 1px solid var(--brand-border);
        background-color: var(--brand-surface);
      }
      .auth-cta p {
        margin: 0;
        color: var(--brand-text);
      }
      .link-cta {
        align-self: flex-start;
        color: var(--brand-primary);
        text-decoration: none;
        font-weight: 500;
        min-block-size: 44px;
        padding-block: 0.625rem;
      }
      .link-cta:hover,
      .link-cta:focus-visible {
        text-decoration: underline;
      }
      .pending-banner {
        margin: 0;
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
        background-color: var(--brand-surface-strong);
        color: var(--brand-text);
        font-size: var(--brand-text-body);
      }
      .delete-confirm {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-block: 1rem;
        padding-inline: 1rem;
        border: 1px solid var(--brand-border);
        background-color: var(--brand-surface);
      }
      .delete-confirm h3 {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .delete-confirm p {
        margin: 0;
        color: var(--brand-text);
      }
      .delete-confirm-actions {
        display: flex;
        gap: 0.625rem;
        align-items: center;
        flex-wrap: wrap;
      }
    `,
  ],
})
export default class ProductDetailPage implements OnInit {
  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly analytics = inject(AnalyticsTrackerService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly reviewsSvc = inject(ReviewsService);
  private readonly questionsSvc = inject(QuestionsService);
  private readonly cartSvc = inject(CartService);
  private readonly authState = inject(AuthStateService);
  private readonly toast = inject(ToastService);

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;
  protected readonly authed = this.authState.isAuthed;

  protected readonly reviewFormRef = viewChild<ReviewFormComponent>('reviewForm');
  protected readonly questionFormRef = viewChild<QuestionFormComponent>('questionForm');
  protected readonly questionsListRef = viewChild<QuestionsListComponent>('questionsList');

  /**
   * SH2 — seed every primary signal from the page server endpoint payload
   * exported by the sibling `[slug].server.ts` companion. Analog's resolver
   * fetches the endpoint via HTTP at `/api/_analog/<route>` and writes the
   * response into `route.data['load']` synchronously by the time field
   * initializers run; `toSignal({ requireSync: true })` errors loudly if
   * that contract ever shifts. Pivot recorded at clarifications §1.17.
   */
  protected readonly loaded = toSignal(injectLoad<typeof load>(), {
    requireSync: true,
  });

  protected readonly slug = signal<string>(this.loaded().product.slug);
  protected readonly product = signal<ProductDetail>(this.loaded().product);
  protected readonly faqs = computed<ProductFaq[]>(() => this.product().faqs ?? []);
  protected readonly specs = computed<ProductSpec[]>(() => this.product().specs ?? []);
  protected readonly reviewSummary = signal<RatingSummary | null>(this.loaded().reviewSummary);
  protected readonly firstReviews = signal<Review[]>(this.loaded().firstReviews);
  protected readonly questions = signal<Question[]>(this.loaded().questions);
  protected readonly questionsTotal = signal<number>(
    this.loaded().questionsTotal ?? this.loaded().questions.length,
  );
  /**
   * How many rows each list currently asks the API for.
   *
   * The page used to cap both lists at four rows behind a dead
   * `href="#reviews"` anchor, so a product with twenty reviews advertised
   * four. "Show more" widens the window and refetches page one at the new
   * size, which also keeps a post-mutation refetch from collapsing the list
   * back to its initial page.
   */
  private readonly reviewsWindow = signal<number>(PAGE_SIZE_SEED);
  private readonly questionsWindow = signal<number>(PAGE_SIZE_SEED);
  protected readonly related = signal<ProductSummary[]>(this.loaded().related);
  /**
   * The payload the field initialisers above already seeded, skipped by the
   * re-seed effect so the first run is not a redundant rewrite.
   */
  private seededPayload = this.loaded();
  protected readonly addState = signal<AddToCartState>('idle');
  protected readonly addErrorMessage = signal<string | null>(null);

  protected readonly votedReviewIds = signal<Set<string>>(new Set<string>());
  protected readonly votedQuestionIds = signal<Set<string>>(new Set<string>());
  protected readonly editingReviewId = signal<string | null>(null);
  protected readonly reviewSaving = signal<boolean>(false);
  protected readonly reviewError = signal<string | null>(null);
  protected readonly reviewSubmissionPending = signal<boolean>(false);
  protected readonly questionSaving = signal<boolean>(false);
  protected readonly questionError = signal<string | null>(null);
  protected readonly questionSubmissionPending = signal<boolean>(false);
  protected readonly answerSaving = signal<boolean>(false);
  protected readonly answerError = signal<string | null>(null);
  protected readonly deleteTarget = signal<string | null>(null);
  protected readonly deleteBusyId = signal<string | null>(null);
  /**
   * The caller's own review for this product, in any status.
   *
   * Fetched from `GET /v1/products/:slug/reviews/mine` rather than held in
   * memory: the public list is PUBLISHED-only, so a pending review used to
   * disappear on the next reload and its author could no longer edit or
   * delete it.
   */
  protected readonly ownReview = signal<Review | null>(null);
  /**
   * Why the caller may not review this product, or null when they may.
   *
   * The form used to be shown to every signed-in visitor, and the only gate
   * was the 400 the server answered once they had written the whole thing.
   * Null until the lookup resolves, so a slow answer never hides the form
   * from someone who is eligible.
   */
  protected readonly reviewEligibility = signal<ReviewEligibility | null>(null);
  private ownReviewFetchedFor: string | null = null;

  /** Whether the create form has anything to offer this caller. */
  protected readonly canWriteReview = computed(() => {
    const eligibility = this.reviewEligibility();
    // Null until the lookup resolves: a slow answer must never hide the form
    // from someone who is eligible.
    return !eligibility || eligibility.eligible;
  });

  /**
   * The line shown in place of the form, or null.
   *
   * `ALREADY_REVIEWED` gets no line: the "Your review" slot right below is a
   * better answer than a sentence saying the same thing, and it carries the
   * Edit and Delete controls.
   */
  protected readonly reviewIneligibilityReason = computed<string | null>(() => {
    const eligibility = this.reviewEligibility();
    if (!eligibility || eligibility.eligible) return null;
    if (eligibility.reason === 'ALREADY_REVIEWED') return null;
    return this.strings().product.reviews.form.errors.verifiedPurchaseRequired;
  });

  protected readonly ordersHref = computed(() => APP_ROUTES.account.orders(this.locale()));

  protected readonly editingReview = computed<Review | null>(() => {
    const id = this.editingReviewId();
    if (!id) return null;
    const own = this.ownReview();
    if (own && own.id === id) return own;
    return this.firstReviews().find((r) => r.id === id) ?? null;
  });

  protected readonly loginHref = computed(() => {
    const base = APP_ROUTES.auth.login(this.locale());
    const from = APP_ROUTES.product(this.locale(), this.slug() || 'product');
    return `${base}?from=${encodeURIComponent(from)}`;
  });

  protected readonly breadcrumb = computed<BreadcrumbItem[]>(() => {
    const labels = this.strings().catalog.breadcrumb;
    const home: BreadcrumbItem = { label: labels.home, href: APP_ROUTES.home(this.locale()) };
    const catalog: BreadcrumbItem = {
      label: labels.catalog,
      href: APP_ROUTES.catalog(this.locale()),
    };
    const p = this.product();
    if (!p) return [home, catalog];
    const catRecord = p.categories?.[0];
    const cat = catRecord?.category;
    const trail: BreadcrumbItem[] = [home, catalog];
    if (cat) {
      trail.push({
        label: pickTranslation(cat.name as ResolvedString, this.locale()),
        href: APP_ROUTES.catalog(this.locale(), cat.slug),
      });
    }
    trail.push({ label: pickTranslation(p.name as ResolvedString, this.locale()) });
    return trail;
  });

  protected readonly galleryImages = computed<GalleryImage[]>(() => {
    const p = this.product();
    if (!p) return [];
    const sorted = [...(p.assets ?? [])]
      .filter((a) => a.url)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (sorted.length === 0 && p.primaryAsset?.url) sorted.push(p.primaryAsset);
    const gallerySizes = '(max-width: 768px) 100vw, 50vw';
    return sorted.map((a) => {
      const sources = pictureSourcesFromAssetVariants(a.assetVariants, gallerySizes);
      return {
        url: a.url ?? '',
        alt:
          pickTranslation((a.altText ?? null) as ResolvedString | null, this.locale()) ||
          pickTranslation(p.name as ResolvedString, this.locale()),
        sources: sources.length > 0 ? sources : undefined,
      };
    });
  });

  protected readonly summaryInput = computed<ProductSummaryInput>(() => {
    const p = this.product();
    if (!p) {
      return { title: '', variants: [], currency: this.storeConfig.currencyCode() };
    }
    const variants: ProductVariantOption[] = (p.variants ?? []).map((v) => ({
      id: v.id,
      label: v.attributes
        ? Object.values(v.attributes)
            .map((value) => pickTranslation(value as ResolvedString, this.locale()))
            .filter(Boolean)
            .join(' • ') ||
          (v.sku ?? v.id)
        : (v.sku ?? v.id),
      price: Number(v.price),
      compareAtPrice: v.compareAtPrice != null ? Number(v.compareAtPrice) : null,
      inStock: variantAvailability(v) !== 'OUT_OF_STOCK',
      availability: variantAvailability(v),
      sku: v.sku ?? v.id,
    }));
    return {
      productId: p.id,
      title: pickTranslation(p.name as ResolvedString, this.locale()),
      shortDescription: pickTranslation(
        (p.shortDescription ?? null) as ResolvedString | null,
        this.locale(),
      ),
      description: pickTranslation((p.description ?? null) as ResolvedString | null, this.locale()),
      brand: p.brand ?? null,
      variants,
      currency: p.currency ?? this.storeConfig.currencyCode(),
      // The products API emits no `ratingSummary`, so the buy box read
      // undefined on every product. The review summary endpoint is the one
      // aggregate this page actually has.
      ratingValue: this.reviewSummary()?.averageRating,
      reviewCount: this.reviewSummary()?.total,
    };
  });

  private reviewRow(r: Review, ownId: string | null): ReviewsSummaryRow {
    return {
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      locale: r.locale ?? null,
      authorName: reviewAuthorName(r) || this.strings().product.reviews.anonymous,
      createdAt: r.createdAt,
      helpfulCount: r.helpfulCount ?? 0,
      votedHelpful: this.votedReviewIds().has(r.id),
      ownReview: !!ownId && r.userId === ownId,
      status: r.status,
    };
  }

  protected readonly ownReviewRow = computed<ReviewsSummaryRow | null>(() => {
    const own = this.ownReview();
    if (!own) return null;
    return { ...this.reviewRow(own, this.authState.currentUser()?.id ?? null), ownReview: true };
  });

  protected readonly reviewsInput = computed<ReviewsSummaryInput>(() => {
    const summary = this.reviewSummary();
    const userId = this.authState.currentUser()?.id ?? null;
    const ownId = this.ownReview()?.id ?? null;
    // The aggregate is published-only, straight off the wire: mixing locally
    // held rows into `total` is what made a lone pending review render as
    // "0.0 out of 5, 1 reviews". The caller's own row is dropped here because
    // it renders in its own slot.
    const rows: ReviewsSummaryRow[] = this.firstReviews()
      .filter((r) => r.id !== ownId)
      .map((r) => this.reviewRow(r, userId));
    return {
      averageRating: summary?.averageRating ?? 0,
      total: summary?.total ?? 0,
      histogram: summary?.histogram,
      firstReviews: rows,
    };
  });

  protected readonly questionRows = computed<QuestionRow[]>(() => {
    const voted = this.votedQuestionIds();
    const labels = this.strings().product.questions;
    return this.questions().map((q) => {
      // One answer per question, in a flat column. `answeredBy` is a bare
      // user id with no relation, so the attribution is the role rather
      // than a name: "Store team" for an official reply, "Community" for a
      // customer's.
      const answer: QuestionAnswerRow | null = q.answer
        ? {
            authorName: q.isAdminAnswer ? labels.storeTeam : labels.community,
            body: q.answer,
            isAdminAnswer: q.isAdminAnswer ?? false,
          }
        : null;
      return {
        id: q.id,
        question: q.question,
        authorName: reviewAuthorName({ authorName: q.authorName, user: q.asker }),
        createdAt: q.createdAt,
        questionLocale: q.questionLocale ?? null,
        answer,
        helpfulCount: q.helpfulCount ?? 0,
        votedHelpful: voted.has(q.id),
        status: q.status,
      };
    });
  });

  protected readonly relatedItems = computed<ProductCardData[]>(() => {
    return this.related()
      .filter((r) => r.slug !== this.slug())
      .slice(0, RELATED_PAGE_SIZE)
      .map((p) => this.toCardData(p));
  });

  constructor() {
    /**
     * Finding N5. The header search suggestions navigate product to product,
     * which Analog resolves by re-running this route's loader and re-emitting
     * `route.data['load']`. Every rendered signal here is a copy taken at
     * field-initialiser time, so without this the URL changed and the page did
     * not: same product, same meta, same JSON-LD.
     *
     * An `effect()` rather than a `paramMap` subscription plus a browser
     * refetch: the payload has already arrived, and duplicating the server
     * composition (product, reviews, questions and related in one endpoint) as
     * client fetches would be new machinery for data that is already here.
     */
    effect(() => {
      const payload = this.loaded();
      if (payload === this.seededPayload) return;
      this.seededPayload = payload;
      this.seedFromPayload(payload);
      this.applyMeta();
      this.applyJsonLd();
      // Sibling navigations only. `seededPayload` is initialised to the first
      // payload, so this effect deliberately returns early on the first render
      // and the first view is reported from `ngOnInit` instead. Between them
      // every product a reader actually sees is counted exactly once.
      void this.analytics.trackProductView(this.product().id, this.product().slug);
    });

    /**
     * Fetch the caller's own review once the session is known.
     *
     * An `effect` on `authed()` rather than a call in `ngOnInit`: the session
     * boot is asynchronous, so reading `isAuthed()` at init would miss an
     * authenticated visitor. It is browser-only because the route is
     * `@OwnerGuard()`-protected and the SSR pass carries no session.
     */
    effect(() => {
      const authed = this.authed();
      const slug = this.slug();
      if (!isPlatformBrowser(this.platformId)) return;
      if (!authed) {
        this.ownReviewFetchedFor = null;
        this.ownReview.set(null);
        this.reviewEligibility.set(null);
        return;
      }
      if (!slug || this.ownReviewFetchedFor === slug) return;
      this.ownReviewFetchedFor = slug;
      void this.loadOwnReview(slug);
    });
  }

  /**
   * Re-seed every copied signal from a fresh loader payload and reset the state
   * that belongs to the product being left behind. A leftover `editingReviewId`
   * pointing into the previous product's reviews is a live defect, not cosmetic.
   */
  private seedFromPayload(payload: ReturnType<typeof this.loaded>): void {
    this.slug.set(payload.product.slug);
    this.product.set(payload.product);
    this.reviewSummary.set(payload.reviewSummary);
    this.firstReviews.set(payload.firstReviews);
    this.questions.set(payload.questions);
    this.questionsTotal.set(payload.questionsTotal ?? payload.questions.length);
    this.related.set(payload.related);
    this.reviewsWindow.set(PAGE_SIZE_SEED);
    this.questionsWindow.set(PAGE_SIZE_SEED);

    this.addState.set('idle');
    this.addErrorMessage.set(null);
    this.votedReviewIds.set(new Set<string>());
    this.votedQuestionIds.set(new Set<string>());
    this.editingReviewId.set(null);
    this.reviewSaving.set(false);
    this.reviewError.set(null);
    this.reviewSubmissionPending.set(false);
    this.questionSaving.set(false);
    this.questionError.set(null);
    this.questionSubmissionPending.set(false);
    this.answerSaving.set(false);
    this.answerError.set(null);
    this.deleteTarget.set(null);
    this.deleteBusyId.set(null);
    this.ownReview.set(null);
    this.reviewEligibility.set(null);
    this.ownReviewFetchedFor = null;
  }

  private async loadOwnReview(slug: string): Promise<void> {
    // Independent settlement: an eligibility lookup that fails must not cost
    // the reader their own review, and vice versa.
    const [own, eligibility] = await Promise.allSettled([
      this.reviewsSvc.mine(slug),
      this.reviewsSvc.eligibility(slug),
    ]);
    if (own.status === 'fulfilled') this.ownReview.set(own.value);
    if (eligibility.status === 'fulfilled') this.reviewEligibility.set(eligibility.value);
  }

  ngOnInit(): void {
    /**
     * SH2 — meta + JSON-LD apply synchronously after signal seeding (per
     * `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe` +
     * clarifications Q-2). The constructor `effect()` previously fired twice
     * (once on SSR, once on browser hydrate) and the SSR-side fired before
     * the browser-only `hydrate()` populated `product`, so the OG block
     * skipped the entity rows entirely (Defect A). With the load payload
     * seeded by the time `ngOnInit` runs, both calls emit complete tags on
     * the SSR pass — the WhatsApp / LinkedIn / Facebook scrapers see the
     * product image + description on first byte.
     */
    this.applyMeta();
    this.applyJsonLd();
    // The first view of this component instance. The tracker is browser-only,
    // so the SSR pass through here emits nothing.
    void this.analytics.trackProductView(this.product().id, this.product().slug);
  }

  protected async onAddToCart({ variant, quantity }: AddToCartRequest): Promise<void> {
    if (!variant.inStock) return;
    this.addState.set('submitting');
    this.addErrorMessage.set(null);
    try {
      await this.cartSvc.addItem({ variantId: variant.id, quantity });
      this.addState.set('success');
      void this.analytics.trackAddToCart(this.product().id, quantity, variant.id);
      setTimeout(() => {
        if (this.addState() === 'success') this.addState.set('idle');
      }, 2000);
    } catch (err: unknown) {
      this.addErrorMessage.set(this.addToCartErrorMessageFor(err));
      this.addState.set('error');
    }
  }

  /**
   * Map a backend add-to-cart failure to a localized message. Declared error
   * codes (`CART_VARIANT_NOT_FOUND` and `CART_INSUFFICIENT_STOCK` from
   * `apps/api/src/modules/cart/cart-{variant-not-found,insufficient-stock}.exception.ts`)
   * get dedicated strings in both FR + EN; unknown codes return null so the
   * template falls back to the generic `addToCartError` copy. See
   * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 rows #3-4.
   */
  private addToCartErrorMessageFor(err: unknown): string | null {
    const errors = this.strings().product.errors;
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : null;
    if (code === 'CART_VARIANT_NOT_FOUND') {
      return errors.variantNotFound;
    }
    if (code === 'CART_INSUFFICIENT_STOCK') {
      return errors.insufficientStock;
    }
    return null;
  }

  protected async onReviewSubmit(event: ReviewFormSubmit): Promise<void> {
    if (this.reviewSaving()) return;
    this.reviewSaving.set(true);
    this.reviewError.set(null);
    const slug = this.slug();
    try {
      let saved: Review;
      if (event.mode === 'create') {
        saved = await this.reviewsSvc.create(slug, event.payload);
        this.reviewFormRef()?.reset();
      } else {
        saved = await this.reviewsSvc.update(event.reviewId, event.payload);
        this.editingReviewId.set(null);
      }
      this.ownReview.set(saved);
      this.reviewEligibility.set({ eligible: false, reason: 'ALREADY_REVIEWED' });
      this.reviewSubmissionPending.set(true);
      this.toast.success(this.strings().product.reviews.pending);
      await this.refetchReviews();
    } catch (err: unknown) {
      this.reviewError.set(this.reviewErrorMessageFor(err));
    } finally {
      this.reviewSaving.set(false);
    }
  }

  /**
   * Map a backend review-submission failure to a localized message. Declared
   * error codes (`REVIEW_VERIFIED_PURCHASE_REQUIRED` from
   * `apps/api/src/modules/reviews/review-eligibility.exception.ts`,
   * `REVIEW_DUPLICATE` from `review-duplicate.exception.ts`) get a dedicated
   * string in both FR + EN; unknown codes fall back to the generic "try
   * again" copy. See `specs/features/full-stack-audit-2026-05-14/plan.md`
   * §1.1 row #1 for the duplicate-review contract.
   */
  private reviewErrorMessageFor(err: unknown): string {
    const errors = this.strings().product.reviews.form.errors;
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : null;
    if (code === 'REVIEW_VERIFIED_PURCHASE_REQUIRED') {
      return errors.verifiedPurchaseRequired;
    }
    if (code === 'REVIEW_DUPLICATE') {
      return errors.duplicate;
    }
    if (code === 'REVIEW_PRODUCT_NOT_FOUND') {
      return errors.productNotFound;
    }
    if (code === 'ASSET_INVALID') {
      return errors.assetInvalid;
    }
    if (code === 'REVIEW_NOT_OWNED') {
      return errors.notOwned;
    }
    return errors.generic;
  }

  protected onReviewEdit(event: { reviewId: string }): void {
    this.editingReviewId.set(event.reviewId);
    this.reviewError.set(null);
  }

  protected onReviewEditCancel(): void {
    this.editingReviewId.set(null);
    this.reviewError.set(null);
  }

  protected async onReviewHelpful(event: { reviewId: string; nextVoted: boolean }): Promise<void> {
    const previous = new Set(this.votedReviewIds());
    const next = new Set(previous);
    if (event.nextVoted) next.add(event.reviewId);
    else next.delete(event.reviewId);
    this.votedReviewIds.set(next);
    this.firstReviews.update((list) =>
      list.map((r) =>
        r.id === event.reviewId
          ? {
              ...r,
              helpfulCount: Math.max(0, (r.helpfulCount ?? 0) + (event.nextVoted ? 1 : -1)),
            }
          : r,
      ),
    );
    try {
      const result = await this.reviewsSvc.toggleHelpful(event.reviewId);
      // The toggle endpoint returns only the caller's voted-state (helpful boolean).
      // Reconcile the client's voted set with the canonical truth from the server,
      // then refetch the list so the aggregate helpfulCount matches the DB.
      const corrected = new Set(this.votedReviewIds());
      if (result.helpful) corrected.add(event.reviewId);
      else corrected.delete(event.reviewId);
      this.votedReviewIds.set(corrected);
      void this.refetchReviews();
    } catch {
      this.votedReviewIds.set(previous);
      this.firstReviews.update((list) =>
        list.map((r) =>
          r.id === event.reviewId
            ? {
                ...r,
                helpfulCount: Math.max(0, (r.helpfulCount ?? 0) - (event.nextVoted ? 1 : -1)),
              }
            : r,
        ),
      );
      this.toast.error(this.strings().product.reviews.helpfulError);
    }
  }

  protected onReviewDelete(event: { reviewId: string }): void {
    this.deleteTarget.set(event.reviewId);
  }

  protected onDeleteCancel(): void {
    this.deleteTarget.set(null);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.deleteTarget()) this.onDeleteCancel();
  }

  protected async onDeleteConfirm(reviewId: string): Promise<void> {
    this.deleteBusyId.set(reviewId);
    try {
      await this.reviewsSvc.delete(reviewId);
      this.toast.success(this.strings().product.reviews.deleted);
      this.deleteTarget.set(null);
      if (this.ownReview()?.id === reviewId) {
        this.ownReview.set(null);
        this.reviewSubmissionPending.set(false);
        const slug = this.slug();
        if (slug) void this.refreshEligibility(slug);
      }
      await this.refetchReviews();
    } catch (err: unknown) {
      this.toast.error(this.reviewErrorMessageFor(err));
    } finally {
      this.deleteBusyId.set(null);
    }
  }

  protected async onQuestionSubmit(event: QuestionFormSubmit): Promise<void> {
    if (this.questionSaving()) return;
    this.questionSaving.set(true);
    this.questionError.set(null);
    try {
      await this.questionsSvc.create(this.slug(), event.payload);
      this.questionFormRef()?.reset();
      this.questionSubmissionPending.set(true);
      this.toast.success(this.strings().product.questions.pending);
      await this.refetchQuestions();
    } catch (err: unknown) {
      this.questionError.set(this.questionErrorMessageFor(err));
    } finally {
      this.questionSaving.set(false);
    }
  }

  /**
   * Map a backend question-submission failure to a localized message. Only
   * `REVIEW_PRODUCT_NOT_FOUND` from `review-product-not-found.exception.ts`
   * carries a dedicated copy today (questions share the same product lookup
   * via `resolveProductBySlug`); unknown codes fall back to the generic copy.
   * See `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #13.
   */
  private questionErrorMessageFor(err: unknown): string {
    const errors = this.strings().product.questions.form.errors;
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : null;
    if (code === 'REVIEW_PRODUCT_NOT_FOUND') {
      return errors.productNotFound;
    }
    return errors.generic;
  }

  protected async onQuestionHelpful(event: {
    questionId: string;
    nextVoted: boolean;
  }): Promise<void> {
    const previous = new Set(this.votedQuestionIds());
    const next = new Set(previous);
    if (event.nextVoted) next.add(event.questionId);
    else next.delete(event.questionId);
    this.votedQuestionIds.set(next);
    this.questions.update((list) =>
      list.map((q) =>
        q.id === event.questionId
          ? {
              ...q,
              helpfulCount: Math.max(0, (q.helpfulCount ?? 0) + (event.nextVoted ? 1 : -1)),
            }
          : q,
      ),
    );
    try {
      const result = await this.questionsSvc.toggleHelpful(event.questionId);
      const corrected = new Set(this.votedQuestionIds());
      if (result.helpful) corrected.add(event.questionId);
      else corrected.delete(event.questionId);
      this.votedQuestionIds.set(corrected);
      void this.refetchQuestions();
    } catch {
      this.votedQuestionIds.set(previous);
      this.questions.update((list) =>
        list.map((q) =>
          q.id === event.questionId
            ? {
                ...q,
                helpfulCount: Math.max(0, (q.helpfulCount ?? 0) - (event.nextVoted ? 1 : -1)),
              }
            : q,
        ),
      );
      this.toast.error(this.strings().product.questions.helpfulError);
    }
  }

  protected async onAnswerSubmit(event: {
    questionId: string;
    payload: AnswerQuestionRequest;
  }): Promise<void> {
    if (this.answerSaving()) return;
    this.answerSaving.set(true);
    this.answerError.set(null);
    try {
      const updated = await this.questionsSvc.answer(event.questionId, event.payload);
      // The endpoint returns the whole question row, answer column included.
      this.questions.update((list) => list.map((q) => (q.id === event.questionId ? updated : q)));
      this.questionsListRef()?.resetAnswerForm();
      this.toast.success(this.strings().product.questions.answer.added);
    } catch (err: unknown) {
      this.answerError.set(this.answerErrorMessageFor(err));
    } finally {
      this.answerSaving.set(false);
    }
  }

  /**
   * Map a backend answer-submission failure to a localized message. Declared
   * error codes (`QUESTION_NOT_AVAILABLE_FOR_ANSWER` from
   * `apps/api/src/modules/reviews/question-not-available.exception.ts`) get
   * a dedicated string in both FR + EN; unknown codes fall back to the
   * generic "try again" copy. See
   * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #2.
   */
  private answerErrorMessageFor(err: unknown): string {
    const errors = this.strings().product.questions.answer.errors;
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : null;
    if (code === 'QUESTION_NOT_AVAILABLE_FOR_ANSWER') {
      return errors.notAvailable;
    }
    if (code === 'QUESTION_ALREADY_ANSWERED') {
      return errors.alreadyAnswered;
    }
    return errors.generic;
  }

  protected async onLoadMoreReviews(): Promise<void> {
    this.reviewsWindow.update((n) => Math.min(n + PAGE_SIZE_STEP, PAGE_SIZE_MAX));
    await this.refetchReviews();
  }

  protected async onLoadMoreQuestions(): Promise<void> {
    this.questionsWindow.update((n) => Math.min(n + PAGE_SIZE_STEP, PAGE_SIZE_MAX));
    await this.refetchQuestions();
  }

  private async refreshEligibility(slug: string): Promise<void> {
    try {
      this.reviewEligibility.set(await this.reviewsSvc.eligibility(slug));
    } catch {
      // best-effort
    }
  }

  private async refetchReviews(): Promise<void> {
    const slug = this.slug();
    if (!slug) return;
    try {
      const [summary, list] = await Promise.all([
        this.reviewsSvc.summary(slug),
        this.reviewsSvc.list(slug, {
          pageSize: this.reviewsWindow(),
          sortBy: 'createdAt',
          sortOrder: 'desc',
        }),
      ]);
      this.reviewSummary.set(summary);
      this.firstReviews.set(list.data);
    } catch {
      // best-effort refetch — the backend may briefly return 404 between writes,
      // which leaves the optimistic state in place until the next mutation.
    }
  }

  private async refetchQuestions(): Promise<void> {
    const slug = this.slug();
    if (!slug) return;
    try {
      const list = await this.questionsSvc.list(slug, { pageSize: this.questionsWindow() });
      this.questions.set(list.data);
      this.questionsTotal.set(list.meta.total);
    } catch {
      // best-effort
    }
  }

  private toCardData(p: ProductSummary): ProductCardData {
    const variant = p.variants?.[0];
    // No literal-zero floor: a row with no resolvable price renders no price line
    // rather than a wrong one. See `ProductCardData.price`.
    const price =
      variant?.price != null
        ? Number(variant.price)
        : p.minPrice != null
          ? Number(p.minPrice)
          : null;
    const primary = p.primaryAsset ?? p.assets?.find((a) => a.isPrimary) ?? p.assets?.[0];
    const imageSrc = primary?.url || noImageFallback();
    const imageAlt =
      pickTranslation((primary?.altText ?? null) as ResolvedString | null, this.locale()) ||
      pickTranslation(p.name as ResolvedString, this.locale());
    const cardSizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw';
    const imageSources = pictureSourcesFromAssetVariants(primary?.assetVariants, cardSizes);
    return {
      productId: p.id,
      slug: p.slug,
      title: pickTranslation(p.name as ResolvedString, this.locale()),
      href: APP_ROUTES.product(this.locale(), p.slug),
      imageSrc,
      imageAlt,
      imageSources: imageSources.length > 0 ? imageSources : undefined,
      price,
      compareAtPrice: variant?.compareAtPrice != null ? Number(variant.compareAtPrice) : null,
      currency: p.currency ?? this.storeConfig.currencyCode(),
      deliveryEstimate: this.strings().product.delivery.estimate,
      availability: productAvailability(p.variants),
    };
  }

  private applyJsonLd(): void {
    const head = this.document.head;
    if (!head) return;
    head
      .querySelectorAll<HTMLScriptElement>(
        'script[type="application/ld+json"][data-product-jsonld]',
      )
      .forEach((node) => node.remove());
    const p = this.product();
    const baseUrl = this.resolveBaseUrl();

    // BreadcrumbList: emit on both SSR and browser. On SSR, breadcrumb()
    // returns [home, catalog] (no product data yet), which is still a valid
    // schema.org BreadcrumbList and gives crawlers structural context (S13).
    const breadcrumbItems = this.breadcrumb()
      .filter((b) => !!b.href)
      .map((b) => ({ name: b.label, url: this.absoluteUrl(baseUrl, b.href!) }));
    const last = this.breadcrumb()[this.breadcrumb().length - 1];
    if (last && !last.href) {
      breadcrumbItems.push({
        name: last.label,
        url: this.absoluteUrl(baseUrl, APP_ROUTES.product(this.locale(), this.slug())),
      });
    }
    if (breadcrumbItems.length > 0) {
      const script = this.document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      script.setAttribute('data-product-jsonld', 'true');
      script.textContent = serializeJsonLd(breadcrumbListJsonLd(breadcrumbItems));
      head.appendChild(script);
    }

    // SH2 — `product` is seeded from the SSR `routeMeta.load` payload before
    // `applyJsonLd()` runs, so the previous `if (!p) return` guard is dead.
    const variant = p.variants?.[0];
    const price = variant?.price != null ? Number(variant.price) : 0;
    const inStock = productAvailability(p.variants) !== 'OUT_OF_STOCK';
    const sortedAssets = [...(p.assets ?? [])]
      .filter((a) => a.url)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    // AV4 / clarifications.md Q6 — JSON-LD `Product.image` carries a single
    // canonical URL (the large variant served on the detail page). The
    // schema accepts an array; we emit a one-element array so future
    // expansion to multi-size doesn't change the shape.
    const primaryAsset = p.primaryAsset?.url ? p.primaryAsset : sortedAssets[0];
    const imageUrls = primaryAsset?.url
      ? [this.absoluteUrl(baseUrl, primaryAsset.url)]
      : [this.absoluteUrl(baseUrl, noImageFallback())];
    const summary = untracked(() => this.reviewSummary());
    // schema.org requires `Review.author.name`, and `productReviewSchema`
    // enforces it at `min(1)`, so a review with no attributable author is
    // dropped rather than emitted with a blank name. Before the name was
    // derived from `user`, that was EVERY review, and the resulting ZodError
    // reached the console on every product page carrying one.
    const firstReviews = untracked(() => this.firstReviews())
      .map((r) => ({
        rating: r.rating,
        body: r.body,
        authorName: reviewAuthorName(r),
        createdAt: r.createdAt,
      }))
      .filter((r) => !!r.authorName)
      .slice(0, 3);
    const productScript = this.document.createElement('script');
    productScript.setAttribute('type', 'application/ld+json');
    productScript.setAttribute('data-product-jsonld', 'true');
    productScript.textContent = serializeJsonLd(
      productJsonLd(
        {
          slug: p.slug,
          money: this.storeConfig.money(),
          name: pickTranslation(p.name as ResolvedString, this.locale()),
          description:
            pickTranslation((p.description ?? null) as ResolvedString | null, this.locale()) ||
            pickTranslation(p.name as ResolvedString, this.locale()),
          imageUrls,
          sku: variant?.sku ?? null,
          brand: p.brand ?? null,
          price,
          currency: p.currency ?? this.storeConfig.currencyCode(),
          inStock,
          reviewSummary: summary
            ? { averageRating: summary.averageRating, total: summary.total }
            : null,
          firstReviews,
        },
        this.locale(),
        baseUrl,
      ),
    );
    head.appendChild(productScript);

    // FAQPage JSON-LD — emit only when at least one Q/A pair resolves to
    // non-empty strings in the active locale. Translatable JSONB fallbacks
    // through `pickTranslation` so missing AR copies still surface the EN
    // entry rather than dropping the FAQ entirely.
    const faqEntries = this.faqs()
      .map((f) => ({
        question: pickTranslation(f.question as ResolvedString, this.locale()),
        answer: pickTranslation(f.answer as ResolvedString, this.locale()),
      }))
      .filter((entry) => entry.question.length > 0 && entry.answer.length > 0);
    if (faqEntries.length > 0) {
      const faqScript = this.document.createElement('script');
      faqScript.setAttribute('type', 'application/ld+json');
      faqScript.setAttribute('data-product-jsonld', 'true');
      faqScript.textContent = serializeJsonLd(faqPageJsonLd(faqEntries));
      head.appendChild(faqScript);
    }
  }

  private applyMeta(): void {
    /**
     * SH2 — `product` is seeded from the SSR `routeMeta.load` payload before
     * `applyMeta()` runs, so the previous `if (p)` guard is dead. Title +
     * canonical + hreflang + the full OG / Twitter / product:* block emit on
     * the SSR pass, which is what JS-less crawlers (WhatsApp, LinkedIn,
     * Facebook, AI bots) read.
     */
    const p = this.product();
    const locale = this.locale();
    const baseUrl = this.resolveBaseUrl();
    const slug = p.slug;

    const sortedAssets = [...(p.assets ?? [])]
      .filter((a) => a.url)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const primary = p.primaryAsset ?? sortedAssets[0];
    const tags = productMetaTags({
      locale,
      baseUrl,
      locales: this.storeConfig.seoLocales(),
      identity: this.localeService.chromeIdentity(),
      slug,
      name: p.name as ResolvedString,
      description: (p.description ?? null) as ResolvedString | null,
      primaryImageUrl: primary?.url ? this.absoluteUrl(baseUrl, primary.url) : null,
    });

    this.upsertCanonical(tags.canonical);
    this.upsertHreflang(tags.hreflang);

    this.title.setTitle(pageTitle(tags.title, this.strings().brand.name));
    this.upsertNamed('description', tags.description);
    this.upsertProperty('og:title', tags.og.title);
    this.upsertProperty('og:description', tags.og.description);
    this.upsertProperty('og:image', tags.og.image);
    this.upsertProperty('og:url', tags.og.url);
    this.upsertProperty('og:locale', tags.og.locale);
    upsertPropertyMulti(this.document, 'og:locale:alternate', tags.og.localeAlternate);
    this.upsertProperty('og:type', tags.og.type);
    this.upsertNamed('twitter:card', tags.twitter.card);
    this.upsertNamed('twitter:title', tags.twitter.title);
    this.upsertNamed('twitter:description', tags.twitter.description);
    this.upsertNamed('twitter:image', tags.twitter.image);

    // SH2 — product:* facets per spec.md AC-2. Crawlers read these from the
    // raw SSR HTML to render share-card preview rows (price, currency, in/out
    // of stock). All three are derived from the seeded `product` payload.
    const variant = p.variants?.[0];
    const price = variant?.price != null ? Number(variant.price) : 0;
    const inStock = productAvailability(p.variants) !== 'OUT_OF_STOCK';
    const priceCurrency = p.currency ?? this.storeConfig.currencyCode();
    this.upsertProperty(
      'product:price:amount',
      price.toFixed(moneyFractionDigits(this.storeConfig.money(), priceCurrency)),
    );
    this.upsertProperty('product:price:currency', priceCurrency);
    this.upsertProperty('product:availability', inStock ? 'in stock' : 'out of stock');
  }

  private upsertCanonical(href: string): void {
    const head = this.document.head;
    if (!head) return;
    let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  private upsertHreflang(items: { hreflang: string; href: string }[]): void {
    const head = this.document.head;
    if (!head) return;
    head
      .querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]')
      .forEach((node) => node.remove());
    for (const item of items) {
      const link = this.document.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', item.hreflang);
      link.setAttribute('href', item.href);
      head.appendChild(link);
    }
  }

  private upsertNamed(name: string, content: string): void {
    const selector = `name="${name}"`;
    if (this.meta.getTag(selector)) {
      this.meta.updateTag({ name, content }, selector);
    } else {
      this.meta.addTag({ name, content });
    }
  }

  private upsertProperty(property: string, content: string): void {
    const selector = `property="${property}"`;
    if (this.meta.getTag(selector)) {
      this.meta.updateTag({ property, content }, selector);
    } else {
      this.meta.addTag({ property, content });
    }
  }

  private resolveBaseUrl(): string {
    if (isPlatformBrowser(this.platformId)) {
      return globalThis.location?.origin ?? 'http://localhost:53300';
    }
    if (isPlatformServer(this.platformId) && typeof process !== 'undefined') {
      return process.env['STOREFRONT_PUBLIC_BASE_URL'] ?? 'http://localhost:53300';
    }
    return 'http://localhost:53300';
  }

  private absoluteUrl(base: string, path: string): string {
    if (path.startsWith('http')) return path;
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}${path.startsWith('/') ? '' : '/'}${path}`;
  }
}
