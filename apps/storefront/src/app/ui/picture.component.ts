import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';

import { noImageFallback } from '../../lib/no-image';

/**
 * `<picture>` wrapper that emits the agent_docs/storefront/brand-tokens.md image surface: opt-in
 * format ladder (avif → webp → fallback) when the caller passes explicit
 * sources, layout-shift safe via width/height + aspectRatio, lazy by
 * default, opt-in `priority` for above-the-fold LCP candidates.
 *
 * v1 callers (S6) feed a single `src` URL because the storage layer only
 * emits one format per asset today (clarifications §1.18). When the
 * format-derivative emission lands in a later workflow-tooling pass,
 * callers will pass a `sources` array and the format ladder activates.
 *
 * Empty / missing / failed-to-load sources fall back to the single text-free
 * "no image available" surface (`/brand/no-image.svg`). The `<source>` ladder
 * is suppressed in fallback mode so the browser can't re-fetch a broken
 * avif/webp variant.
 */

export interface PictureSource {
  type: 'image/avif' | 'image/webp' | 'image/jpeg' | 'image/png';
  srcset: string;
  sizes?: string;
}

@Component({
  selector: 'app-picture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--picture-fit]': 'fit()',
  },
  template: `
    <picture class="picture" [style.aspect-ratio]="aspectRatio() || null">
      @if (!useFallback()) {
        @for (source of sources(); track source.type) {
          <source
            [type]="source.type"
            [srcset]="source.srcset"
            [attr.sizes]="source.sizes ?? sizes() ?? null"
          />
        }
      }
      <img
        class="image"
        [src]="displaySrc()"
        [alt]="alt()"
        [attr.width]="width() ?? null"
        [attr.height]="height() ?? null"
        [attr.sizes]="sizes() || null"
        [attr.loading]="loadingAttr()"
        [attr.decoding]="decodingAttr()"
        [attr.fetchpriority]="fetchPriorityAttr()"
        (error)="onError()"
      />
    </picture>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .picture {
        display: block;
        inline-size: 100%;
        block-size: 100%;
      }
      .image {
        display: block;
        inline-size: 100%;
        block-size: 100%;
        object-fit: var(--picture-fit, cover);
      }
    `,
  ],
})
export class PictureComponent {
  readonly src = input.required<string>();
  readonly alt = input.required<string>();
  readonly sources = input<PictureSource[]>([]);
  readonly sizes = input<string>('');
  readonly width = input<number | null>(null);
  readonly height = input<number | null>(null);
  readonly aspectRatio = input<string>('');
  /** `contain` is for surfaces that must show the whole frame rather than
   * fill a fixed box, such as the product gallery's fullscreen lightbox. */
  readonly fit = input<'cover' | 'contain'>('cover');
  /** Above-the-fold LCP candidates flip to eager + high fetch priority. */
  readonly priority = input<boolean>(false);
  /** Auto-resets to false whenever `src()` changes so a fresh URL gets a
   * fresh load attempt instead of inheriting the previous error state. */
  private readonly errored = linkedSignal<string, boolean>({
    source: () => this.src(),
    computation: () => false,
  });

  protected readonly useFallback = computed(() => this.errored() || !this.src());

  protected readonly displaySrc = computed(() =>
    this.useFallback() ? noImageFallback() : this.src(),
  );

  protected readonly loadingAttr = computed(() => (this.priority() ? 'eager' : 'lazy'));
  protected readonly decodingAttr = computed(() => (this.priority() ? 'sync' : 'async'));
  protected readonly fetchPriorityAttr = computed(() => (this.priority() ? 'high' : null));

  protected onError(): void {
    this.errored.set(true);
  }
}
