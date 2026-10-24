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

import { ProductsService } from '@storefront-services';
import type { BrandFacet, ListProductsQuery, ProductSummary } from '@storefront-types';
import { pickTranslation, type ResolvedString } from '@storefront-types';

import { groupSpecTokens, readSpecParam } from '../../../../lib/catalog-filters';
import { resultsCountLabel } from '../../../../lib/catalog-copy';
import type { load } from './index.server';

import { BreadcrumbComponent, type BreadcrumbItem } from '../../../ui/breadcrumb.component';
import { LocaleService } from '../../../locale.service';
import { APP_ROUTES } from '../../../../lib/routes';
import { pictureSourcesFromAssetVariants } from '../../../../lib/asset-variant';
import { noImageFallback } from '../../../../lib/no-image';
import { productAvailability } from '../../../../lib/availability';
import {
  breadcrumbListJsonLd,
  itemListJsonLd,
  pageTitle,
  serializeJsonLd,
  staticPageMetaTags,
} from '../../../../lib/seo';
import { upsertPropertyMulti } from '../../../../lib/meta-dom';
import { CategoryBarComponent } from '../../../sections/catalog/category-bar.component';
import {
  FilterRailComponent,
  type CatalogFilterChange,
  type CatalogFilterState,
  type CatalogSpecFacet,
  type CatalogPriceBand,
} from '../../../sections/catalog/filter-rail.component';
import { ProductGridComponent } from '../../../sections/catalog/product-grid.component';
import {
  SortControlComponent,
  type CatalogSortChange,
  type CatalogSortKey,
} from '../../../sections/catalog/sort-control.component';
import type { ProductCardData } from '../../../ui/product-card.component';
import { catalogSortKeyFromQuery, resolveCatalogSort } from '../../../../lib/catalog-sort';
import { StoreConfigService } from '../../../services/store-config.service';

/**
 * Cap on sequential page fetches issued during deep-link restoration. Beyond
 * this the customer scrolls to load more — bounds the cost of `?page=999`.
 */
const MAX_RESTORE_PAGES = 10;
const PAGE_SIZE = 24;

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

/**
 * Bare `/catalog` (no slug) — browse-all surface anchored by the same
 * `<catalog-category-bar>` strip the per-category page renders. Mirrors
 * `[slug].page.ts` minus the category fetch, breadcrumb leaf, and JSON-LD
 * (the category-scoped page owns the category-aware structured data).
 */
