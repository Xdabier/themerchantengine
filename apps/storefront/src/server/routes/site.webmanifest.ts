import { defineEventHandler, setHeader } from 'h3';

import { NEUTRAL_STOREFRONT_RUNTIME_CONFIG } from '@storefront-types';

import { readStoreConfig } from '../store-config';

/**
 * The web app manifest, rendered from the runtime config (plan E2.2).
 *
 * It used to be a static file in `public/`, which meant the installed-app name,
 * the language, the direction and the theme colour were build constants. On a
 * generic engine every one of them is per install, so the file became a route.
 *
 * `theme_color` comes from the generated palette rather than the seed colour,
 * because the palette is what the page actually renders and a browser painting
 * its chrome a different colour from the header is the defect this closes.
 *
 * Cached for the same minute the config endpoint is, so a manifest fetch does
 * not become an upstream call per install prompt.
 */
export default defineEventHandler(async (event) => {
  const config = await readStoreConfig();
  // Never undefined in practice: `readStoreConfig` already falls back to the
  // neutral config, whose palette is generated. The second fallback is here so
  // no colour in this file is a literal.
  const palette: Partial<Record<string, string>> =
    config.brand.generatedPalette?.tokens ??
    NEUTRAL_STOREFRONT_RUNTIME_CONFIG.brand.generatedPalette?.tokens ??
    {};

  setHeader(event, 'content-type', 'application/manifest+json; charset=utf-8');
  setHeader(event, 'cache-control', 'public, max-age=60');

  return {
    name: config.identity.storeName,
    short_name: config.identity.brandName || config.identity.storeName,
    lang: config.localization.defaultLocale,
    dir: config.localization.rtlLocales.includes(config.localization.defaultLocale) ? 'rtl' : 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: palette['--brand-bg'],
    theme_color: palette['--brand-primary'],
    icons: [
      { src: '/brand/default/app-icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/brand/default/app-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/default/app-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
});
