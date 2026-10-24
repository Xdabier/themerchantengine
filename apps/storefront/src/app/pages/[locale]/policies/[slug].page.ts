import { DOCUMENT, isPlatformBrowser, isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  effect,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { injectLoad } from '@analogjs/router';

import { LocaleService } from '../../../locale.service';
import {
  breadcrumbListJsonLd,
  pageTitle,
  serializeJsonLd,
  staticPageMetaTags,
  stripHtml,
} from '../../../../lib/seo';
import { upsertPropertyMulti } from '../../../../lib/meta-dom';

import type { load } from './[slug].server';
import { StoreConfigService } from '../../../services/store-config.service';

const DEFAULT_BASE_URL = 'http://localhost:53300';

/**
 * `/{locale}/policies/{slug}` — CMS-backed SSR policy pages. Slug is
 * allowlisted to exactly four values (`privacy` / `returns` / `terms` /
 * `shipping`) per `apps/storefront/src/lib/routes.ts`. Unknown slugs are
 * 404-rejected by the sibling `[slug].server.ts` companion before any API
 * call; the `[locale]/[...not-found].page.ts` shell renders the brand-voiced
 * not-found surface.
 *
 * Renders a `<section>` (region role via aria-labelledby) inside LayoutShell's
 * `<main>`. LayoutShell unconditionally wraps every route in `<main>`, so the
 * page must NOT also emit `<main>` (double-main landmark fails axe
 * `landmark-one-main`).
 *
 * Title + content come from `GET /v1/pages/:cmsSlug` via the storefront → CMS
 * slug map declared in the `.server.ts` companion (per clarifications §1.20).
 * The API resolves Translatable JSONB to plain strings per inbound
 * `Accept-Language`, so the component reads `loaded.page.title` / `.content`
 * directly without `pickTranslation()` work.
 */
@Component({
  selector: 'app-policy-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="frame" aria-labelledby="policy-heading">
      <h1 id="policy-heading" class="heading">{{ heading() }}</h1>
      <!-- Admin authors content via @admin-ui TranslatableRichTextComponent
           which produces sanitized HTML (sanitizeRichTextHtml at write time).
           Render through Angular's default sanitiser via [innerHTML] so the
           native paragraph / list / heading structure preserves AT navigation
           and visual rhythm. Plain-text legacy content renders unchanged
           because text nodes are sanitiser-safe. -->
      <!-- innerhtml-approved: admin-authored rich text, sanitized on write by sanitizeRichTextHtml against a safe-tag allowlist (constitution 3.5); Angular sanitizes again on render. No bypassSecurityTrust* involved. -->
      <div class="body rich-text-content" [innerHTML]="body()"></div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        background-color: var(--brand-bg);
        color: var(--brand-text);
        min-block-size: 100dvh;
      }
      .frame {
        max-inline-size: 720px;
        margin-inline: auto;
        padding-block: clamp(3rem, 8vw, 6rem);
        padding-inline: clamp(1rem, 4vw, 2rem);
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }
      .heading {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        line-height: 1.2;
      }
      .body {
        margin: 0;
        font-size: var(--brand-text-body);
        line-height: 1.7;
      }
    `,
  ],
})
export default class PolicyPage implements OnInit {
  private readonly storeConfig = inject(StoreConfigService);
  private readonly localeService = inject(LocaleService);
  private readonly metaSvc = inject(Meta);
  private readonly titleSvc = inject(Title);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly locale = this.localeService.locale;

  /**
   * SH5 — seed CMS payload synchronously from the page server endpoint
   * exported by the sibling `[slug].server.ts` companion. `requireSync: true`
   * errors loudly if Analog's contract ever shifts (mirrors SH2 / SH3 / SH4).
   */
  protected readonly loaded = toSignal(injectLoad<typeof load>(), { requireSync: true });

  protected readonly slug = computed(() => this.loaded().slug);
  protected readonly heading = computed(() => this.loaded().page.title);
  protected readonly body = computed(() => this.loaded().page.content);
  /**
   * The payload already applied, skipped by the re-apply effect so the first
   * run is not a redundant rewrite of the SSR-emitted tags.
   */
  private seededPayload = this.loaded();

  protected readonly tags = computed(() => {
    const page = this.loaded().page;
    // One strip, shared with the product and category meta builders. The
    // duplicated regex here decoded no entities, so an "&amp;" in the body
    // reached the crawler escaped twice.
    const fallbackDescription = stripHtml(page.content).slice(0, 200).trim();
    return staticPageMetaTags({
      locale: this.locale(),
      baseUrl: this.resolveBaseUrl(),
      locales: this.storeConfig.seoLocales(),
      identity: this.localeService.chromeIdentity(),
      path: `/policies/${this.slug()}`,
      title: page.metaTitle ?? page.title,
      description: page.metaDescription ?? fallbackDescription,
    });
  });

  constructor() {
    /**
     * Finding N5. The footer links policy to policy, which Analog resolves by
     * re-running this route's loader. The heading and body are computeds over
     * that payload so they already followed it, but title, canonical, hreflang,
     * the OG block and the JSON-LD applied once in `ngOnInit` and went stale.
     *
     * An `effect()` rather than a `paramMap` subscription: the title strategy
     * runs between route activation and `NavigationEnd`, so a synchronous
     * re-apply would be overwritten by the strategy's own title.
     */
    effect(() => {
      const payload = this.loaded();
      if (payload === this.seededPayload) return;
      this.seededPayload = payload;
      this.applyMeta();
    });
  }

  ngOnInit(): void {
    /**
     * SH5 — meta application runs synchronously in `ngOnInit` against the
     * SSR-seeded `loaded` payload (per `agent_docs/storefront/ssr-data-loading.md`
     * `## Per-page recipe` + clarifications Q-2).
     */
    this.applyMeta();
  }

  private applyMeta(): void {
    const t = this.tags();
    this.titleSvc.setTitle(pageTitle(t.title, this.localeService.strings().brand.name));
    this.metaSvc.updateTag({ name: 'description', content: t.description });
    this.metaSvc.updateTag({ property: 'og:title', content: t.og.title });
    this.metaSvc.updateTag({ property: 'og:description', content: t.og.description });
    this.metaSvc.updateTag({ property: 'og:url', content: t.og.url });
    this.metaSvc.updateTag({ property: 'og:locale', content: t.og.locale });
    upsertPropertyMulti(this.document, 'og:locale:alternate', t.og.localeAlternate);
    this.metaSvc.updateTag({ property: 'og:type', content: t.og.type });
    this.metaSvc.updateTag({ property: 'og:image', content: t.og.image });
    this.metaSvc.updateTag({ name: 'twitter:card', content: t.twitter.card });
    this.metaSvc.updateTag({ name: 'twitter:title', content: t.twitter.title });
    this.metaSvc.updateTag({ name: 'twitter:description', content: t.twitter.description });
    this.metaSvc.updateTag({ name: 'twitter:image', content: t.twitter.image });
    this.upsertCanonical(t.canonical);
    this.upsertHreflang(t.hreflang);
    this.applyJsonLd();
  }

  /**
   * Emit `BreadcrumbList` JSON-LD per `agent_docs/storefront/seo-geo.md`
   * `## SSR contract` row for `/{locale}/policies/{slug}`. Chains
   * home → policies → policy slug, locale-prefixed.
   */
  private applyJsonLd(): void {
    const head = this.document.head;
    if (!head) return;
    head
      .querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"][data-policy-jsonld]')
      .forEach((node) => node.remove());
    const locale = this.locale();
    const slug = this.slug();
    const baseUrl = this.resolveBaseUrl();
    const strings = this.localeService.strings();
    const homeUrl = `${baseUrl.replace(/\/$/, '')}/${locale}/`;
    const policyUrl = `${baseUrl.replace(/\/$/, '')}/${locale}/policies/${slug}`;
    const payload = breadcrumbListJsonLd([
      { name: strings.nav.home, url: homeUrl },
      { name: this.loaded().page.title, url: policyUrl },
    ]);
    const script = this.document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.setAttribute('data-policy-jsonld', 'true');
    script.textContent = serializeJsonLd(payload);
    head.appendChild(script);
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

  /**
   * Mirrors the guarded pattern in `index.page.ts` / `catalog/index.page.ts` /
   * `catalog/[slug].page.ts` / `catalog/product/[slug].page.ts` /
   * `search/index.page.ts`: `process` is a Node global and is undefined in
   * the browser bundle (`vite.config.ts` `define` does not shim it), so a
   * bare `process.env[...]` read throws `ReferenceError: process is not
   * defined` the moment this runs client-side (every `ngOnInit`, hydrated or
   * not). This page and the sibling `about.page.ts` were the two SH5-era
   * pages that never picked up the platform guard the rest of the SEO
   * surface already uses.
   */
  private resolveBaseUrl(): string {
    if (isPlatformBrowser(this.platformId)) {
      return globalThis.location?.origin ?? DEFAULT_BASE_URL;
    }
    if (isPlatformServer(this.platformId) && typeof process !== 'undefined') {
      return process.env['STOREFRONT_PUBLIC_BASE_URL'] ?? DEFAULT_BASE_URL;
    }
    return DEFAULT_BASE_URL;
  }
}
