import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { getChromeStrings } from '../../../i18n';
import { LocaleService } from '../../locale.service';
import { assertAxeClean, attachToBody, renderComponent } from '../../ui/testing';
import { ProductGalleryComponent, type GalleryImage } from './product-gallery.component';

const baseImages: GalleryImage[] = [
  { url: 'https://cdn.example/echo-1.jpg', alt: 'Echo Buds Pro front' },
  { url: 'https://cdn.example/echo-2.jpg', alt: 'Echo Buds Pro side' },
  { url: 'https://cdn.example/echo-3.jpg', alt: 'Echo Buds Pro case' },
];

/**
 * jsdom 25 parses `<dialog>` but implements none of its behaviour: there is no
 * `showModal`, no `close`, and no `open` bookkeeping. The component therefore
 * falls back to the `open` attribute, which is the same path a browser without
 * `HTMLDialogElement` takes, and these specs assert that path. Native top-layer
 * rendering, inertness and the Esc default are proven in Chromium and WebKit by
 * `product-page-ux.journey.spec.ts`.
 */
function lightbox(fixture: ComponentFixture<ProductGalleryComponent>): HTMLElement | null {
  return fixture.nativeElement.querySelector('dialog.lightbox');
}

function zoomButton(fixture: ComponentFixture<ProductGalleryComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.zoom') as HTMLButtonElement;
}

async function openLightbox(
  fixture: ComponentFixture<ProductGalleryComponent>,
): Promise<HTMLElement> {
  zoomButton(fixture).click();
  fixture.detectChanges();
  await fixture.whenStable();
  const dialog = lightbox(fixture);
  expect(dialog, 'the zoom button must open the lightbox').not.toBeNull();
  return dialog!;
}

