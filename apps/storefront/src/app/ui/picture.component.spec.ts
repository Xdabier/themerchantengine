import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { PictureComponent } from './picture.component';
import { assertAxeClean, renderComponent } from './testing';

describe('PictureComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders a fallback img with src + alt and lazy defaults', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/echo.jpg',
      alt: 'Echo Buds Pro',
    });
    const img = fixture.nativeElement.querySelector('img.image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn.example/echo.jpg');
    expect(img.getAttribute('alt')).toBe('Echo Buds Pro');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('fetchpriority')).toBeNull();
  });

  it('renders <source> entries for each provided source in order', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/echo.jpg',
      alt: 'Echo Buds Pro',
      sources: [
        { type: 'image/avif', srcset: 'https://cdn.example/echo.avif' },
        { type: 'image/webp', srcset: 'https://cdn.example/echo.webp' },
      ],
    });
    const sources = fixture.nativeElement.querySelectorAll('source');
    expect(sources.length).toBe(2);
    expect(sources[0].getAttribute('type')).toBe('image/avif');
    expect(sources[1].getAttribute('type')).toBe('image/webp');
  });

  it('flips to eager + high fetchpriority when priority is true', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/echo.jpg',
      alt: 'Echo Buds Pro',
      priority: true,
    });
    const img = fixture.nativeElement.querySelector('img.image') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(img.getAttribute('fetchpriority')).toBe('high');
  });

  it('emits width + height + sizes attributes when provided', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/echo.jpg',
      alt: 'Echo',
      width: 800,
      height: 800,
      sizes: '(max-width: 600px) 100vw, 50vw',
    });
    const img = fixture.nativeElement.querySelector('img.image') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('800');
    expect(img.getAttribute('height')).toBe('800');
    expect(img.getAttribute('sizes')).toBe('(max-width: 600px) 100vw, 50vw');
  });

  it('per-source sizes overrides the host-level sizes', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/echo.jpg',
      alt: 'Echo',
      sizes: '50vw',
      sources: [{ type: 'image/webp', srcset: 'https://cdn.example/echo.webp', sizes: '100vw' }],
    });
    const source = fixture.nativeElement.querySelector('source') as HTMLSourceElement;
    expect(source.getAttribute('sizes')).toBe('100vw');
  });

  it('applies aspect-ratio inline style when provided', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/echo.jpg',
      alt: 'Echo',
      aspectRatio: '1 / 1',
    });
    const picture = fixture.nativeElement.querySelector('picture.picture') as HTMLPictureElement;
    expect(picture.style.aspectRatio).toBe('1 / 1');
  });

  it('passes axe with required alt text', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/echo.jpg',
      alt: 'Echo Buds Pro — wireless earbuds',
    });
    await assertAxeClean(fixture.nativeElement);
  });

  it('renders the no-image surface when src is empty', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: '',
      alt: 'No image available',
    });
    const img = fixture.nativeElement.querySelector('img.image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/brand/no-image.svg');
  });

  it('serves the same placeholder whatever the alt copy language is', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: '',
      alt: 'Aucune image disponible',
    });
    const img = fixture.nativeElement.querySelector('img.image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/brand/no-image.svg');
  });

  it('suppresses the <source> ladder when falling back', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: '',
      alt: 'No image available',
      sources: [
        { type: 'image/avif', srcset: 'https://cdn.example/echo.avif' },
        { type: 'image/webp', srcset: 'https://cdn.example/echo.webp' },
      ],
    });
    expect(fixture.nativeElement.querySelectorAll('source').length).toBe(0);
  });

  it('swaps to the no-image surface after the underlying img errors', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/missing.jpg',
      alt: 'Echo Buds Pro',
      sources: [{ type: 'image/avif', srcset: 'https://cdn.example/missing.avif' }],
    });
    const img = fixture.nativeElement.querySelector('img.image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn.example/missing.jpg');
    img.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    const after = fixture.nativeElement.querySelector('img.image') as HTMLImageElement;
    expect(after.getAttribute('src')).toBe('/brand/no-image.svg');
    expect(fixture.nativeElement.querySelectorAll('source').length).toBe(0);
  });

  /**
   * Pinned here because this is the tier where it is deterministic, and
   * because an e2e cannot tell the two apart.
   *
   * `av4-picture-rendering.journey.spec.ts` asserts a card renders a `<source>`
   * ladder, which reads as a markup assertion about the AV4 migration. It is
   * not: the ladder is conditional on the image having loaded, and the seed's
   * images come from a bucket on the public internet. A slow fetch there
   * stripped the ladder and the e2e reported it as an AV4 regression. The
   * conditional itself is deliberate and correct, so it is asserted directly
   * rather than relaxed.
   */
  it('restores the ladder when a later src arrives, so one bad URL is not permanent', async () => {
    const sources = [{ type: 'image/avif', srcset: 'https://cdn.example/first.avif' }];
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/first.jpg',
      alt: 'Echo Buds Pro',
      sources,
    });
    expect(fixture.nativeElement.querySelectorAll('source').length).toBe(1);

    (fixture.nativeElement.querySelector('img.image') as HTMLImageElement).dispatchEvent(
      new Event('error'),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('source').length).toBe(0);

    // A new URL is a new load attempt, not an inheritance of the old failure.
    fixture.componentRef.setInput('src', 'https://cdn.example/second.jpg');
    fixture.componentRef.setInput('sources', [
      { type: 'image/avif', srcset: 'https://cdn.example/second.avif' },
    ]);
    fixture.detectChanges();

    const restored = fixture.nativeElement.querySelectorAll('source');
    expect(restored.length).toBe(1);
    expect(restored[0].getAttribute('srcset')).toBe('https://cdn.example/second.avif');
    expect(
      (fixture.nativeElement.querySelector('img.image') as HTMLImageElement).getAttribute('src'),
    ).toBe('https://cdn.example/second.jpg');
  });

  /**
   * `cover` crops to fill a fixed box, which is right for a card or a gallery
   * thumbnail and wrong for a fullscreen viewer, where the whole frame has to
   * be visible. Driven by a custom property so the caller sets it from outside
   * the component's style encapsulation.
   */
  it('defaults to cover and exposes contain for full-frame surfaces', async () => {
    const fixture = await renderComponent(PictureComponent, {
      src: 'https://cdn.example/one.jpg',
      alt: 'One',
    });
    expect(fixture.nativeElement.style.getPropertyValue('--picture-fit')).toBe('cover');

    fixture.componentRef.setInput('fit', 'contain');
    fixture.detectChanges();
    expect(fixture.nativeElement.style.getPropertyValue('--picture-fit')).toBe('contain');
  });
});
