import { DOCUMENT, isPlatformBrowser, isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { injectLoad } from '@analogjs/router';

import { SearchService } from '@storefront-services';
import type {
  FilterBucket,
  FiltersResponse,
  SearchHit,
  SearchProductsQuery,
  SearchSortField,
} from '@storefront-types';
import { pickTranslation, type ResolvedString } from '@storefront-types';

import type { load } from './index.server';

import { BreadcrumbComponent, type BreadcrumbItem } from '../../../ui/breadcrumb.component';
import { LocaleService } from '../../../locale.service';
import { APP_ROUTES } from '../../../../lib/routes';
import { ogLocaleFromLocale } from '../../../../lib/locale-region';
import {
  OG_SHARE_CARD,
  breadcrumbListJsonLd,
  hreflangSet,
  itemListJsonLd,
  pageTitle,
  serializeJsonLd,
} from '../../../../lib/seo';
import { pictureSourcesFromAssetVariants } from '../../../../lib/asset-variant';
import { noImageFallback } from '../../../../lib/no-image';
import { productAvailability } from '../../../../lib/availability';
import {
  FilterRailComponent,
  type CatalogFilterChange,
  type CatalogFilterState,
  type CatalogPriceBand,
} from '../../../sections/catalog/filter-rail.component';
import {
  ProductGridComponent,
  type ProductGridCardClick,
} from '../../../sections/catalog/product-grid.component';
import {
  SortControlComponent,
  type CatalogSortChange,
  type CatalogSortKey,
} from '../../../sections/catalog/sort-control.component';
import { MobileSearchInputComponent } from '../../../sections/search/mobile-search-input.component';
import type { ProductCardData } from '../../../ui/product-card.component';
import { StoreConfigService } from '../../../services/store-config.service';

const PAGE_SIZE = 24;

const SORT_KEY_FROM_QUERY = (sortBy?: string, sortOrder?: string): CatalogSortKey => {
  if (sortBy === 'price' && sortOrder === 'asc') return 'priceAsc';
  if (sortBy === 'price' && sortOrder === 'desc') return 'priceDesc';
  if (sortBy === 'name' && sortOrder === 'asc') return 'nameAsc';
  return 'newest';
};

const PRICE_BAND_FROM_QUERY = (
  minPrice: number | null,
  maxPrice: number | null,
): CatalogPriceBand | null => {
  if (minPrice == null && maxPrice === 49.999) return 'under50';
  if (minPrice === 50 && maxPrice === 249.999) return '50to250';
  if (minPrice === 250 && maxPrice === 999.999) return '250to1000';
  if (minPrice === 1000 && maxPrice == null) return 'over1000';
  return null;
};

@Component({
  selector: 'app-search-results-page',
  standalone: true,
  imports: [
    BreadcrumbComponent,
    FilterRailComponent,
    MobileSearchInputComponent,
    ProductGridComponent,
    SortControlComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-breadcrumb [items]="breadcrumb()" [ariaLabel]="strings().search.breadcrumb.navLabel" />

      <app-mobile-search-input [initialQuery]="query()" />

      <header class="header">
        <h1 class="title" data-testid="search-title">{{ pageHeading() }}</h1>
        <p class="results" data-testid="search-results-count" aria-live="polite" aria-atomic="true">
          {{ resultsCountLabel() }}
        </p>
      </header>

      <div class="grid-shell">
        <aside class="rail" [attr.aria-label]="strings().catalog.filters.title">
          <catalog-filter-rail
            [brands]="availableBrands()"
            [initial]="currentFilterState()"
            (filterChange)="onFilterChange($event)"
          />
        </aside>
        <div class="grid">
          <div class="toolbar">
            <catalog-sort-control
              [current]="currentSortKey()"
              (sortChange)="onSortChange($event)"
            />
          </div>
          @if (hitsError()) {
            <div class="load-error" data-testid="search-error" role="alert">
              <p>{{ strings().search.loadError }}</p>
              <button type="button" data-testid="search-error-retry" (click)="retry()">
                {{ strings().search.retry }}
              </button>
            </div>
          } @else {
            <catalog-product-grid
              [items]="cardItems()"
              [loading]="loading()"
              [emptyHeadingOverride]="strings().search.noResults.title"
              [emptyBodyOverride]="strings().search.noResults.body"
              [emptyCtaLabel]="strings().search.noResults.cta"
              [emptyCtaHref]="homeHref()"
              (cardClick)="onCardClick($event)"
            />
          }
        </div>
      </div>
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
        gap: clamp(1rem, 3vw, 1.5rem);
        max-inline-size: 1400px;
        margin-inline: auto;
        padding-block: clamp(1rem, 4vw, 2rem);
        padding-inline: clamp(1rem, 4vw, 2rem);
      }
      .header {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        color: var(--brand-text);
      }
      .results {
        margin: 0;
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      /* Load-error block, shared shape with the cart page. Secondary-button
         treatment because a retry is a recovery action, not a primary CTA. */
      .load-error {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: start;
        padding-block: 2rem;
      }
      .load-error p {
        margin: 0;
        color: var(--brand-text);
      }
      .load-error button {
        font: inherit;
        min-block-size: 44px;
        padding-block: 0.5rem;
        padding-inline: 1rem;
        border-radius: var(--brand-radius-md);
        background-color: transparent;
        color: var(--brand-primary);
        border: 1px solid var(--brand-primary);
        cursor: pointer;
      }
      .load-error button:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      .grid-shell {
        display: grid;
        gap: clamp(1rem, 3vw, 1.5rem);
        grid-template-columns: 1fr;
      }
      @media (min-width: 1024px) {
        .grid-shell {
          grid-template-columns: 280px 1fr;
        }
      }
      .toolbar {
        display: flex;
        justify-content: flex-end;
        margin-block-end: 0.75rem;
      }
    `,
  ],
})
export default class SearchResultsPage implements OnInit {
  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly searchSvc = inject(SearchService);

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;

  /**
   * SH4 — seed search results from the page server endpoint payload exported
   * by the sibling `index.server.ts` companion. Per clarifications Q-5 the
   * `load` body always executes; bare `/search` returns the empty payload
   * synchronously so the type contract stays consistent across both branches.
   */
  protected readonly loaded = toSignal(injectLoad<typeof load>(), { requireSync: true });

  protected readonly query = signal<string>(this.loaded().query);
  protected readonly hits = signal<SearchHit[]>(this.loaded().hits);
  protected readonly facets = signal<FiltersResponse>(this.loaded().facets);
  protected readonly totalCount = signal<number>(this.loaded().totalCount);
  protected readonly loading = signal<boolean>(false);
  /**
   * True when the results fetch failed, as opposed to matching nothing. The
   * loader soft-fails so a facets outage cannot take the page down, and this
   * carries what it soft-failed on (finding C10).
   */
  protected readonly hitsError = signal<boolean>(this.loaded().hitsError === true);

  protected readonly currentSortKey = signal<CatalogSortKey>('newest');
  /**
   * The payload the field initialisers above already seeded, skipped by the
   * re-seed effect so the first run is not a redundant rewrite.
   */
  private seededPayload = this.loaded();

  protected readonly currentFilterState = signal<CatalogFilterState>({
    brand: null,
    priceBand: null,
  });

  protected readonly pageHeading = computed(() => {
    const q = this.query().trim();
    const t = this.strings().search;
    return q.length > 0 ? t.pageHeadingWithQuery.replace('{q}', q) : t.pageHeading;
  });

  protected readonly homeHref = computed(() => APP_ROUTES.home(this.locale()));

  protected readonly resultsCountLabel = computed(() => {
    const total = this.totalCount();
    const t = this.strings().search;
    if (total === 1) return t.resultsCountSingular;
    return t.resultsCount.replace('{count}', String(total));
  });

  protected readonly availableBrands = computed(() => {
    const set = new Set<string>();
    const buckets = this.facets();
    const brandFacet = buckets.find((b: FilterBucket) => b.facet === 'brand');
    if (brandFacet) {
      for (const v of brandFacet.values) set.add(v.value);
    }
    // Fallback: populate from hits if the facets endpoint returns nothing.
    if (set.size === 0) {
      for (const h of this.hits()) {
        if (h.product.brand) set.add(h.product.brand);
      }
    }
    return Array.from(set).sort();
  });

  protected readonly cardItems = computed<ProductCardData[]>(() =>
    this.hits().map((h) => this.toCardData(h)),
  );

  protected readonly breadcrumb = computed<BreadcrumbItem[]>(() => {
    const labels = this.strings().search.breadcrumb;
    const home: BreadcrumbItem = { label: labels.home, href: APP_ROUTES.home(this.locale()) };
    const q = this.query().trim();
    const search: BreadcrumbItem = q
      ? { label: labels.search, href: APP_ROUTES.search(this.locale()) }
      : { label: labels.search };
    if (!q) return [home, search];
    return [home, search, { label: q }];
  });

  constructor() {
    /**
     * Findings C1 and C7. `/search` re-resolves its loader on every
     * query-param change, so sort, brand and price gestures come back through
     * the payload already applied. The page used to refetch from
     * `route.snapshot`, which still held the pre-navigation params, so the grid
     * was overwritten with yesterday's filters. The loader is the only writer
     * now; `refetch()` survives for the retry surface only.
     *
     * An `effect()` rather than a direct `subscribe`: the title strategy runs
     * between route activation and `NavigationEnd`, so a synchronous re-apply
     * of the meta would be overwritten by the strategy's home title (C2).
     */
    effect(() => {
      const payload = this.loaded();
      if (payload === this.seededPayload) return;
      this.seededPayload = payload;
      this.hits.set(payload.hits);
      this.totalCount.set(payload.totalCount);
      this.hitsError.set(payload.hitsError === true);
      this.facets.set(payload.facets);
      this.query.set(payload.query);
      this.loading.set(false);
      this.readQueryParams();
      this.applyMeta();
      this.applyJsonLd();
    });
  }

  ngOnInit(): void {
    this.readQueryParams();
    /**
     * SH4 — meta + JSON-LD apply synchronously after signal seeding (per
     * `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe` +
     * clarifications Q-2). Both calls emit complete tags on the SSR pass and
     * the browser hydrate matches byte-for-byte.
     */
    this.applyMeta();
    this.applyJsonLd();
  }

  protected onSortChange(change: CatalogSortChange): void {
    this.currentSortKey.set(change.key);
    this.navigateToQuery({
      sortBy: change.sortBy,
      sortOrder: change.sortOrder,
      page: 1,
    });
  }

  protected onFilterChange(change: CatalogFilterChange): void {
    this.currentFilterState.set({ brand: change.brand, priceBand: change.priceBand });
    this.navigateToQuery({
      brand: change.brand,
      minPrice: change.minPrice,
      maxPrice: change.maxPrice,
      page: 1,
    });
  }

  /**
   * Navigate to the new query string and let the resolver deliver the hits.
   *
   * `loading` is raised here and cleared by the re-seed effect. The two escape
   * hatches cover the cases where no payload will arrive: a cancelled or failed
   * navigation, and a gesture that lands on the URL the page is already on,
   * which re-runs no resolver.
   */
  private navigateToQuery(queryParams: Record<string, string | number | null>): void {
    const before = this.loaded();
    this.loading.set(true);
    void this.router
      .navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' })
      .then((navigated) => {
        if (!navigated || this.loaded() === before) this.loading.set(false);
      })
      .catch(() => this.loading.set(false));
  }

  protected onCardClick(event: ProductGridCardClick): void {
    const hit = this.hits()[event.position];
    const eventId = hit?.eventId;
    if (!eventId) return;
    void this.searchSvc
      .logClick(eventId, {
        clickedProductId: hit.product.id,
        clickPosition: event.position,
      })
      .catch((err: unknown) => {
        // Click logging is fire-and-forget — failure must not block the
        // user's navigation. Surface to the dev console only.
        // eslint-disable-next-line no-console
        console.warn('[search] logClick failed', err);
      });
    // A full document navigation unloads the page, and WebKit drops the click
    // POST with it. Route a plain click in-app so the request can finish.
    const click = event.event;
    const anchor = (click.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
    const href = anchor?.getAttribute('href');
    if (
      !href ||
      click.button !== 0 ||
      click.ctrlKey ||
      click.metaKey ||
      click.shiftKey ||
      click.altKey
    ) {
      return;
    }
    click.preventDefault();
    void this.router.navigateByUrl(href);
  }

  private readQueryParams(): void {
    const q = this.route.snapshot.queryParamMap;
    // The `load` payload already populates `query` from `?q=` — the snapshot
    // re-read here is redundant on the SSR pass but harmless on browser-side
    // refetches where the `query` signal must reflect URL changes the user
    // makes via the search input chrome.
    const urlQ = q.get('q') ?? '';
    if (urlQ !== this.query()) this.query.set(urlQ);
    const sortBy = q.get('sortBy') ?? undefined;
    const sortOrder = q.get('sortOrder') ?? undefined;
    this.currentSortKey.set(SORT_KEY_FROM_QUERY(sortBy, sortOrder));
    const minPrice = q.get('minPrice') ? Number(q.get('minPrice')) : null;
    const maxPrice = q.get('maxPrice') ? Number(q.get('maxPrice')) : null;
    const priceBand = PRICE_BAND_FROM_QUERY(minPrice, maxPrice);
    const brand = q.get('brand');
    this.currentFilterState.set({ brand, priceBand });
  }

  /** Retry surface for the load-error block. The only browser-side search left:
   * every other path comes back through the route loader. */
  protected retry(): void {
    void this.refetch();
  }

  private async refetch(): Promise<void> {
    this.loading.set(true);
    try {
      const result = await this.searchSvc.search(this.buildQuery());
      this.hits.set(result.data);
      this.totalCount.set(result.meta?.total ?? result.data.length);
      this.hitsError.set(false);
    } catch {
      // Raise the flag rather than emptying the hits: an outage is not a
      // result set of zero (finding C10).
      this.hits.set([]);
      this.totalCount.set(0);
      this.hitsError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  private buildQuery(): SearchProductsQuery {
    const q = this.route.snapshot.queryParamMap;
    const out: SearchProductsQuery = {
      page: q.get('page') ? Number(q.get('page')) : 1,
      pageSize: PAGE_SIZE,
    };
    const trimmed = this.query().trim();
    if (trimmed) out.q = trimmed;
    const sortBy = q.get('sortBy');
    const sortOrder = q.get('sortOrder');
    if (
      sortBy === 'createdAt' ||
      sortBy === 'price' ||
      sortBy === 'name' ||
      sortBy === 'rating' ||
      sortBy === 'relevance'
    ) {
      out.sortBy = sortBy as SearchSortField;
    }
    if (sortOrder === 'asc' || sortOrder === 'desc') out.sortOrder = sortOrder;
    const brand = q.get('brand');
    if (brand) out.brand = brand;
    const minPrice = q.get('minPrice');
    const maxPrice = q.get('maxPrice');
    if (minPrice) out.priceMin = Number(minPrice);
    if (maxPrice) out.priceMax = Number(maxPrice);
    return out;
  }

  private toCardData(hit: SearchHit): ProductCardData {
    const p = hit.product;
    // `/v1/search` rolls the price up onto the product and sends no `variants`
    // array at all, so there is exactly one place to read it from. The chain here
    // used to try `variants[0].price`, then a `priceMin` no serializer has ever
    // sent, then fall through to a literal `0`, which is what production rendered
    // on every card. No price means no price line; see `ProductCardData`.
    const price = p.minPrice != null ? Number(p.minPrice) : null;
    // A search hit carries no variant, so it carries no compare-at price either.
    const compareAt = null;
    const primary = p.primaryAsset ?? p.assets?.find((a) => a.isPrimary) ?? p.assets?.[0];
    const imageSrc = primary?.url || noImageFallback();
    const imageAlt =
      pickTranslation((primary?.altText ?? null) as ResolvedString | null, this.locale()) ||
      pickTranslation(p.name as ResolvedString, this.locale());
    const cardSizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw';
    const imageSources = pictureSourcesFromAssetVariants(primary?.assetVariants, cardSizes);
    return {
      slug: p.slug,
      title: pickTranslation(p.name as ResolvedString, this.locale()),
      href: APP_ROUTES.product(this.locale(), p.slug),
      imageSrc,
      imageAlt,
      imageSources: imageSources.length > 0 ? imageSources : undefined,
      price,
      compareAtPrice: compareAt,
      currency: p.currency ?? this.storeConfig.currencyCode(),
      // The wire names, from `ProductSearchResult`. These were read as
      // `ratingSummary.averageRating` / `.total`, a shape no endpoint sends, so
      // search cards silently lost their stars alongside their price.
      ratingValue: p.avgRating,
      reviewCount: p.reviewCount,
      deliveryEstimate: this.strings().product.delivery.estimate,
      availability: p.availability ?? productAvailability(p.variants),
    };
  }

  private applyMeta(): void {
    const t = this.strings().search;
    const q = this.query().trim();
    const title = q.length > 0 ? t.meta.titleWithQuery.replace('{q}', q) : t.meta.title;
    const canonical = this.canonicalUrl();
    const ogImage = `${this.resolveBaseUrl().replace(/\/$/, '')}${OG_SHARE_CARD}`;
    this.title.setTitle(pageTitle(title, this.strings().brand.name));
    this.upsertNamed('description', t.meta.description);
    this.upsertProperty('og:title', title);
    this.upsertProperty('og:description', t.meta.description);
    this.upsertProperty('og:image', ogImage);
    this.upsertProperty('og:url', canonical);
    this.upsertProperty(
      'og:locale',
      ogLocaleFromLocale(this.locale(), this.storeConfig.seoLocales()),
    );
    this.upsertProperty('og:type', 'website');
    this.upsertNamed('twitter:card', 'summary_large_image');
    this.upsertNamed('twitter:title', title);
    this.upsertNamed('twitter:description', t.meta.description);
    this.upsertNamed('twitter:image', ogImage);
    this.upsertCanonical(canonical);
    this.upsertHreflang(this.hreflangVariants());
  }

  private canonicalUrl(): string {
    const base = this.resolveBaseUrl().replace(/\/$/, '');
    const q = this.query().trim();
    const path = APP_ROUTES.search(this.locale());
    return q ? `${base}${path}?q=${encodeURIComponent(q)}` : `${base}${path}`;
  }

  /**
   * The fifth copy of the hreflang triplet, and the one no audit listed: the
   * other four were in `lib/seo.ts` where a reviewer looking for them would
   * find them, and this one sat in a page component. It derives from the same
   * `locale-region.ts` map as the rest now.
   */
  private hreflangVariants(): { hreflang: string; href: string }[] {
    const q = this.query().trim();
    const suffix = q ? `?q=${encodeURIComponent(q)}` : '';
    return hreflangSet(
      this.resolveBaseUrl(),
      (locale) => `${APP_ROUTES.search(locale)}${suffix}`,
      this.storeConfig.seoLocales(),
    );
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

  private applyJsonLd(): void {
    const head = this.document.head;
    if (!head) return;
    head
      .querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"][data-search-jsonld]')
      .forEach((node) => node.remove());
    const baseUrl = this.resolveBaseUrl();
    const homeUrl = `${baseUrl.replace(/\/$/, '')}/${this.locale()}/`;
    const searchUrl = `${baseUrl.replace(/\/$/, '')}${APP_ROUTES.search(this.locale())}`;
    // BreadcrumbList: home → search. Provides crawlers structural context
    // and satisfies the S13 requirement for ≥1 valid JSON-LD on public routes.
    const breadcrumbScript = this.document.createElement('script');
    breadcrumbScript.setAttribute('type', 'application/ld+json');
    breadcrumbScript.setAttribute('data-search-jsonld', 'true');
    breadcrumbScript.textContent = serializeJsonLd(
      breadcrumbListJsonLd([
        { name: this.strings().nav.home, url: homeUrl },
        { name: this.strings().search.breadcrumb.search, url: searchUrl },
      ]),
    );
    head.appendChild(breadcrumbScript);

    // ItemList over the hits when the user has issued a query — closes
    // the SSR contract row at `agent_docs/storefront/seo-geo.md` line 167
    // (`/{locale}/search?q=...` requires `BreadcrumbList + ItemList (results)`).
    // Bare `/search` ships BreadcrumbList only; the empty-state surface has
    // no enumerable result set to summarise.
    const q = this.query().trim();
    const hits = this.hits();
    if (q && hits.length > 0) {
      const itemListScript = this.document.createElement('script');
      itemListScript.setAttribute('type', 'application/ld+json');
      itemListScript.setAttribute('data-search-jsonld', 'true');
      itemListScript.textContent = serializeJsonLd(
        itemListJsonLd(
          hits.map((h) => ({
            slug: h.product.slug,
            name: pickTranslation(h.product.name as ResolvedString, this.locale()),
          })),
          this.locale(),
          baseUrl,
        ),
      );
      head.appendChild(itemListScript);
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
}
