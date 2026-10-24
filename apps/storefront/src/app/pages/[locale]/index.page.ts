import { DOCUMENT, isPlatformBrowser, isPlatformServer, NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
  type Type,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { injectLoad } from '@analogjs/router';

import {
  pickTranslation,
  type Category,
  type ProductSummary,
  type StorefrontSection,
} from '@storefront-types';

import type { load } from './index.server';

import { LocaleService } from '../../locale.service';
import { StoreConfigService } from '../../services/store-config.service';
import { isLocale } from '../../../i18n/types';
import {
  breadcrumbListJsonLd,
  homeMetaTags,
  organizationJsonLd,
  type StoreIdentityInput,
  pageTitle,
  serializeJsonLd,
  websiteJsonLd,
} from '../../../lib/seo';
import { upsertPropertyMulti } from '../../../lib/meta-dom';
import { pictureSourcesFromAssetVariants } from '../../../lib/asset-variant';
import { resolveSectionCtaOrCatalog } from '../../../lib/section-cta';
import { SECTION_COMPONENT_MAP } from '../../../lib/section-component-map';

import type { CampaignCopy, CampaignTone } from '../../sections/home/campaign-banner.component';
import type { HeroCopy } from '../../sections/home/hero-banner.component';
import type { TrustPillar } from '../../sections/home/trust-strip.component';
import { buildStoreIdentity } from '../../../lib/store-identity';

/**
 * S5 home page extended in S20 (DR-04 / DR-05) with operator-managed
 * `StorefrontSection` rows. S21 made dynamic dispatch the default render and
 * kept a `STOREFRONT_DYNAMIC_SECTIONS` build-time escape hatch for one
 * release; plan B Phase B1 retired the flag and the locale-keyed legacy panels
 * it guarded, so this is now the only render path.
 *
 * `SectionsService.getByPageSlug('home')` drives the page through the loader:
 * HERO copy + asset URLs come from the row's resolved `config`, TRUST_SIGNALS
 * pillars from the row's `config.items`, and curated CATEGORY_SHOWCASE /
 * FEATURED_PRODUCTS rails from the ids the loader resolved.
 * Every configured row dispatches: phase B8 rebuilt the PROMOTIONAL_BANNER
 * surface, so no type is dropped on the way in any more.
 *
 * The `SECTION_COMPONENT_MAP` import enforces the SSOT contract: a new
 * `SectionType` value cannot land in `@storefront-types` without a matching
 * entry in `apps/storefront/src/lib/section-component-map.ts` (DR-05).
 */
@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @for (section of sections(); track section.id) {
        <ng-container *ngComponentOutlet="componentFor(section); inputs: inputsFor(section)" />
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        background-color: var(--brand-bg);
      }
      .page {
        display: flex;
        flex-direction: column;
        gap: clamp(2rem, 5vw, 3.5rem);
        max-inline-size: 1400px;
        margin-inline: auto;
        padding-block: clamp(1.5rem, 4vw, 3rem);
        padding-inline: clamp(1rem, 4vw, 2rem);
      }
    `,
  ],
})
export default class HomePage implements OnInit {
  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;

  /**
   * SH3 — seed every primary signal from the page server endpoint payload
   * exported by the sibling `index.server.ts` companion. Mirrors the SH2
   * product detail wiring; closes Defect B (empty-section flash on first
   * paint) by populating the rails on the SSR pass.
   */
  protected readonly loaded = toSignal(injectLoad<typeof load>(), {
    requireSync: true,
  });

  protected readonly categories = signal<Category[]>(this.loaded().categories);
  protected readonly sections = signal<StorefrontSection[]>(this.loaded().sections);
  /** Products fetched by id for curated FEATURED_PRODUCTS rails (decoupled from the pools). */
  protected readonly featured = signal<ProductSummary[]>(this.loaded().featured);

  /**
   * Per-section component input map. Keyed off the discriminated `type` so
   * TypeScript narrows the `config` shape without runtime casts. `Record`
   * return type so `*ngComponentOutlet` accepts it.
   */
  protected inputsFor(section: StorefrontSection): Record<string, unknown> {
    const loc = this.locale();
    switch (section.type) {
      case 'HERO': {
        const cfg = section.config;
        const copy: HeroCopy = {
          eyebrow: pickTranslation(cfg.eyebrow, loc),
          headline: pickTranslation(cfg.headline, loc),
          body: pickTranslation(cfg.body, loc),
          cta: pickTranslation(cfg.cta, loc),
          ctaLink: resolveSectionCtaOrCatalog(cfg.ctaHref, loc),
          imageAlt: cfg.imageAlt
            ? pickTranslation(cfg.imageAlt, loc)
            : pickTranslation(cfg.headline, loc),
          imageUrl: cfg.assetUrl ?? null,
          imageSources: pictureSourcesFromAssetVariants(
            cfg.assetVariants,
            '(max-width: 768px) 100vw, 40vw',
          ),
        };
        return { copy };
      }
      case 'PROMOTIONAL_BANNER': {
        const cfg = section.config;
        const copy: CampaignCopy = {
          eyebrow: pickTranslation(cfg.eyebrow, loc),
          headline: pickTranslation(cfg.headline, loc),
          body: pickTranslation(cfg.body, loc),
          cta: cfg.cta ? pickTranslation(cfg.cta, loc) : '',
          ctaLink: resolveSectionCtaOrCatalog(cfg.ctaHref, loc),
          imageAlt: cfg.imageAlt
            ? pickTranslation(cfg.imageAlt, loc)
            : pickTranslation(cfg.headline, loc),
          imageUrl: cfg.assetUrl ?? null,
          imageSources: pictureSourcesFromAssetVariants(
            cfg.assetVariants,
            '(max-width: 767px) 100vw, 33vw',
          ),
        };
        return { copy, tone: this.bannerTone(section.id), headingId: `home-promo-${section.id}` };
      }
      case 'CATEGORY_SHOWCASE': {
        const cfg = section.config;
        const title = cfg.heading
          ? pickTranslation(cfg.heading, loc)
          : section.title
            ? pickTranslation(section.title, loc)
            : null;
        // Honour the operator's curated `categoryIds` selection, and only that.
        // Preserve the configured order so the admin's drag-order in the editor
        // matches the customer-visible order on /home. When nothing resolves the
        // grid renders its own empty state (S3): substituting the full category
        // list here made config rot invisible to the operator.
        const allCategories = this.categories();
        const configuredIds = Array.isArray(cfg.categoryIds) ? cfg.categoryIds : [];
        const byId = new Map(allCategories.map((c) => [c.id, c]));
        const curated = configuredIds
          .map((id) => byId.get(id))
          .filter((c): c is (typeof allCategories)[number] => c !== undefined);
        return {
          categories: curated,
          title,
          headingId: `home-categories-${section.id}`,
        };
      }
      case 'FEATURED_PRODUCTS': {
        const cfg = section.config;
        // Honour the operator's curated `productIds` selection, and only that.
        // The loader fetches exactly those ids into `featured()`, so resolution
        // needs no pool. When nothing resolves the rail renders its own empty
        // state (S3): falling back to a whole pool dressed config rot up as a
        // full rail of products the operator never picked.
        const allProducts = this.featured();
        const byId = new Map(allProducts.map((p) => [p.id, p]));
        const configuredIds = Array.isArray(cfg.productIds) ? cfg.productIds : [];
        const products = configuredIds
          .map((id) => byId.get(id))
          .filter((p): p is (typeof allProducts)[number] => p !== undefined);
        // Same precedence as CATEGORY_SHOWCASE above: the operator's config
        // heading wins, the envelope title is the fallback. The two types used
        // to disagree, so a merchant who filled the config fields got a rail
        // titled from the envelope, or an untitled one.
        const title = cfg.heading
          ? pickTranslation(cfg.heading, loc)
          : section.title
            ? pickTranslation(section.title, loc)
            : '';
        return {
          title,
          eyebrow: cfg.eyebrow ? pickTranslation(cfg.eyebrow, loc) : null,
          products,
          variant: cfg.variant,
          testId: `home-featured-${section.id}`,
          idSuffix: `featured-${section.id}`,
        };
      }
      case 'TRUST_SIGNALS': {
        const pillars: TrustPillar[] = section.config.items.map((it) => ({
          kind: it.kind,
          title: pickTranslation(it.title, loc),
          subtitle: pickTranslation(it.subtitle, loc),
        }));
        return {
          pillars,
          title: section.title ? pickTranslation(section.title, loc) : null,
          headingId: `home-trust-${section.id}`,
        };
      }
      default: {
        const _exhaustive: never = section;
        return _exhaustive;
      }
    }
  }

  /**
   * A large flat primary fill is reserved for a single banner per
   * page, and `brand-auditor` fails a second one. The first PROMOTIONAL_BANNER
   * in sort order therefore takes the band, and any further one renders quiet
   * on so two configured rows cannot put the page into a violation.
   */
  private bannerTone(sectionId: string): CampaignTone {
    const first = this.sections().find((s) => s.type === 'PROMOTIONAL_BANNER');
    return first?.id === sectionId ? 'band' : 'quiet';
  }

  protected componentFor(section: StorefrontSection): Type<unknown> {
    return SECTION_COMPONENT_MAP[section.type];
  }

  ngOnInit(): void {
    if (!isLocale(this.locale())) {
      throw new Error(`HomePage: unsupported locale ${this.locale()}`);
    }
    /**
     * SH3 — meta + JSON-LD apply synchronously after signal seeding (per
     * `agent_docs/storefront/ssr-data-loading.md` `## Per-page recipe` +
     * clarifications Q-2). The constructor `effect()` previously fired twice
     * (once on SSR, once on browser hydrate); with the load payload seeded
     * by the time `ngOnInit` runs, both calls emit complete tags on the SSR
     * pass and the browser hydrate matches byte-for-byte.
     */
    this.applyMeta();
    this.applyJsonLd();
  }

  /**
   * The operator-configured half of the Organization payload (finding D4).
   * Empty until the config resolves, which emits exactly the payload this page
   * emitted before the config endpoint existed.
   */
  private storeIdentity(): StoreIdentityInput {
    return buildStoreIdentity(this.storeConfig, this.localeService.chromeIdentity());
  }

  private applyJsonLd(): void {
    const head = this.document.head;
    if (!head) return;
    head
      .querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"][data-home-jsonld]')
      .forEach((node) => node.remove());
    const baseUrl = this.resolveBaseUrl();
    const homeUrl = `${baseUrl.replace(/\/$/, '')}/${this.locale()}/`;
    const payloads = [
      organizationJsonLd(this.locale(), baseUrl, this.storeIdentity()),
      websiteJsonLd(this.locale(), baseUrl, this.localeService.chromeIdentity()),
      breadcrumbListJsonLd([{ name: this.strings().nav.home, url: homeUrl }]),
    ];
    for (const payload of payloads) {
      const script = this.document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      script.setAttribute('data-home-jsonld', 'true');
      script.textContent = serializeJsonLd(payload);
      head.appendChild(script);
    }
  }

  private applyMeta(): void {
    const tags = homeMetaTags({
      locale: this.locale(),
      baseUrl: this.resolveBaseUrl(),
      locales: this.storeConfig.seoLocales(),
      identity: this.localeService.chromeIdentity(),
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
