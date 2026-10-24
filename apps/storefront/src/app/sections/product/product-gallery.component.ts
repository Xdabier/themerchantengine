import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  QueryList,
  ViewChild,
  ViewChildren,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

import { ChevronIconComponent } from '../../layout/icons/chevron-icon.component';
import { LocaleService } from '../../locale.service';
import { PictureComponent, type PictureSource } from '../../ui/picture.component';

export interface GalleryImage {
  url: string;
  alt: string;
  sources?: PictureSource[];
}

@Component({
  selector: 'product-gallery',
  standalone: true,
  imports: [ChevronIconComponent, PictureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="gallery"
      [attr.aria-roledescription]="'carousel'"
      [attr.aria-label]="strings().product.gallery.label"
    >
      <div class="main">
        <button
          #zoom
          type="button"
          class="zoom"
          [attr.aria-label]="strings().product.gallery.open"
          (click)="openLightbox()"
        >
          <app-picture
            [src]="active().url"
            [alt]="active().alt"
            [sources]="active().sources ?? []"
            aspectRatio="1 / 1"
            sizes="(max-width: 768px) 100vw, 50vw"
            [priority]="true"
            [width]="1024"
            [height]="1024"
          />
        </button>
      </div>
      @if (images().length > 1) {
        <ul class="thumbs" role="list">
          @for (img of images(); track img.url; let idx = $index) {
            <li class="thumb-cell">
              <button
                #thumb
                type="button"
                class="thumb"
                [class.active]="idx === activeIndex()"
                [attr.aria-current]="idx === activeIndex() ? 'true' : null"
                [attr.aria-label]="thumbLabel(idx)"
                (click)="setActive(idx)"
              >
                <app-picture
                  [src]="img.url"
                  [alt]="img.alt"
                  [sources]="img.sources ?? []"
                  aspectRatio="1 / 1"
                  sizes="120px"
                  [width]="120"
                  [height]="120"
                />
              </button>
            </li>
          }
        </ul>
      }

      <!--
        Finding P1 / operator requirement #10. Rendered only while open: a
        closed dialog is valid SSR output either way, and keeping it out of
        the first byte keeps the hydration surface to the gallery itself.
        A click on the dialog element is a click on the area around the figure,
        which is the backdrop; .frame stops its own clicks from closing.
      -->
      @if (isOpen()) {
        <dialog
          #lightbox
          class="lightbox"
          aria-modal="true"
          [attr.aria-labelledby]="lightboxTitleId"
          (click)="closeLightbox()"
          (close)="onDialogClose()"
        >
          <h2 [id]="lightboxTitleId" class="sr-only">{{ strings().product.gallery.label }}</h2>

          <button
            type="button"
            class="close"
            [attr.aria-label]="strings().product.gallery.close"
            (click)="closeLightbox(); $event.stopPropagation()"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6 6 18 18M18 6 6 18" />
            </svg>
          </button>

          <div class="frame" (click)="closeLightbox()">
            <div class="figure" (click)="$event.stopPropagation()">
              <app-picture
                [src]="active().url"
                [alt]="active().alt"
                [sources]="active().sources ?? []"
                sizes="100vw"
                fit="contain"
                [width]="1200"
                [height]="1200"
              />
            </div>
          </div>

          @if (images().length > 1) {
            <button
              type="button"
              class="nav nav-prev"
              [attr.aria-label]="strings().product.gallery.previousImage"
              (click)="step(-1); $event.stopPropagation()"
            >
              <app-chevron-icon [size]="24" orientation="start" />
            </button>
            <button
              type="button"
              class="nav nav-next"
              [attr.aria-label]="strings().product.gallery.nextImage"
              (click)="step(1); $event.stopPropagation()"
            >
              <app-chevron-icon [size]="24" orientation="end" />
            </button>
            <p class="counter" aria-live="polite">{{ counterLabel() }}</p>
          }
        </dialog>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .gallery {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .main {
        background-color: var(--brand-bg);
        border-radius: var(--brand-radius-lg);
        overflow: clip;
      }
      .zoom {
        display: block;
        inline-size: 100%;
        padding: 0;
        border: none;
        background: transparent;
        cursor: zoom-in;
      }
      .zoom:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      /* Painted as a full-viewport surface rather than through ::backdrop, so
         the fallback open-attribute path (a browser with no showModal) renders
         the same overlay as the native modal one. */
      .lightbox {
        position: fixed;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        max-inline-size: none;
        max-block-size: none;
        margin: 0;
        padding: 0;
        border: none;
        background-color: var(--brand-scrim-modal);
        color: var(--brand-on-primary);
        overflow: auto;
        overscroll-behavior: contain;
      }
      .lightbox::backdrop {
        background-color: var(--brand-scrim-modal);
      }
      .frame {
        display: flex;
        align-items: center;
        justify-content: center;
        min-block-size: 100%;
        padding: 3.5rem 1rem;
        /* Lets a pinched image be panned; no custom zoom engine, and no
           maximum-scale anywhere that would block the gesture. */
        touch-action: pinch-zoom;
      }
      .figure {
        inline-size: min(100%, 1200px);
      }
      .close,
      .nav {
        position: fixed;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-inline-size: 44px;
        min-block-size: 44px;
        padding: 0;
        border: none;
        border-radius: var(--brand-radius-full);
        background-color: var(--brand-overlay-bg);
        color: var(--brand-text);
        cursor: pointer;
      }
      .close:focus-visible,
      .nav:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .close {
        inset-block-start: 0.75rem;
        inset-inline-end: 0.75rem;
      }
      .nav-prev {
        inset-block-start: 50%;
        inset-inline-start: 0.75rem;
      }
      .nav-next {
        inset-block-start: 50%;
        inset-inline-end: 0.75rem;
      }
      /* Reads over a photograph, so it carries its own opaque chip rather than
         sitting on the translucent scrim: white on a 50% scrim over an unknown
         image cannot hold the 4.5:1 floor (axe color-contrast, serious). Same
         treatment as the close and step buttons. */
      .counter {
        position: fixed;
        inset-block-end: 0.75rem;
        inset-inline-start: 50%;
        translate: -50% 0;
        margin: 0;
        padding-block: 0.25rem;
        padding-inline: 0.75rem;
        border-radius: var(--brand-radius-full);
        background-color: var(--brand-overlay-bg);
        font-size: var(--brand-text-secondary);
        color: var(--brand-text);
      }
      .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .thumbs {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        scroll-snap-type: inline mandatory;
        scrollbar-width: thin;
      }
      .thumb-cell {
        flex: 0 0 auto;
        scroll-snap-align: start;
      }
      .thumb {
        background: transparent;
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        padding: 0;
        cursor: pointer;
        inline-size: 80px;
        block-size: 80px;
        overflow: clip;
      }
      .thumb.active {
        border-color: var(--brand-primary);
        border-width: 2px;
      }
      .thumb:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 2px;
      }
      @media (min-width: 768px) {
        .thumb {
          inline-size: 96px;
          block-size: 96px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .thumbs {
          scroll-behavior: auto;
        }
        .lightbox {
          animation: none;
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .lightbox[open] {
          animation: lightbox-in var(--brand-motion-duration) var(--brand-motion-easing);
        }
      }
      @keyframes lightbox-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
    `,
  ],
})
export class ProductGalleryComponent {
  readonly images = input.required<GalleryImage[]>();

  @ViewChildren('thumb') protected thumbButtons!: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChild('zoom') private zoomTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('lightbox') private lightboxRef?: ElementRef<HTMLDialogElement>;

  protected readonly lightboxTitleId = 'product-gallery-lightbox-title';
  protected readonly isOpen = signal(false);

  private readonly localeService = inject(LocaleService);
  private readonly injector = inject(Injector);
  protected readonly strings = computed(() => this.localeService.strings());
  protected readonly activeIndex = signal(0);

  protected readonly active = computed(() => {
    const list = this.images();
    const idx = Math.min(this.activeIndex(), Math.max(0, list.length - 1));
    return list[idx] ?? { url: '', alt: '' };
  });

  protected setActive(idx: number): void {
    if (idx < 0 || idx >= this.images().length) return;
    this.activeIndex.set(idx);
  }

  protected thumbLabel(idx: number): string {
    return this.strings().product.gallery.thumbnail.replace('{position}', String(idx + 1));
  }

  protected readonly counterLabel = computed(() =>
    this.strings()
      .product.gallery.counter.replace('{position}', String(this.activeIndex() + 1))
      .replace('{total}', String(this.images().length)),
  );

  /**
   * `showModal()` is what puts the dialog in the top layer, makes the rest of
   * the document inert and wires Esc, so it is the path every browser the
   * storefront targets takes. The `open` attribute is the honest degradation
   * for anything without `HTMLDialogElement` (and for jsdom under test): the
   * overlay is painted by the component's own fixed full-viewport rule rather
   * than by `::backdrop`, so it still renders and still closes, only without
   * native inertness.
   */
  protected openLightbox(): void {
    if (this.isOpen()) return;
    this.isOpen.set(true);
    // afterNextRender, not a microtask: the dialog element does not exist until
    // the @if block has rendered, and a microtask queued from the click handler
    // drains before that.
    afterNextRender(
      () => {
        const dialog = this.lightboxRef?.nativeElement;
        if (!dialog) return;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        dialog.querySelector<HTMLButtonElement>('.close')?.focus();
      },
      { injector: this.injector },
    );
  }

  protected closeLightbox(): void {
    if (!this.isOpen()) return;
    const dialog = this.lightboxRef?.nativeElement;
    // `close()` fires the `close` event, which lands on `onDialogClose`; the
    // fallback path has neither, so it tears down here.
    if (dialog && typeof dialog.close === 'function') dialog.close();
    else this.onDialogClose();
  }

  /** Also the Esc path: the native default fires `close` without a click. */
  protected onDialogClose(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    // `restoreFocus` by hand: the trigger is the only place focus can go back
    // to that keeps a keyboard user where they were.
    afterNextRender(() => this.zoomTrigger?.nativeElement.focus(), { injector: this.injector });
  }

  protected step(dir: 1 | -1): void {
    const total = this.images().length;
    if (total <= 1) return;
    this.activeIndex.set((this.activeIndex() + dir + total) % total);
  }

  @HostListener('keydown.arrowright', ['$event'])
  @HostListener('keydown.arrowleft', ['$event'])
  protected onArrow(event: Event): void {
    const ke = event as KeyboardEvent;
    const total = this.images().length;
    if (total <= 1) return;
    const dir = ke.key === 'ArrowRight' ? 1 : -1;
    const next = (this.activeIndex() + dir + total) % total;
    this.activeIndex.set(next);
    ke.preventDefault();
    // Inside the lightbox the thumbnails are not reachable, and pulling focus
    // out of the dialog's own controls would drop the keyboard user mid-view.
    if (this.isOpen()) return;
    // Move DOM focus to the new active thumbnail button so keyboard users
    // and screen readers track the selection (a11y-auditor S6 finding).
    queueMicrotask(() => {
      const buttons = this.thumbButtons?.toArray();
      const target = buttons?.[next]?.nativeElement;
      target?.focus();
    });
  }
}
