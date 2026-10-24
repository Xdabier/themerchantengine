import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreConfigService } from './store-config.service';
import { PixelService, type VendorPixels } from './pixel.service';

const NO_PIXELS: VendorPixels = {
  googleAnalyticsId: null,
  metaPixelId: null,
  tiktokPixelId: null,
  snapPixelId: null,
};

function build(pixels: Partial<VendorPixels> = {}, platform: 'server' | 'browser' = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: StoreConfigService,
        useValue: { pixels: signal({ ...NO_PIXELS, ...pixels }) },
      },
    ],
  });
  return TestBed.inject(PixelService);
}

function scripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll('script'));
}

function srcs(): string[] {
  return scripts().map((s) => s.src);
}

describe('PixelService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.querySelectorAll('script').forEach((node) => node.remove());
    for (const key of ['dataLayer', 'gtag', 'fbq', '_fbq', 'ttq', 'snaptr']) {
      delete (window as unknown as Record<string, unknown>)[key];
    }
  });

  afterEach(() => {
    document.head.querySelectorAll('script').forEach((node) => node.remove());
  });

  describe('nothing configured', () => {
    it('appends no script at all', () => {
      build().init();
      expect(scripts()).toHaveLength(0);
    });

    it('leaves every vendor global undefined, so the tracker has nothing to mirror to', () => {
      build().init();
      const w = window as unknown as Record<string, unknown>;
      expect(w['gtag']).toBeUndefined();
      expect(w['fbq']).toBeUndefined();
      expect(w['ttq']).toBeUndefined();
      expect(w['snaptr']).toBeUndefined();
    });
  });

  describe('server pass', () => {
    it('injects nothing, because there is no document to inject into', () => {
      build({ googleAnalyticsId: 'G-ABC' }, 'server').init();
      expect(scripts()).toHaveLength(0);
    });
  });

  describe('GA4', () => {
    it('appends the gtag loader carrying the configured id', () => {
      build({ googleAnalyticsId: 'G-ABC123' }).init();
      expect(srcs()).toContain('https://www.googletagmanager.com/gtag/js?id=G-ABC123');
    });

    it('initialises dataLayer and gtag BEFORE the loader is appended', () => {
      // The loader consumes whatever is already queued. A gtag defined after
      // the script tag loses every call made in between.
      const service = build({ googleAnalyticsId: 'G-ABC123' });
      const appended: string[] = [];
      const original = document.head.appendChild.bind(document.head);
      const spy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
        appended.push(
          typeof (window as never)['gtag'] === 'function' ? 'gtag-ready' : 'gtag-missing',
        );
        return original(node as never);
      });
      try {
        service.init();
      } finally {
        spy.mockRestore();
      }
      expect(appended).toContain('gtag-ready');
      expect(appended).not.toContain('gtag-missing');
    });

    it('queues a call made before the vendor script loads', () => {
      build({ googleAnalyticsId: 'G-ABC123' }).init();
      const w = window as unknown as { gtag: (...args: unknown[]) => void; dataLayer: unknown[] };
      const before = w.dataLayer.length;
      w.gtag('event', 'purchase', { value: 10 });
      expect(w.dataLayer.length).toBe(before + 1);
    });
  });

  describe('Meta', () => {
    it('appends the fbevents loader and inits the configured pixel', () => {
      build({ metaPixelId: '1234567890' }).init();
      expect(srcs()).toContain('https://connect.facebook.net/en_US/fbevents.js');
      const w = window as unknown as { fbq: { queue: unknown[][] } };
      expect(w.fbq.queue.some((call) => call[0] === 'init' && call[1] === '1234567890')).toBe(true);
    });
  });

  describe('TikTok and Snap', () => {
    it('appends the TikTok loader for the configured id', () => {
      build({ tiktokPixelId: 'TT123' }).init();
      expect(srcs().some((src) => src.includes('analytics.tiktok.com'))).toBe(true);
    });

    it('appends the Snap loader for the configured id', () => {
      build({ snapPixelId: 'SNAP-1' }).init();
      expect(srcs().some((src) => src.includes('sc-static.net'))).toBe(true);
    });
  });

  describe('idempotence', () => {
    it('appends each vendor script once however often init runs', () => {
      // The shell can re-enter on a re-mount, and a duplicated GA loader
      // double-counts every event after it.
      const service = build({ googleAnalyticsId: 'G-ABC123', metaPixelId: '1234567890' });
      service.init();
      service.init();
      service.init();
      expect(scripts()).toHaveLength(2);
    });

    it('does not re-append a script another mount already added', () => {
      build({ googleAnalyticsId: 'G-ABC123' }).init();
      TestBed.resetTestingModule();
      build({ googleAnalyticsId: 'G-ABC123' }).init();
      expect(scripts()).toHaveLength(1);
    });
  });

  describe('resilience', () => {
    it('reports which vendors are live so the tracker mirrors only to those', () => {
      const service = build({ googleAnalyticsId: 'G-ABC123' });
      service.init();
      expect(service.active()).toEqual({ ga4: true, meta: false, tiktok: false, snap: false });
    });

    it('never throws when appending fails', () => {
      // A failed injection must cost the operator a pixel, never the page.
      const spy = vi.spyOn(document.head, 'appendChild').mockImplementation(() => {
        throw new Error('blocked');
      });
      try {
        expect(() => build({ googleAnalyticsId: 'G-ABC123' }).init()).not.toThrow();
      } finally {
        spy.mockRestore();
      }
    });

    it('marks a vendor inactive when its injection failed', () => {
      const spy = vi.spyOn(document.head, 'appendChild').mockImplementation(() => {
        throw new Error('blocked');
      });
      let service: PixelService;
      try {
        service = build({ googleAnalyticsId: 'G-ABC123' });
        service.init();
      } finally {
        spy.mockRestore();
      }
      expect(service!.active().ga4).toBe(false);
    });
  });
});
