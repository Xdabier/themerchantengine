import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { injectResponse } from '@analogjs/router/tokens';

import { LocaleService } from '../../locale.service';
import { APP_ROUTES } from '../../../lib/routes';
import { pageTitle } from '../../../lib/seo';

/**
 * Catch-all page for any unrecognised path under `/<locale>/*`.
 *
 * Analog maps `[...not-found].page.ts` to the Angular Router `**` wildcard
 * within the `[locale]` route segment. This keeps the browser URL at the
 * navigated path (e.g., `/fr/catalog/electronics`) rather than falling
 * through to the root-redirect page which would reset the URL to `/fr/`.
 *
 * Required for S5 e2e task: "click first category → URL becomes
 * `/fr/catalog/<slug>`, assert URL change only, do not require 200"
 * (`agent_docs/storefront/architecture.md). The catalog page
 * (`/fr/catalog/:slug`) ships with the S6 catalog phase.
 *
 * Renders `<section>` rather than `<main>` so LayoutShell's `<main>`
 * landmark stays unique. The `noindex,nofollow` robots tag applies only
 * while the route is mounted — the OnDestroy hook removes it so navigating
 * back to a public route does not inherit a stale meta-robots tag.
 */
@Component({
  selector: 'app-not-found-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="frame" aria-labelledby="not-found-heading">
      <h1 id="not-found-heading" class="heading">{{ strings().notFound.heading }}</h1>
      <p class="body">{{ strings().notFound.body }}</p>
      <a class="cta" [routerLink]="homeRoute()">{{ strings().notFound.cta }}</a>
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
        max-inline-size: 640px;
        margin-inline: auto;
        padding-block: clamp(3rem, 8vw, 6rem);
        padding-inline: clamp(1rem, 4vw, 2rem);
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .heading {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        color: var(--brand-text);
        line-height: 1.2;
      }
      .body {
        margin: 0;
        font-size: var(--brand-text-body);
        color: var(--brand-text-muted);
      }
      .cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 48px;
        min-inline-size: 44px;
        padding-inline: 1.5rem;
        padding-block: 0.75rem;
        font: inherit;
        font-weight: 600;
        color: var(--brand-on-primary);
        background-color: var(--brand-primary);
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        align-self: flex-start;
      }
      .cta:hover,
      .cta:focus-visible {
        background-color: var(--brand-primary-dark);
      }
      .cta:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 3px;
      }
    `,
  ],
})
export default class NotFoundPage implements OnInit, OnDestroy {
  private readonly localeService = inject(LocaleService);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  /** Null in the browser; the document's response during SSR. */
  private readonly serverResponse = injectResponse();

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;
  protected readonly homeRoute = computed(() => APP_ROUTES.home(this.locale()));

  ngOnInit(): void {
    this.title.setTitle(pageTitle(this.strings().notFound.title, this.strings().brand.name));
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    this.sendNotFoundStatus();
  }

  /**
   * Answer 404 on the document, not just in the body.
   *
   * Nothing on the SSR path assigns a status: the Nitro dev handler and the
   * production renderer both write the HTML with whatever the default is, so
   * every unknown slug went out as 200 with site chrome and an empty main.
   * Google calls that a soft 404, and it applies to three unbounded URL
   * spaces here (policies, categories, products), which is the worst shape a
   * defect can have on a domain about to be crawled for the first time.
   *
   * `injectResponse()` returns the document's own ServerResponse, provided by
   * Analog's server context, and this runs well before the renderer ends it.
   *
   * `no-store` rides along because the storefront sets no cache directive on
   * the SSR document anywhere, and a 404 with no directive is heuristically
   * cacheable. Every one of these paths is a slug that may exist tomorrow:
   * a product about to be published, a CMS page about to go live. A cached
   * 404 would outlive the reason for it.
   */
  private sendNotFoundStatus(): void {
    const response = this.serverResponse;
    if (!response || response.headersSent) return;
    response.statusCode = 404;
    response.setHeader('Cache-Control', 'no-store');
  }

  ngOnDestroy(): void {
    this.meta.removeTag('name="robots"');
  }
}
