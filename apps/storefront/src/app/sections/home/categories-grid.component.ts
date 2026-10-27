import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { pickTranslation, type Category, type ResolvedString } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { APP_ROUTES } from '../../../lib/routes';
import { CategoryIconComponent } from './icons/category-icon.component';
import { SectionHeaderComponent } from './section-header.component';
import { PictureComponent } from '../../ui/picture.component';
import { pictureSourcesFromAssetVariants } from '../../../lib/asset-variant';

/**
 * Categories grid — 4-up `<md`, 6-up `md+`, 8-up `xl+` per
 * `agent_docs/storefront/responsive-rules.md` §"Grid". Each tile is a link to
 * `/${locale}/catalog/${slug}`.
 *
 * The tile media shows the operator's uploaded category image when the API
 * resolved one (`imageUrl` + `imageVariants`, hydrated from `Category.imageId`
 * at phase B6), and otherwise the drawn inline-SVG glyph from
 * `app/sections/home/icons/category-icon.component.ts`. Unknown slugs keep the
 * generic tag glyph, so the tile is never a blank box.
 *
 * The media stays decorative: it sits in an `aria-hidden` span and the image
 * carries an empty alt, because the tile label already names the link.
 */
@Component({
  selector: 'app-categories-grid',
  standalone: true,
  imports: [RouterLink, CategoryIconComponent, SectionHeaderComponent, PictureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" [attr.aria-labelledby]="headingId()" data-testid="home-categories">
      <app-section-header [title]="resolvedTitle()" [eyebrow]="null" [headingId]="headingId()" />
      @if (visibleCategories().length > 0) {
        <ul class="grid" role="list">
          @for (cat of visibleCategories(); track cat.id) {
            <li class="cell">
              <a
                class="tile"
                [routerLink]="categoryRoute(cat.slug)"
                [attr.data-testid]="'home-category-' + cat.slug"
              >
                <span class="icon" aria-hidden="true">
                  @if (cat.imageUrl) {
                    <app-picture
                      class="media"
                      [src]="cat.imageUrl"
                      alt=""
                      [sources]="imageSources(cat)"
                      sizes="(max-width: 480px) 25vw, (max-width: 768px) 16vw, 120px"
                      aspectRatio="1 / 1"
                    />
                  } @else {
                    <app-category-icon [slug]="cat.slug" [size]="36" />
                  }
                </span>
                <span class="label">{{ resolveName(cat) }}</span>
              </a>
            </li>
          }
        </ul>
      } @else {
        <p class="empty" data-testid="home-categories-empty" role="status" aria-live="polite">
          {{ strings().home.empty.categories }}
        </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
      }
      .cell {
        display: flex;
      }
      .tile {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.625rem;
        min-block-size: 96px;
        padding-block: 1rem;
        padding-inline: 0.75rem;
        background-color: var(--brand-surface);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-lg);
        color: var(--brand-text);
        text-decoration: none;
        text-align: center;
        transition:
          border-color var(--brand-motion-duration) var(--brand-motion-easing),
          background-color var(--brand-motion-duration) var(--brand-motion-easing);
      }
      .tile:hover,
      .tile:focus-visible {
        border-color: var(--brand-primary);
        background-color: var(--brand-surface-strong);
      }
      .tile:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 3px;
      }
      @media (prefers-reduced-motion: reduce) {
        .tile {
          transition: none;
        }
      }
      .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 56px;
        block-size: 56px;
        color: var(--brand-primary);
        overflow: hidden;
      }
      .media {
        inline-size: 100%;
        block-size: 100%;
      }
      .media img {
        inline-size: 100%;
        block-size: 100%;
        object-fit: cover;
      }
      .label {
        font-size: var(--brand-text-body);
        font-weight: 500;
        line-height: 1.3;
      }
      .empty {
        margin: 0;
        padding-block: 1.5rem;
        padding-inline: 1rem;
        color: var(--brand-text-muted);
        background-color: var(--brand-surface);
        border: 1px dashed var(--brand-border-strong);
        border-radius: var(--brand-radius-lg);
        text-align: start;
      }

      @media (min-width: 480px) {
        .grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
      @media (min-width: 768px) {
        .grid {
          grid-template-columns: repeat(6, minmax(0, 1fr));
        }
      }
      @media (min-width: 1280px) {
        .grid {
          grid-template-columns: repeat(8, minmax(0, 1fr));
        }
        .tile {
          min-block-size: 120px;
        }
      }
    `,
  ],
})
export class CategoriesGridComponent {
  private readonly localeService = inject(LocaleService);

  readonly categories = input<Category[]>([]);

  /**
   * Optional operator-driven heading override. When set, takes precedence
   * over the chrome-strings default. Sourced from the resolved
   * `StorefrontSection.config.heading` under the dynamic-sections path.
   */
  readonly title = input<string | null>(null);

  /** Unique DOM id for the heading + aria-labelledby chain. */
  readonly headingId = input<string>('home-categories-heading');

  protected readonly strings = this.localeService.strings;
  protected readonly locale = this.localeService.locale;

  protected readonly resolvedTitle = computed(
    () => this.title() ?? this.strings().home.sections.categories,
  );
  protected readonly visibleCategories = computed(() => this.categories().slice(0, 8));

  protected categoryRoute(slug: string): string {
    return APP_ROUTES.catalog(this.locale(), slug);
  }

  /** Responsive `<source>` ladder for a tile that has an uploaded image. */
  protected imageSources(cat: Category) {
    return pictureSourcesFromAssetVariants(
      cat.imageVariants,
      '(max-width: 480px) 25vw, (max-width: 768px) 16vw, 120px',
    );
  }

  protected resolveName(cat: Category): string {
    return pickTranslation(cat.name as ResolvedString, this.locale());
  }
}
