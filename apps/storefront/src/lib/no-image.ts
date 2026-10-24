/**
 * "No image available" placeholder served from `apps/storefront/public/brand/`.
 * Used as the fallback when a product, category, or detail asset is missing, so
 * the empty state reads as intentional rather than broken.
 *
 * Locale-neutral by design. It replaced a per-locale PNG pair whose captions
 * were baked into the artwork, which meant a French page could only ever be
 * served a placeholder captioned in another language. The SVG carries no text,
 * so one asset serves every locale and there is no locale branch left here.
 */
export function noImageFallback(): string {
  return '/brand/no-image.svg';
}

/**
 * The neutral marks a fresh engine ships, one per ground.
 *
 * Two files rather than one `currentColor` asset: the mark is loaded through
 * an `<img>`, which renders the SVG in its own document, so `currentColor`
 * resolves to that document's initial black and not to the colour of the
 * element around it. A single mark painted that way is invisible on the dark
 * footer, which is what shipped until the gate review caught it.
 *
 * An install that uploads its own logo gets it from the runtime config. That
 * is still one asset for both grounds; a reversed variant is a brand-screen
 * field for E3.1.
 */
export const DEFAULT_LOGO = '/brand/default/logo.svg';

/** The mark for a dark ground: the footer, and anything else that inverts. */
export const DEFAULT_LOGO_INVERSE = '/brand/default/logo-inverse.svg';
