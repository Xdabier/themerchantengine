import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PictureComponent, type PictureSource } from '../../ui/picture.component';
import type { SectionCtaLink } from '../../../lib/section-cta';

/**
 * Campaign banner for a `PROMOTIONAL_BANNER` section row.
 *
 * D6 deleted this client's mid-campaign band and the home page then dropped
 * the type before dispatch, which left the admin selling a section an operator
 * could configure and never see. Brand floor §5.3 forbids a lifestyle scene,
 * not a banner, so phase B8 rebuilt the surface inside the floor rather than
 * retiring the type.
 *
 * What the floor pins here:
 *
 *  - The primary never exceeds 15 percent of a surface, and a large flat fill
 *    is reserved for a **single** banner per page. The `tone` input carries
 *    that: the first banner on a page renders `band`, any further one renders
 *    `quiet` otherwise. `brand-auditor` fails a second full-bleed primary band,
 *    so the rule is enforced in code rather than left to operator discipline.
 *  - Inverse text on the primary fails AA below 16 px, so the CTA sits on the
 *    appuyée inside the band.
 *  - §5.1 / §5.3 the optional asset is product-on-white and content-bearing, so
 *    it keeps its operator alt text. There is no backdrop, scrim or gradient.
 *  - §7.2 motion is 175 ms and reduced-motion is honoured.
 *  - §8.2 no shouted capitals, and no state colour used for promotion.
 */
export interface CampaignCopy {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  /** Resolved destination, from `resolveSectionCtaOrCatalog`. */
  ctaLink: SectionCtaLink;
  imageAlt: string;
  imageUrl: string | null;
  /** Responsive `<source>` ladder built from the section's `assetVariants`. */
  imageSources?: PictureSource[];
}

/** A flat primary fill for the first banner on a page, quiet for any after it. */
export type CampaignTone = 'band' | 'quiet';

@Component({
  selector: 'app-campaign-banner',
  standalone: true,
  imports: [RouterLink, PictureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="banner"
      [class.banner--band]="tone() === 'band'"
      [class.banner--with-image]="!!copy().imageUrl"
      [attr.aria-labelledby]="headingId()"
      data-testid="home-promo-banner"
    >
      <div class="content">
        <p class="eyebrow">{{ copy().eyebrow }}</p>
        <h2 [id]="headingId()" class="headline">{{ copy().headline }}</h2>
        <p class="body">{{ copy().body }}</p>
        @if (ctaLabel()) {
          @if (ctaLink().kind === 'internal') {
            <a
              class="cta"
              [routerLink]="ctaLink().href"
              [attr.aria-label]="ctaLabel() + ', ' + copy().headline"
              data-testid="home-promo-banner-cta"
            >
              {{ ctaLabel() }}
            </a>
          } @else {
            <a
              class="cta"
              [attr.href]="ctaLink().href"
              rel="noopener"
              [attr.aria-label]="ctaLabel() + ', ' + copy().headline"
              data-testid="home-promo-banner-cta"
            >
              {{ ctaLabel() }}
            </a>
          }
        }
      </div>
      @if (copy().imageUrl) {
        <div class="media" data-testid="home-promo-banner-media">
          <app-picture
            [src]="copy().imageUrl!"
            [alt]="copy().imageAlt"
            [sources]="copy().imageSources ?? []"
            sizes="(max-width: 767px) 100vw, 33vw"
            aspectRatio="1 / 1"
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
      .banner {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-items: center;
        gap: clamp(1.25rem, 3vw, 2rem);
        padding-block: clamp(1.5rem, 4vw, 2.5rem);
        padding-inline: clamp(1.25rem, 4vw, 2.5rem);
        border-radius: var(--brand-radius-lg);
        background-color: var(--brand-surface);
        color: var(--brand-text);
      }
      /* The one permitted large primary fill on a page. */
      .banner--band {
        background-color: var(--brand-primary);
        color: var(--brand-bg);
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
      /* Inverse text under 16 px must not sit on the raw primary.
         The eyebrow is 12 px, so inside the band it takes the pressed primary step
         chip rather than the band colour. */
      .banner--band .eyebrow {
        display: inline-block;
        color: var(--brand-bg);
        background-color: var(--brand-primary-dark);
        padding-block: 0.125rem;
        padding-inline: 0.5rem;
        border-radius: var(--brand-radius-sm);
      }
      .headline {
        margin-block: 0.375rem 0;
        font-family: var(--brand-font-display);
        font-size: var(--brand-text-section);
        font-weight: 600;
        line-height: 1.2;
      }
      .body {
        margin-block: 0.625rem 0;
        font-size: var(--brand-text-body);
        color: var(--brand-text-muted);
      }
      /* Body text on the band is 16 px or larger, so the inverse label on the primary clears
         AA without dropping to the appuyée step. */
      .banner--band .body {
        color: var(--brand-bg);
      }
      .cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 44px;
        margin-block-start: 1.25rem;
        padding-block: 0.625rem;
        padding-inline: 1.5rem;
        font-size: var(--brand-text-body);
        font-weight: 600;
        color: var(--brand-bg);
        background-color: var(--brand-primary);
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        transition: background-color var(--brand-motion-duration) var(--brand-motion-easing);
      }
      .cta:hover,
      .cta:focus-visible {
        background-color: var(--brand-primary-dark);
      }
      /* Inverse text on the primary fails AA below 16 px, so a control sitting on
         the band takes the appuyée ground rather than the band colour. */
      .banner--band .cta {
        background-color: var(--brand-primary-dark);
      }
      .banner--band .cta:hover,
      .banner--band .cta:focus-visible {
        background-color: var(--brand-primary-pressed);
      }
      .cta:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 3px;
      }
      .banner--band .cta:focus-visible {
        outline-color: var(--brand-bg);
      }
      @media (prefers-reduced-motion: reduce) {
        .cta {
          transition: none;
        }
      }
      .media {
        min-inline-size: 0;
      }
      .media img {
        inline-size: 100%;
        block-size: auto;
        border-radius: var(--brand-radius-md);
      }

      @media (min-width: 768px) {
        .banner--with-image {
          grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class CampaignBannerComponent {
  readonly copy = input.required<CampaignCopy>();

  /**
   * A flat primary fill or the quiet variant. Set by the home page from the row's position among
   * the PROMOTIONAL_BANNER rows, so a second configured banner cannot put the
   * page into a agent_docs/storefront/brand-tokens.md violation on its own. The caller must derive it
   * from the same ordered list it iterates for render, or "first in the array"
   * stops meaning "first on the page".
   */
  readonly tone = input<CampaignTone>('band');

  /** Unique DOM id for the heading + `aria-labelledby` chain. */
  readonly headingId = input<string>('home-promo-banner-heading');

  protected readonly ctaLabel = computed(() => this.copy().cta.trim());
  protected readonly ctaLink = computed(() => this.copy().ctaLink);
}
