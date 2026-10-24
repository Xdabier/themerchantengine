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
 * `/{locale}/pages/{slug}` — the generic CMS page surface.
 *
 * Mirrors `policies/[slug].page.ts`: a `<section>` inside LayoutShell's
 * `<main>` (a second `<main>` fails axe `landmark-one-main`), title and body
 * seeded synchronously from the sibling `.server.ts`, meta applied in
 * `ngOnInit` against that payload.
 *
 * The body is admin-authored HTML, sanitized on write by the API
 * (`libs/shared/common/src/utils/sanitize-rich-text.ts`) down to
 * p/br/strong/em/a/ul/ol/li/h1-h4, so `[innerHTML]` renders real structure
 * rather than escaped tags. Typography for those tags is the shared global
 * `.rich-text-content` class: component styles cannot reach `[innerHTML]`
 * children, which never carry the `_ngcontent` attribute.
 */
@Component({
  selector: 'app-cms-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="frame" aria-labelledby="cms-page-heading">
      <h1 id="cms-page-heading" class="heading">{{ heading() }}</h1>
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
export default class CmsPageComponent implements OnInit {
  private readonly storeConfig = inject(StoreConfigService);
  private readonly localeService = inject(LocaleService);
  private readonly metaSvc = inject(Meta);
  private readonly titleSvc = inject(Title);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly locale = this.localeService.locale;

  protected readonly loaded = toSignal(injectLoad<typeof load>(), { requireSync: true });

  protected readonly slug = computed(() => this.loaded().slug);
  protected readonly heading = computed(() => this.loaded().page.title);
  protected readonly body = computed(() => this.loaded().page.content);

  protected readonly tags = computed(() => {
    const page = this.loaded().page;
    const fallbackDescription = stripHtml(page.content).slice(0, 200).trim();
    return staticPageMetaTags({
      locale: this.locale(),
      baseUrl: this.resolveBaseUrl(),
      locales: this.storeConfig.seoLocales(),
      identity: this.localeService.chromeIdentity(),
      path: `/pages/${this.slug()}`,
      title: page.metaTitle ?? page.title,
      description: page.metaDescription ?? fallbackDescription,
    });
  });

  ngOnInit(): void {
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

  /** BreadcrumbList only, mirroring the policy page: home then this page. */
  private applyJsonLd(): void {
    const head = this.document.head;
    if (!head) return;
    head
      .querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"][data-cms-jsonld]')
      .forEach((node) => node.remove());
    const locale = this.locale();
    const baseUrl = this.resolveBaseUrl().replace(/\/$/, '');
    const strings = this.localeService.strings();
    const payload = breadcrumbListJsonLd([
      { name: strings.nav.home, url: `${baseUrl}/${locale}/` },
      { name: this.loaded().page.title, url: `${baseUrl}/${locale}/pages/${this.slug()}` },
    ]);
    const script = this.document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.setAttribute('data-cms-jsonld', 'true');
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
   * `process` is a Node global with no browser shim, so a bare `process.env`
   * read throws `ReferenceError` on every client render. Guarded per platform,
   * mirroring the rest of the SEO surface.
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
