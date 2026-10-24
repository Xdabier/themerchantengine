import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';

import { LocaleService } from '../../locale.service';
import { APP_ROUTES } from '../../../lib/routes';
import { sanitizeFromParam } from '../../error-handler';
import { pageTitle } from '../../../lib/seo';

/**
 * Locale-aware graceful-degradation page surfaced by the global
 * `StorefrontErrorHandler`. The retry CTA targets the original URL
 * captured in the `from=` query param — sanitized to same-origin
 * path-only via `sanitizeFromParam`. If the param is missing or
 * unsafe, the CTA falls back to the locale home.
 */
@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="frame" aria-labelledby="error-heading">
      <h1 id="error-heading" class="heading">{{ strings().errorPage.heading }}</h1>
      <p class="body">{{ strings().errorPage.body }}</p>
      <div class="ctas">
        @if (retryHref()) {
          <a class="cta primary" [routerLink]="retryHref()">{{ strings().errorPage.retry }}</a>
        }
        <a class="cta secondary" [routerLink]="homeHref()">{{ strings().errorPage.home }}</a>
      </div>
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
        line-height: 1.2;
      }
      .body {
        margin: 0;
        font-size: var(--brand-text-body);
        color: var(--brand-text-muted);
      }
      .ctas {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-block-start: 0.5rem;
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
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        border: 1px solid transparent;
      }
      .cta.primary {
        color: var(--brand-on-primary);
        background-color: var(--brand-primary);
      }
      .cta.primary:hover,
      .cta.primary:focus-visible {
        background-color: var(--brand-primary-dark);
      }
      .cta.secondary {
        color: var(--brand-text);
        background-color: transparent;
        border-color: var(--brand-text);
      }
      .cta.secondary:hover,
      .cta.secondary:focus-visible {
        background-color: var(--brand-text);
        color: var(--brand-on-primary);
      }
      .cta:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 3px;
      }
    `,
  ],
})
export default class ErrorPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly localeService = inject(LocaleService);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  protected readonly locale = this.localeService.locale;
  protected readonly strings = this.localeService.strings;
  protected readonly homeHref = computed(() => APP_ROUTES.home(this.locale()));

  private readonly safeFrom = signal<string | null>(null);
  protected readonly retryHref = computed(() => this.safeFrom() ?? null);

  ngOnInit(): void {
    this.title.setTitle(pageTitle(this.strings().errorPage.title, this.strings().brand.name));
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });

    const raw = this.route.snapshot.queryParamMap.get('from');
    if (!raw) return;
    // Resolve origin from the document. Works on both SSR (Analog
    // request-scoped DOCUMENT) and the browser. Fall back to a sentinel
    // base so the URL parser still rejects cross-origin candidates when
    // no origin is recoverable.
    const origin =
      this.document?.defaultView?.location?.origin ??
      this.document?.location?.origin ??
      'http://localhost';
    const safe = sanitizeFromParam(raw, origin);
    if (safe) this.safeFrom.set(safe);
    void this.router; // referenced for tooling completeness
    void this.platformId;
  }

  ngOnDestroy(): void {
    this.meta.removeTag('name="robots"');
  }
}
