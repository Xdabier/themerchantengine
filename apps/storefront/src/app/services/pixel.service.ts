import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

import { StoreConfigService } from './store-config.service';

/**
 * Vendor tag injection for the pixels an operator configured (finding D2).
 *
 * Until this existed, configuring a GA4, Meta, TikTok or Snap id in the admin
 * changed nothing anywhere: no tag was injected on any page, so the operator's
 * whole analytics family was inert.
 *
 * **Bundled TypeScript, never an inline snippet.** The bootstrap code every
 * vendor's documentation hands you is an inline `<script>`, and the storefront
 * CSP has no `'unsafe-inline'` on `script-src` on purpose. Rather than open
 * that surface for marketing tags, each vendor's stub queue is built here in
 * TypeScript and only the external loader is appended. The loaders' origins are
 * allowlisted in `server/middleware/security-headers.ts`.
 *
 * **This is the single choke point.** Every vendor script the storefront ever
 * loads passes through `init()`. A consent gate, if the operator ever wants
 * one, is one guard clause at the top of it rather than a sweep across four
 * vendors. The current posture is the plan's documented default, recorded
 * 2026-08-31: configured pixels load for every visitor, with no banner.
 *
 * Every failure is swallowed. A blocked or failed injection must cost the
 * operator a pixel, never cost a reader the page, and nothing here logs at
 * error level because the e2e console baseline fails a journey on one.
 */

export interface VendorPixels {
  googleAnalyticsId: string | null;
  metaPixelId: string | null;
  tiktokPixelId: string | null;
  snapPixelId: string | null;
}

/** Which vendors actually have a live global, so the tracker mirrors to those
 * and only those. */
export interface ActivePixels {
  ga4: boolean;
  meta: boolean;
  tiktok: boolean;
  snap: boolean;
}

/** Element ids, so a re-mount cannot append a second loader. A duplicated GA
 * loader double-counts every event after it. */
const SCRIPT_IDS = {
  ga4: 'pixel-ga4',
  meta: 'pixel-meta',
  tiktok: 'pixel-tiktok',
  snap: 'pixel-snap',
} as const;

/** The vendor globals every tag defines on `window`, as an index we can write
 * to without declaring four ambient module augmentations. */
type WindowWithPixels = Record<string, unknown> & { dataLayer?: unknown[] };

function pixelWindow(): WindowWithPixels {
  return window as unknown as WindowWithPixels;
}

@Injectable({ providedIn: 'root' })
export class PixelService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly storeConfig = inject(StoreConfigService);

  private readonly _active = signal<ActivePixels>({
    ga4: false,
    meta: false,
    tiktok: false,
    snap: false,
  });

  readonly active = this._active.asReadonly();

  /**
   * Load the tags for whatever the operator configured. Safe to call more than
   * once: each vendor is guarded by its script element id.
   */
  init(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const pixels = this.storeConfig.pixels();
    const active: ActivePixels = {
      ga4: pixels.googleAnalyticsId ? this.initGa4(pixels.googleAnalyticsId) : false,
      meta: pixels.metaPixelId ? this.initMeta(pixels.metaPixelId) : false,
      tiktok: pixels.tiktokPixelId ? this.initTikTok(pixels.tiktokPixelId) : false,
      snap: pixels.snapPixelId ? this.initSnap(pixels.snapPixelId) : false,
    };
    this._active.set(active);
  }

  private initGa4(measurementId: string): boolean {
    const w = pixelWindow();
    // The queue first: the loader consumes whatever is already in `dataLayer`,
    // so a `gtag` defined after the tag loses every call made in between.
    w['dataLayer'] = w['dataLayer'] ?? [];
    if (typeof w['gtag'] !== 'function') {
      w['gtag'] = function gtag(...args: unknown[]): void {
        // `arguments`, not the spread array: GA reads an arguments object and
        // an array arrives as a single nested element it ignores.
        // eslint-disable-next-line prefer-rest-params
        (w['dataLayer'] as unknown[]).push(arguments as unknown);
        void args;
      };
    }
    const gtag = w['gtag'] as (...args: unknown[]) => void;
    gtag('js', new Date());
    gtag('config', measurementId);

    return this.appendScript(
      SCRIPT_IDS.ga4,
      `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`,
    );
  }

  private initMeta(pixelId: string): boolean {
    const w = pixelWindow();
    if (typeof w['fbq'] !== 'function') {
      const queue: unknown[][] = [];
      const fbq = function fbq(...args: unknown[]): void {
        queue.push(args);
      } as ((...args: unknown[]) => void) & {
        queue: unknown[][];
        loaded: boolean;
        version: string;
      };
      fbq.queue = queue;
      fbq.loaded = true;
      fbq.version = '2.0';
      w['fbq'] = fbq;
      w['_fbq'] = fbq;
    }
    const fbq = w['fbq'] as (...args: unknown[]) => void;
    fbq('init', pixelId);
    fbq('track', 'PageView');

    return this.appendScript(SCRIPT_IDS.meta, 'https://connect.facebook.net/en_US/fbevents.js');
  }

  private initTikTok(pixelId: string): boolean {
    const w = pixelWindow();
    if (typeof w['ttq'] !== 'function') {
      const queue: unknown[][] = [];
      const ttq = function ttq(...args: unknown[]): void {
        queue.push(args);
      } as ((...args: unknown[]) => void) & {
        queue: unknown[][];
        track: (...args: unknown[]) => void;
        page: () => void;
      };
      ttq.queue = queue;
      ttq.track = (...args: unknown[]) => queue.push(['track', ...args]);
      ttq.page = () => queue.push(['page']);
      w['ttq'] = ttq;
    }

    return this.appendScript(
      SCRIPT_IDS.tiktok,
      `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`,
    );
  }

  private initSnap(pixelId: string): boolean {
    const w = pixelWindow();
    if (typeof w['snaptr'] !== 'function') {
      const queue: unknown[][] = [];
      const snaptr = function snaptr(...args: unknown[]): void {
        queue.push(args);
      } as ((...args: unknown[]) => void) & { queue: unknown[][] };
      snaptr.queue = queue;
      w['snaptr'] = snaptr;
    }
    const snaptr = w['snaptr'] as (...args: unknown[]) => void;
    snaptr('init', pixelId);

    return this.appendScript(SCRIPT_IDS.snap, 'https://sc-static.net/scevent.min.js');
  }

  /**
   * Append one external loader, once. Returns whether the vendor is live, so a
   * blocked injection leaves the tracker mirroring nowhere rather than calling
   * into a global whose script never arrived.
   */
  private appendScript(id: string, src: string): boolean {
    try {
      if (document.getElementById(id)) return true;
      const script = document.createElement('script');
      script.id = id;
      script.async = true;
      script.src = src;
      document.head.appendChild(script);
      return true;
    } catch {
      return false;
    }
  }
}