@Component({
  selector: 'app-catalog-index-page',
  standalone: true,
  imports: [
    BreadcrumbComponent,
    CategoryBarComponent,
    FilterRailComponent,
    ProductGridComponent,
    SortControlComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-breadcrumb [items]="breadcrumb()" [ariaLabel]="strings().catalog.breadcrumb.navLabel" />

      <catalog-category-bar [activeSlug]="null" />

      <header class="header">
        <h1 class="title">{{ strings().catalog.pageTitle }}</h1>
        @if (totalCount() > 0) {
          <p class="results">{{ resultsCount() }}</p>
        }
      </header>

      <div class="grid-shell">
        <aside class="rail" [attr.aria-label]="strings().catalog.filters.title">
          <catalog-filter-rail
            [brands]="availableBrands()"
            [specFacets]="specFacets()"
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
          <catalog-product-grid
            [items]="cardItems()"
            [loading]="loading()"
            [loadingMore]="loadingMore()"
            [hasMore]="hasMore()"
            (loadMore)="onLoadMore()"
          />
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
export default class CatalogIndexPage implements OnInit {
  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly productsSvc = inject(ProductsService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;

  /**
   * SH4 — seed page 1 from the page server endpoint payload exported by the
   * sibling `index.server.ts` companion. Closes AC-5 (catalog landing) by
   * populating the product grid on the SSR pass. Mirrors SH2/SH3.
   */
  protected readonly loaded = toSignal(injectLoad<typeof load>(), { requireSync: true });

  protected readonly products = signal<ProductSummary[]>(this.loaded().products);
  protected readonly totalCount = signal<number>(this.loaded().totalCount);
  protected readonly loading = signal<boolean>(false);
  /** True while page N>1 is being appended; cards stay rendered. */
  protected readonly loadingMore = signal<boolean>(false);
  /** Last-rendered page number — drives the URL `?page` on every append. */
  protected readonly currentPage = signal<number>(1);
  /** Computed from total — `false` collapses the load-more sentinel. */
  protected readonly hasMore = computed(() => this.products().length < this.totalCount());
  /**
   * Monotonic counter. Every fetch captures the value at issue; commits only
   * when the value still matches. Filter / sort / slug changes bump the
   * counter and so invalidate any in-flight page-N fetch.
   */
  private requestSeq = 0;

  protected readonly currentSortKey = signal<CatalogSortKey>('newest');
  /**
   * Filterable specifications. Fetched rather than hardcoded, because the rule
   * is that any specification an operator adds becomes a filter on its own once
   * enough products share it. Soft-fails to an empty rail: a facet outage must
   * not take the catalogue down with it.
   */
  protected readonly specFacets = signal<CatalogSpecFacet[]>(
    (this.loaded().specFacets ?? []) as CatalogSpecFacet[],
  );

  /**
   * The payload the field initialisers above already seeded. The effect below
   * skips it so the deep-link restore started in `ngOnInit` is not cancelled by
   * the effect's own first run.
   */
  private seededPayload = this.loaded();

  protected readonly currentFilterState = signal<CatalogFilterState>({
    brand: null,
    priceBand: null,
  });

  protected readonly String = String;

  /**
   * Brand facets from the API, not from the products on screen.
   *
   * Deriving them from `products()` meant a page-1 sample of the already
   * filtered result, so choosing a brand collapsed the rail to that brand and
   * the shopper could not switch without clearing (finding C11).
   */
  protected readonly brandFacets = signal<BrandFacet[]>(this.loaded().brandFacets ?? []);
  protected readonly availableBrands = computed(() => this.brandFacets().map((f) => f.brand));

  protected readonly resultsCount = computed(() =>
    resultsCountLabel(this.totalCount(), this.strings()),
  );

  protected readonly cardItems = computed<ProductCardData[]>(() =>
    this.products().map((p) => this.toCardData(p)),
  );

  protected readonly breadcrumb = computed<BreadcrumbItem[]>(() => {
    const baseLabel = this.strings().catalog.breadcrumb;
    return [
      { label: baseLabel.home, href: APP_ROUTES.home(this.locale()) },
      { label: baseLabel.catalog },
    ];
  });

  constructor() {
    /**
     * Findings C1 and C7. The route re-resolves its loader on every query-param
     * change (`runGuardsAndResolvers: 'paramsOrQueryParamsChange'`), so the
     * payload that lands after a filter or sort gesture is already filtered.
     * The page used to seed once and then refetch from `route.snapshot`, which
     * still held the pre-navigation params, so the grid was overwritten with
     * yesterday's filters. The loader is the only writer now.
     *
     * An `effect()` rather than a direct `subscribe`: the title strategy runs
     * between route activation and `NavigationEnd`, so a synchronous re-apply
     * of the meta would be overwritten by the strategy's home title (C2).
     */
    effect(() => {
      const payload = this.loaded();
      if (payload === this.seededPayload) return;
      this.seededPayload = payload;
      this.requestSeq += 1;
      this.products.set(payload.products);
      this.totalCount.set(payload.totalCount);
      this.specFacets.set((payload.specFacets ?? []) as CatalogSpecFacet[]);
      this.brandFacets.set(payload.brandFacets ?? []);
      this.currentPage.set(1);
      this.loadingMore.set(false);
      this.loading.set(false);
      this.readQueryParams();
      this.applyMeta();
      this.applyJsonLd();
    });
  }

  ngOnInit(): void {
    this.readQueryParams();
    // SSR already carries them in the common case; this covers a client-side
    // navigation into the page, where no loader ran.
    if (this.specFacets().length === 0) void this.loadSpecFacets();
    // Apply OG meta + canonical synchronously on both SSR and browser passes.
    // The data is always present (seeded from the SSR payload); no `if` guard.
    // Per `ssr-data-loading.md` § Migration checklist: applyMeta() call goes
    // here, not inside an effect(), so it fires once per render.
    this.applyMeta();
    this.applyJsonLd();
    if (!isPlatformBrowser(this.platformId)) return;
    // Page 1 is seeded from the SSR payload. For deep-link `?page=N>1` the
    // browser still needs to fetch pages 2..N to restore the scroll depth;
    // restoreUpToPage() starts from page 2 because page 1 is already in
    // `products()`.
    const pageParam = this.route.snapshot.queryParamMap.get('page');
    const requested = pageParam ? Math.max(1, Number(pageParam) || 1) : 1;
    if (requested > 1) {
      void this.restoreFromPage2(requested);
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

  private absoluteUrl(baseUrl: string, path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const rest = path.startsWith('/') ? path : `/${path}`;
    return `${base}${rest}`;
  }

  /**
   * SSR contract per `agent_docs/storefront/seo-geo.md` `## SSR contract`
   * row 164 — emits `BreadcrumbList` (home → catalog) plus `ItemList` over
   * the SSR-seeded page-1 products. JS-less crawlers (every AI crawler in
   * the allowlist, Bingbot, every social-share scraper) read the populated
   * structured data on first byte. Mirrors the pattern shipped in
   * `catalog/[slug].page.ts:559` for category-detail JSON-LD.
   *
   * `data-catalog-jsonld` flag scopes the cleanup-and-re-emit selector so a
   * subsequent browser-side filter / sort refetch (which never lands new
   * products into the grid before the user explicitly applies a control)
   * does not stack duplicate JSON-LD nodes.
   */
  private applyJsonLd(): void {
    const head = this.document.head;
    if (!head) return;
    head
      .querySelectorAll<HTMLScriptElement>(
        'script[type="application/ld+json"][data-catalog-jsonld]',
      )
      .forEach((node) => node.remove());
    const baseUrl = this.resolveBaseUrl();

    const breadcrumbItems = [
      {
        name: this.strings().catalog.breadcrumb.home,
        url: this.absoluteUrl(baseUrl, APP_ROUTES.home(this.locale())),
      },
      {
        name: this.strings().catalog.breadcrumb.catalog,
        url: this.absoluteUrl(baseUrl, '/' + this.locale() + '/catalog'),
      },
    ];
    const breadcrumbScript = this.document.createElement('script');
    breadcrumbScript.setAttribute('type', 'application/ld+json');
    breadcrumbScript.setAttribute('data-catalog-jsonld', 'true');
    breadcrumbScript.textContent = serializeJsonLd(breadcrumbListJsonLd(breadcrumbItems));
    head.appendChild(breadcrumbScript);

    const items = this.products();
    if (items.length > 0) {
      const itemListScript = this.document.createElement('script');
      itemListScript.setAttribute('type', 'application/ld+json');
      itemListScript.setAttribute('data-catalog-jsonld', 'true');
      itemListScript.textContent = serializeJsonLd(
        itemListJsonLd(
          items.map((p) => ({
            slug: p.slug,
            name: pickTranslation(p.name as ResolvedString, this.locale()),
          })),
          this.locale(),
          baseUrl,
        ),
      );
      head.appendChild(itemListScript);
    }
  }

  private applyMeta(): void {
    const locale = this.locale();
    const strings = this.strings();
    const baseUrl = this.resolveBaseUrl();
    const tags = staticPageMetaTags({
      locale,
      baseUrl,
      locales: this.storeConfig.seoLocales(),
      identity: this.localeService.chromeIdentity(),
      path: '/catalog',
      title: strings.catalog.meta.title,
      description: strings.catalog.meta.description,
    });
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
    this.upsertCanonical(tags.canonical);
    this.upsertHreflang(tags.hreflang);
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

  protected onSortChange(change: CatalogSortChange): void {
    this.currentSortKey.set(change.key);
    this.navigateToQuery({
      sortBy: change.sortBy,
      sortOrder: change.sortOrder,
      page: 1,
    });
  }

  protected onFilterChange(change: CatalogFilterChange): void {
    this.currentFilterState.set({
      brand: change.brand,
      priceBand: change.priceBand,
      specs: groupSpecTokens(change.specs),
    });
    this.navigateToQuery({
      brand: change.brand,
      minPrice: change.minPrice,
      maxPrice: change.maxPrice,
      // A single comma-joined param, not one per specification: the API client
      // serialises a Record<string, scalar>, so an array would stringify by
      // accident. Null clears it without disturbing the other params under
      // queryParamsHandling 'merge'.
      specs: change.specs.length ? change.specs.join(',') : null,
      page: 1,
    });
  }

  /**
   * Navigate to the new query string and let the resolver deliver the grid.
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

  /** "certification:ce-iso" tokens -> { certification: ['ce-iso'] }. */
  private async loadSpecFacets(): Promise<void> {
    try {
      this.specFacets.set((await this.productsSvc.specFacets()) as CatalogSpecFacet[]);
    } catch {
      this.specFacets.set([]);
    }
  }

  protected onLoadMore(): void {
    void this.loadNextPage();
  }

  private readQueryParams(): void {
    const q = this.route.snapshot.queryParamMap;
    const sortBy = q.get('sortBy') ?? undefined;
    const sortOrder = q.get('sortOrder') ?? undefined;
    this.currentSortKey.set(catalogSortKeyFromQuery(sortBy, sortOrder));
    const minPrice = q.get('minPrice') ? Number(q.get('minPrice')) : null;
    const maxPrice = q.get('maxPrice') ? Number(q.get('maxPrice')) : null;
    const priceBand = PRICE_BAND_FROM_QUERY(minPrice, maxPrice);
    const brand = q.get('brand');
    this.currentFilterState.set({
      brand,
      priceBand,
      specs: readSpecParam(q.get('specs')),
    });
  }

  /**
   * Append the next page beneath the current grid. Guarded against re-entry
   * and against stale appends via `requestSeq`. URL `?page` updated via
   * `history.replaceState` so back-nav restores the same scroll depth without
   * triggering a router re-fetch.
   */
  private async loadNextPage(): Promise<void> {
    if (!this.hasMore() || this.loading() || this.loadingMore()) return;
    const seq = ++this.requestSeq;
    const nextPage = this.currentPage() + 1;
    this.loadingMore.set(true);
    try {
      const result = await this.productsSvc.list(this.buildListQuery(nextPage));
      if (seq !== this.requestSeq) return;
      this.products.update((prev) => [...prev, ...result.data]);
      this.totalCount.set(result.meta.total ?? this.totalCount());
      this.currentPage.set(nextPage);
      this.replacePageInUrl(nextPage);
    } catch {
      // Append failure leaves the existing items untouched. The customer can
      // retry via the fallback button or by scrolling again once the next
      // intersection event fires.
    } finally {
      if (seq === this.requestSeq) this.loadingMore.set(false);
    }
  }

  /**
   * Deep-link restoration starting from page 2. Page 1 is already seeded from
   * the SSR payload, so this only fetches the remaining pages 2..min(N, MAX).
   * Race-guarded so a filter change mid-restore aborts cleanly.
   */
  private async restoreFromPage2(target: number): Promise<void> {
    const cap = Math.min(target, MAX_RESTORE_PAGES);
    if (cap < 2) return;
    const seq = ++this.requestSeq;
    this.loadingMore.set(true);
    try {
      for (let page = 2; page <= cap; page += 1) {
        const result = await this.productsSvc.list(this.buildListQuery(page));
        if (seq !== this.requestSeq) return;
        this.products.update((prev) => [...prev, ...result.data]);
        this.totalCount.set(result.meta.total ?? this.totalCount());
        this.currentPage.set(page);
        if (this.products().length >= this.totalCount()) break;
      }
      if (seq !== this.requestSeq) return;
      this.replacePageInUrl(this.currentPage());
    } catch {
      // Restore failure leaves whatever pages did land in place.
    } finally {
      if (seq === this.requestSeq) this.loadingMore.set(false);
    }
  }

  private buildListQuery(page: number): ListProductsQuery {
    const q = this.route.snapshot.queryParamMap;
    const query: ListProductsQuery = { page, pageSize: PAGE_SIZE };
    // Always send a sort. Unset, the API falls back to `sortOrder asc` over
    // rows that all have sortOrder 0, so the grid order is unspecified while
    // the select still reads "Newest" (finding C7).
    const sort = resolveCatalogSort(q.get('sortBy'), q.get('sortOrder'));
    query.sortBy = sort.sortBy;
    query.sortOrder = sort.sortOrder;
    const brand = q.get('brand');
    if (brand) query.brand = brand;
    const minPrice = q.get('minPrice');
    const maxPrice = q.get('maxPrice');
    if (minPrice) query.minPrice = Number(minPrice);
    if (maxPrice) query.maxPrice = Number(maxPrice);
    const specs = q.get('specs');
    if (specs) query.specs = specs;
    return query;
  }

  private replacePageInUrl(page: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist || typeof hist.replaceState !== 'function') return;
    const url = new URL(loc.href);
    url.searchParams.set('page', String(page));
    hist.replaceState(hist.state, '', `${url.pathname}${url.search}${url.hash}`);
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
    const compareAt = variant?.compareAtPrice != null ? Number(variant.compareAtPrice) : null;
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
      compareAtPrice: compareAt,
      currency: p.currency ?? this.storeConfig.currencyCode(),
      deliveryEstimate: this.strings().product.delivery.estimate,
      availability: productAvailability(p.variants),
    };
  }
}