describe('ProductGalleryComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders the first image as the active main image', async () => {
    const fixture = await renderComponent(ProductGalleryComponent, { images: baseImages }, [
      provideRouter([]),
      LocaleService,
    ]);
    const main = fixture.nativeElement.querySelector('.main img') as HTMLImageElement;
    expect(main.getAttribute('src')).toBe('https://cdn.example/echo-1.jpg');
  });

  it('renders one thumbnail button per image when there are multiple', async () => {
    const fixture = await renderComponent(ProductGalleryComponent, { images: baseImages }, [
      provideRouter([]),
      LocaleService,
    ]);
    const thumbs = fixture.nativeElement.querySelectorAll('.thumb');
    expect(thumbs.length).toBe(3);
    expect(thumbs[0].getAttribute('aria-current')).toBe('true');
  });

  it('hides the thumbnail strip when only one image is provided', async () => {
    const fixture = await renderComponent(ProductGalleryComponent, { images: [baseImages[0]] }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('.thumbs')).toBeNull();
  });

  it('clicking a thumbnail makes it the active image and aria-current', async () => {
    const fixture = await renderComponent(ProductGalleryComponent, { images: baseImages }, [
      provideRouter([]),
      LocaleService,
    ]);
    const second = fixture.nativeElement.querySelectorAll('.thumb')[1] as HTMLButtonElement;
    second.click();
    fixture.detectChanges();
    const main = fixture.nativeElement.querySelector('.main img') as HTMLImageElement;
    expect(main.getAttribute('src')).toBe('https://cdn.example/echo-2.jpg');
    expect(second.getAttribute('aria-current')).toBe('true');
  });

  it('arrow-right key advances the active thumbnail', async () => {
    const fixture = await renderComponent(ProductGalleryComponent, { images: baseImages }, [
      provideRouter([]),
      LocaleService,
    ]);
    const host = fixture.nativeElement.querySelector('.gallery') as HTMLElement;
    fixture.nativeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    void host;
    const second = fixture.nativeElement.querySelectorAll('.thumb')[1] as HTMLButtonElement;
    expect(second.getAttribute('aria-current')).toBe('true');
  });

  it('arrow-left key wraps to the last image from the first', async () => {
    const fixture = await renderComponent(ProductGalleryComponent, { images: baseImages }, [
      provideRouter([]),
      LocaleService,
    ]);
    fixture.nativeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    fixture.detectChanges();
    const last = fixture.nativeElement.querySelectorAll('.thumb')[2] as HTMLButtonElement;
    expect(last.getAttribute('aria-current')).toBe('true');
  });

  it('passes axe with thumbnail labels', async () => {
    const fixture = await renderComponent(ProductGalleryComponent, { images: baseImages }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement);
  });

  /**
   * Finding P1, recorded twice (prior pass P3, operator requirement #10).
   * Clicking the main image did nothing at all: no dialog existed anywhere in
   * the component, and thumbnails only swapped the main image.
   */
  describe('fullscreen lightbox (finding P1)', () => {
    const gallery = getChromeStrings('fr').product.gallery;

    async function render(images: GalleryImage[] = baseImages) {
      return renderComponent(ProductGalleryComponent, { images }, [
        provideRouter([]),
        LocaleService,
      ]);
    }

    it('wraps the main image in a labelled zoom button', async () => {
      const fixture = await render();
      const button = zoomButton(fixture);
      expect(button).not.toBeNull();
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-label')).toBe(gallery.open);
      expect(button.querySelector('img')).not.toBeNull();
    });

    it('renders the dialog closed on first paint so the server emits valid HTML', async () => {
      const fixture = await render();
      expect(lightbox(fixture)).toBeNull();
    });

    it('opens the active image at full width when the zoom button is clicked', async () => {
      const fixture = await render();
      const dialog = await openLightbox(fixture);
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const heading = dialog.querySelector('#' + labelledBy);
      expect(heading?.textContent?.trim()).toBe(gallery.label);
      const img = dialog.querySelector('img') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe(baseImages[0].url);
      expect(img.getAttribute('sizes')).toBe('100vw');
    });

    it('shows the active image, not always the first', async () => {
      const fixture = await render();
      (fixture.nativeElement.querySelectorAll('.thumb')[2] as HTMLButtonElement).click();
      fixture.detectChanges();
      const dialog = await openLightbox(fixture);
      expect((dialog.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(
        baseImages[2].url,
      );
    });

    it('counts the position and advances it on arrow-right', async () => {
      const fixture = await render();
      const dialog = await openLightbox(fixture);
      const counter = dialog.querySelector('.counter') as HTMLElement;
      expect(counter.textContent?.trim()).toBe(
        gallery.counter.replace('{position}', '1').replace('{total}', '3'),
      );

      fixture.nativeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      const reopened = lightbox(fixture) as HTMLElement;
      expect((reopened.querySelector('.counter') as HTMLElement).textContent?.trim()).toBe(
        gallery.counter.replace('{position}', '2').replace('{total}', '3'),
      );
      expect((reopened.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(
        baseImages[1].url,
      );
    });

    it('steps with its own previous and next buttons', async () => {
      const fixture = await render();
      const dialog = await openLightbox(fixture);
      const prev = dialog.querySelector('.nav-prev') as HTMLButtonElement;
      const next = dialog.querySelector('.nav-next') as HTMLButtonElement;
      expect(prev.getAttribute('aria-label')).toBe(gallery.previousImage);
      expect(next.getAttribute('aria-label')).toBe(gallery.nextImage);

      next.click();
      fixture.detectChanges();
      const afterNext = lightbox(fixture) as HTMLElement;
      expect((afterNext.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(
        baseImages[1].url,
      );

      (afterNext.querySelector('.nav-prev') as HTMLButtonElement).click();
      fixture.detectChanges();
      const afterPrev = lightbox(fixture) as HTMLElement;
      expect((afterPrev.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(
        baseImages[0].url,
      );
    });

    it('hides the counter and the step buttons for a single-image product', async () => {
      const fixture = await render([baseImages[0]]);
      const dialog = await openLightbox(fixture);
      expect(dialog.querySelector('.counter')).toBeNull();
      expect(dialog.querySelector('.nav-prev')).toBeNull();
      expect(dialog.querySelector('.nav-next')).toBeNull();
    });

    it('closes on the close button and returns focus to the zoom trigger', async () => {
      const fixture = await render();
      const wrapper = attachToBody(fixture.nativeElement);
      const dialog = await openLightbox(fixture);
      const close = dialog.querySelector('.close') as HTMLButtonElement;
      expect(close.getAttribute('aria-label')).toBe(gallery.close);

      close.click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(lightbox(fixture)).toBeNull();
      expect(document.activeElement).toBe(zoomButton(fixture));
      wrapper.remove();
    });

    it('closes when the backdrop area outside the figure is clicked', async () => {
      const fixture = await render();
      const dialog = await openLightbox(fixture);
      (dialog.querySelector('.frame') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      expect(lightbox(fixture)).toBeNull();
    });

    it('keeps a click on the image itself from closing the lightbox', async () => {
      const fixture = await render();
      const dialog = await openLightbox(fixture);
      (dialog.querySelector('.figure') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      expect(lightbox(fixture)).not.toBeNull();
    });

    it('passes axe with the lightbox open', async () => {
      const fixture = await render();
      const wrapper = attachToBody(fixture.nativeElement);
      await openLightbox(fixture);
      await assertAxeClean(wrapper);
      wrapper.remove();
    });
  });
});
