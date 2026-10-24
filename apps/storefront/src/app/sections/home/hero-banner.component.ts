import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  type Signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { LocaleService } from '../../locale.service';
import { PictureComponent, type PictureSource } from '../../ui/picture.component';
import type { SectionCtaLink } from '../../../lib/section-cta';

/**
 * Home hero banner. Bilingual copy + asset arrive via the required `copy`
 * input from the resolved `StorefrontSection.config` (Translatable JSONB →
 * string per Accept-Language). There is no locale-keyed fallback: the HERO
 * row is the only source of hero copy since plan B Phase B1 retired the
 * flag-off legacy home.
 *
 * Composition is product-on-white per agent_docs/storefront/brand-tokens.md and §5.3: copy and a
 * single call to action on the primary ground, with the operator product shot
 * in a 1:1 square beside them. There is no full-bleed photographic backdrop
 * and no scrim, because this client has no lifestyle imagery tier at all.
 *
 * No-image state: the surface degrades to copy alone on the primary. No
 * decorative gradient, no stand-in artwork.
 *
 * The product square is the largest contentful paint element, so it keeps
 * `priority` loading and the responsive `PictureSource` ladder.
 */
export interface HeroCopy {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  /**
   * Where the CTA points, resolved from the row's `config.ctaHref` by
   * `resolveSectionCtaOrCatalog`. `internal` renders through `routerLink`,
   * `external` through a plain href.
   */
  ctaLink: SectionCtaLink;
  imageAlt: string;
  imageUrl: string | null;
  /** Responsive `<source>` ladder built from the section's `assetVariants`. */
  imageSources?: PictureSource[];
}

@Component({
  selector: 'app-hero-banner',
  standalone: true,
  imports: [RouterLink, PictureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="hero"
      [class.hero--with-image]="!!heroImageUrl()"
      [attr.aria-labelledby]="headingId"
      data-testid="home-hero"
    >
      <div class="content">
        <p class="eyebrow">{{ resolvedCopy().eyebrow }}</p>
        <h1 [id]="headingId" class="headline">{{ resolvedCopy().headline }}</h1>
        <span class="accent" aria-hidden="true"></span>
        <p class="body">{{ resolvedCopy().body }}</p>
        @if (ctaLabel()) {
          @if (ctaLink().kind === 'internal') {
            <a
              class="cta"
              [routerLink]="ctaLink().href"
              [attr.aria-label]="ctaLabel() + ', ' + resolvedCopy().headline"
              data-testid="home-hero-cta"
            >
              {{ ctaLabel() }}
            </a>
          } @else {
            <a
              class="cta"
              [attr.href]="ctaLink().href"
              rel="noopener"
              [attr.aria-label]="ctaLabel() + ', ' + resolvedCopy().headline"
              data-testid="home-hero-cta"
            >
              {{ ctaLabel() }}
            </a>
          }
        }
      </div>
      @if (heroImageUrl()) {
        <div class="media" data-testid="home-hero-media">
          <app-picture
            [src]="heroImageUrl()!"
            [alt]="heroAltText()"
            [sources]="heroImageSources()"
            sizes="(max-width: 767px) 100vw, 45vw"
            aspectRatio="1 / 1"
            [priority]="true"
          />
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-items: center;
        gap: clamp(1.5rem, 4vw, 3rem);
        padding-block: clamp(1.5rem, 5vw, 3rem);
        background-color: var(--brand-bg);
        border-radius: var(--brand-radius-lg);
      }
      .content {
        min-inline-size: 0;
        max-inline-size: 60ch;
      }
      .eyebrow {
        margin: 0;
        font-size: var(--brand-text-micro);
        font-weight: 600;
        color: var(--brand-primary);
      }
      .headline {
        margin-block: 0.5rem 0;
        margin-inline: 0;
        font-family: var(--brand-font-display);
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        line-height: 1.15;
        color: var(--brand-text);
      }
      .accent {
        display: block;
        margin-block-start: 0.75rem;
        block-size: 4px;
        inline-size: 80px;
        background-color: var(--brand-primary);
        border-radius: var(--brand-radius-full);
      }
      .body {
        margin-block: 1rem 1.5rem;
        margin-inline: 0;
        font-size: var(--brand-text-body);
        color: var(--brand-text);
        max-inline-size: 60ch;
        line-height: 1.55;
      }
      .cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 48px;
        padding-inline: 1.75rem;
        padding-block: 0.875rem;
        font: inherit;
        font-size: var(--brand-text-body);
        font-weight: 600;
        color: var(--brand-on-primary);
        background-color: var(--brand-primary);
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        transition: background-color var(--brand-motion-duration) var(--brand-motion-easing);
      }
      .cta:hover,
      .cta:focus-visible {
        background-color: var(--brand-primary-dark);
      }
      .cta:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .media {
        min-inline-size: 0;
        aspect-ratio: 1 / 1;
        overflow: hidden;
        background-color: var(--brand-bg);
        border-radius: var(--brand-radius-lg);
      }
      /* Pin the picture chain to the square so a non-square source cannot
         override the parent ratio, same rule the product card carries. */
      .media app-picture {
        display: block;
        inline-size: 100%;
        block-size: 100%;
      }
      @media (min-width: 768px) {
        .hero--with-image {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .cta {
          transition: none;
        }
      }
    `,
  ],
})
export class HeroBannerComponent {
  private readonly localeService = inject(LocaleService);

  /**
   * Resolved hero copy + asset URL from a `StorefrontSection.config`. Required:
   * the home page only mounts this component for a HERO row, and that row
   * always carries copy.
   */
  readonly copy = input.required<HeroCopy>();

  protected readonly headingId = 'home-hero-heading';
  protected readonly locale = this.localeService.locale;
  protected readonly ctaLabel = computed(() => this.resolvedCopy().cta.trim());
  protected readonly ctaLink = computed(() => this.resolvedCopy().ctaLink);
  protected readonly resolvedCopy = this.copy;
  protected readonly heroImageUrl: Signal<string | null> = computed(
    () => this.resolvedCopy().imageUrl,
  );
  protected readonly heroAltText = computed(() => this.resolvedCopy().imageAlt);
  protected readonly heroImageSources = computed(() => this.resolvedCopy().imageSources ?? []);
}
