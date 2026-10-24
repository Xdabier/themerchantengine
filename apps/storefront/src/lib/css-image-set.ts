import type { PictureSource } from '../app/ui/picture.component';

/**
 * Serialise an `image-set()` declaration for CSS `background-image` consumers
 * against the resolved variant ladder.
 *
 * Authority: constitution §3.11 amendment (2026-05-02) — CSS `background-image`
 * consumers MUST use `image-set(url("avif") type("image/avif"), url("webp")
 * type("image/webp"), url("png"))` against the resolver's variant set rather
 * than binding `url(<single-resolver-url>)` directly. Brand-floor §5 carries the
 * the same rule for every storefront asset.
 *
 * Each `PictureSource` carries a `srcset` of the shape `"url1 150w, url2 400w"`.
 * `image-set()` does not accept the `<width>w` density descriptor used in
 * `srcset`, so we lift the largest-width URL per format — the upper rung of the
 * ladder is the right pick for CSS backgrounds since the background-size
 * coverage is decided at paint time, not by intrinsic image width.
 *
 * The `fallbackUrl` is appended as the last `url("...")` entry without a
 * `type()` declaration so browsers without `image-set()` support — or browsers
 * unable to decode any of the typed entries — still resolve the chrome asset.
 *
 * Returns `null` when both arguments are empty so consumers can branch on the
 * absence (e.g. mid-banner falls back to a hardcoded SVG motif).
 */
export function buildBackgroundImageSet(
  sources: PictureSource[] | undefined,
  fallbackUrl: string | null,
): string | null {
  const parts: string[] = [];

  if (sources?.length) {
    for (const source of sources) {
      const url = pickLargestUrl(source.srcset);
      if (!url) continue;
      parts.push(`url(${quote(url)}) type(${quote(source.type)})`);
    }
  }

  if (fallbackUrl) {
    parts.push(`url(${quote(fallbackUrl)})`);
  }

  if (parts.length === 0) return null;
  return `image-set(${parts.join(', ')})`;
}

/**
 * Parse a srcset entry of the form `"url1 150w, url2 400w"` and return the URL
 * with the largest width descriptor. Falls back to the trimmed entry when no
 * width descriptor is present.
 */
function pickLargestUrl(srcset: string): string | null {
  if (!srcset) return null;
  const entries = srcset
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (entries.length === 0) return null;

  let bestUrl: string | null = null;
  let bestWidth = -1;

  for (const entry of entries) {
    const lastSpace = entry.lastIndexOf(' ');
    if (lastSpace === -1) {
      if (bestUrl === null) bestUrl = entry;
      continue;
    }
    const url = entry.slice(0, lastSpace).trim();
    const descriptor = entry.slice(lastSpace + 1).trim();
    const widthMatch = /^(\d+)w$/.exec(descriptor);
    const width = widthMatch ? Number(widthMatch[1]) : 0;
    if (width > bestWidth) {
      bestWidth = width;
      bestUrl = url;
    }
  }

  return bestUrl;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
