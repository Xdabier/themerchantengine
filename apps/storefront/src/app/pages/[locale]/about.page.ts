import { DOCUMENT, isPlatformBrowser, isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { injectLoad } from '@analogjs/router';

import { LocaleService } from '../../locale.service';
import { StoreConfigService } from '../../services/store-config.service';
import {
  breadcrumbListJsonLd,
  organizationJsonLd,
  type StoreIdentityInput,
  pageTitle,
  serializeJsonLd,
  staticPageMetaTags,
  stripHtml,
} from '../../../lib/seo';
import { upsertPropertyMulti } from '../../../lib/meta-dom';

import type { load } from './about.server';
import { buildStoreIdentity } from '../../../lib/store-identity';

const DEFAULT_BASE_URL = 'http://localhost:53300';

/**
 * `/{locale}/about` — CMS-backed SSR brand-voiced "Our Story" page. Title +
 * body come from `GET /v1/pages/about` resolved per inbound `Accept-Language`
 * by the API's global `TranslatableInterceptor`. Migrated from static i18n
 * keys at SH5 per clarifications §1.20.
 *
 * Renders a `<section>` (with implicit ARIA `region` role from
 * `aria-labelledby`) inside LayoutShell's existing `<main>` landmark.
 * LayoutShell unconditionally wraps every route in `<main>`, so the page
 * must NOT also emit a `<main>` (would produce a double-main landmark and
 * fail axe `landmark-one-main`).
 *
 * SEO surface: localized `<title>` + meta description (≤200 chars per
 * `staticPageMetaTags` clamp), canonical, hreflang alternates, og:* + Twitter
 * card. `metaTitle` / `metaDescription` come from the CMS payload when
 * present; otherwise the component falls back to `title` + a body excerpt.
 */
@Component({
  selector: 'app-about-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="frame" aria-labelledby="about-heading">
      <h1 id="about-heading" class="heading">{{ heading() }}</h1>
      <!-- Admin authors via TranslatableRichTextComponent (sanitised HTML).
           Render through Angular's default [innerHTML] sanitiser so paragraph
           and list structure survives — plain-text legacy content renders
           unchanged because text nodes are sanitiser-safe. -->
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
        color: var(--brand-text);
      }
    `,
  ],
})
export default class AboutPage implements OnInit {
  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly metaSvc = inject(Meta);
  private readonly titleSvc = inject(Title);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly locale = this.localeService.locale;

  /**
   * SH5 — seed CMS payload synchronously from the page server endpoint
   * exported by the sibling `about.server.ts` companion. `requireSync: true`
   * errors loudly if Analog's contract ever shifts (mirrors SH2 / SH3 / SH4).
   */
  protected readonly loaded = toSignal(injectLoad<typeof load>(), { requireSync: true });

  protected readonly heading = computed(() => this.loaded().page.title);
  protected readonly body = computed(() => this.loaded().page.content);

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
      path: '/about',
      title: page.metaTitle ?? page.title,
      description: page.metaDescription ?? fallbackDescription,
    });
  });

  ngOnInit(): void {
    /**
     * SH5 — meta application runs synchronously in `ngOnInit` against the
     * SSR-seeded `loaded` payload (per `agent_docs/storefront/ssr-data-loading.md`
     * `## Per-page recipe` + clarifications Q-2). Avoids the `effect()`-
     * fires-twice surprise that the constructor-effect pattern introduced.
     */
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
   * Emit `Organization` + `BreadcrumbList` JSON-LD per `agent_docs/storefront/seo-geo.md`
   * `## SSR contract` row for `/{locale}/about`. Mirrors the home page pattern at
   * `apps/storefront/src/app/pages/[locale]/index.page.ts:316-336`.
   */

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
      .querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"][data-about-jsonld]')
      .forEach((node) => node.remove());
    const locale = this.locale();
    const baseUrl = this.resolveBaseUrl();
    const strings = this.localeService.strings();
    const homeUrl = `${baseUrl.replace(/\/$/, '')}/${locale}/`;
    const aboutUrl = `${baseUrl.replace(/\/$/, '')}/${locale}/about`;
    const payloads = [
      organizationJsonLd(locale, baseUrl, this.storeIdentity()),
      breadcrumbListJsonLd([
        { name: strings.nav.home, url: homeUrl },
        { name: this.loaded().page.title, url: aboutUrl },
      ]),
    ];
    for (const payload of payloads) {
      const script = this.document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      script.setAttribute('data-about-jsonld', 'true');
      script.textContent = serializeJsonLd(payload);
      head.appendChild(script);
    }
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
   * not). This page and the sibling `policies/[slug].page.ts` were the two
   * SH5-era pages that never picked up the platform guard the rest of the
   * SEO surface already uses.
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
